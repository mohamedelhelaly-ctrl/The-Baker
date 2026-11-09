"""Email templates, the outbox and the worker that sends it (DESIGN.md §7).

Rows are written inside the business transaction (`enqueue`), then a worker sends them. A mail
outage therefore never rolls back an order, nothing is lost on restart, and failures are visible.
Wording is editable by the owner, rendered in a sandbox with a fixed set of variables.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from jinja2 import StrictUndefined, TemplateError
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.clock import STORE_TZ
from app.core.money import format_money
from app.core.security import tracking_token
from app.crud.store_settings import store_settings_crud
from app.models.notification import Notification, NotificationStatus, NotificationTemplate
from app.models.order import Order, PaymentMethod, PaymentStatus
from app.services.email import EmailSender

logger = logging.getLogger("baker.notifications")

PICKUP_ADDRESS = "Collect from the bakery"  # replaced with the owner's pickup details when queuing
MAX_ATTEMPTS = 5
BACKOFF_SECONDS = 30  # doubles each attempt: 30s, 60s, 2m, 4m


class TemplateRenderError(ValueError):
    pass


@dataclass(frozen=True)
class TemplateDef:
    key: str
    title: str
    description: str
    subject: str
    body: str
    variables: tuple[str, ...]


ORDER_VARS = (
    "customer_name",
    "order_code",
    "order_total",
    "fulfilment",
    "when",
    "address",
    "items",
    "payment",
    "tracking_url",
    "store_name",
)
_FOOTER = "\n\nThank you,\n{{ store_name }}"
_ORDER_BLOCK = (
    "\n\nOrder {{ order_code }}\n{{ items }}\nTotal: {{ order_total }}\n"
    "{{ fulfilment }}: {{ when }}\n{{ address }}\nPayment: {{ payment }}"
    "\n\nYou can follow your order here:\n{{ tracking_url }}"
)

TEMPLATES: dict[str, TemplateDef] = {
    t.key: t
    for t in [
        TemplateDef(
            "order_confirmed",
            "Order confirmed",
            "Sent when an order is placed (cash on delivery) or its card payment succeeds.",
            "We received your order {{ order_code }}",
            "Hi {{ customer_name }},\n\nThank you for your order. We have received it and will confirm it shortly."
            + _ORDER_BLOCK
            + _FOOTER,
            ORDER_VARS,
        ),
        TemplateDef(
            "order_accepted",
            "Order accepted",
            "Sent when the bakery accepts an order.",
            "Your order {{ order_code }} is accepted",
            "Hi {{ customer_name }},\n\nGood news: we accepted your order and will start preparing it soon."
            + _ORDER_BLOCK
            + _FOOTER,
            ORDER_VARS,
        ),
        TemplateDef(
            "order_rejected",
            "Order declined",
            "Sent when the bakery cannot take an order.",
            "We could not take your order {{ order_code }}",
            "Hi {{ customer_name }},\n\nWe are sorry, but we cannot take your order.\nReason: {{ reason }}"
            "\n\nIf you paid online, your payment will be refunded.\n\nOrder {{ order_code }}\n{{ tracking_url }}"
            + _FOOTER,
            (*ORDER_VARS, "reason"),
        ),
        TemplateDef(
            "status_changed",
            "Order status update",
            "Sent when an order moves to a new stage.",
            "Your order {{ order_code }}: {{ status_text }}",
            "Hi {{ customer_name }},\n\nYour order is now: {{ status_text }}.\n\nFollow it here:\n{{ tracking_url }}"
            + _FOOTER,
            (*ORDER_VARS, "status_text"),
        ),
        TemplateDef(
            "order_delayed",
            "Order delayed",
            "Sent when an order is marked as running late.",
            "Your order {{ order_code }} is running late",
            "Hi {{ customer_name }},\n\nWe are sorry, your order is running late.\n{{ delay_note }}"
            "\n\nFollow it here:\n{{ tracking_url }}" + _FOOTER,
            (*ORDER_VARS, "delay_note"),
        ),
        TemplateDef(
            "order_cancelled",
            "Order cancelled",
            "Sent when an order is cancelled.",
            "Your order {{ order_code }} was cancelled",
            "Hi {{ customer_name }},\n\nYour order was cancelled.\nReason: {{ reason }}"
            "\n\nOrder {{ order_code }}\n{{ tracking_url }}" + _FOOTER,
            (*ORDER_VARS, "reason"),
        ),
        TemplateDef(
            "order_modified",
            "Order changed",
            "Sent when an order is changed.",
            "Your order {{ order_code }} was updated",
            "Hi {{ customer_name }},\n\nYour order was updated." + _ORDER_BLOCK + _FOOTER,
            ORDER_VARS,
        ),
        TemplateDef(
            "staff_message",
            "Message from the bakery",
            "Sent when staff contact a customer about an order.",
            "A message about your order {{ order_code }}",
            "Hi {{ customer_name }},\n\n{{ message }}\n\nOrder {{ order_code }}\n{{ tracking_url }}"
            + _FOOTER,
            (*ORDER_VARS, "message"),
        ),
        TemplateDef(
            "password_reset",
            "Password reset",
            "Sent when someone asks to reset their password.",
            "Reset your password",
            "Hi {{ customer_name }},\n\nUse this link to choose a new password (valid for {{ reset_minutes }} minutes):"
            "\n{{ reset_url }}\n\nIf you did not ask for this, you can ignore this email."
            + _FOOTER,
            ("customer_name", "reset_url", "reset_minutes", "store_name"),
        ),
    ]
}

SAMPLE = {
    "customer_name": "Sara Ali",
    "order_code": "BK-7F3K2Q",
    "order_total": "1,340.00 EGP",
    "fulfilment": "Delivery",
    "when": "Wednesday 4 December 2030, 10:00 AM to 12:00 PM",
    "address": "12 Road 9, building 5, Maadi",
    "payment": "Cash on delivery or pickup",
    "items": "2 × Triple Chocolate Cake (6-inch) — 1,300.00 EGP\n    Message: Happy Birthday",
    "tracking_url": "https://example.com/track/BK-7F3K2Q?t=abc123",
    "store_name": "The Baker",
    "reason": "We are fully booked that day.",
    "status_text": "Being prepared",
    "delay_note": "Running about 30 minutes late.",
    "message": "Could you confirm the floor number?",
    "reset_url": "https://example.com/reset-password?token=abc123",
    "reset_minutes": "30",
}

_env = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False, keep_trailing_newline=True)


def render(text: str, context: dict[str, str]) -> str:
    """Render in a sandbox with only the whitelisted variables. Unknown variables are an error."""
    try:
        return _env.from_string(text).render(**context)
    except TemplateError as exc:
        raise TemplateRenderError(str(exc)) from exc
    except (
        Exception
    ) as exc:  # owner-written text can fail in odd ways (e.g. {% include %} has no loader)
        raise TemplateRenderError(f"{type(exc).__name__}: {exc}") from exc


def validate_template(key: str, subject: str, body: str) -> None:
    """Called when the owner saves: refuses broken syntax and variables the email cannot provide."""
    allowed = {v: SAMPLE[v] for v in TEMPLATES[key].variables}
    render(subject, allowed)
    render(body, allowed)


def preview(key: str, subject: str, body: str) -> tuple[str, str]:
    allowed = {v: SAMPLE[v] for v in TEMPLATES[key].variables}
    return render(subject, allowed), render(body, allowed)


# ------------------------------------------------------------------ context for real orders
def order_context(order: Order, extra: dict[str, str] | None = None) -> dict[str, str]:
    s = get_settings()
    start = order.slot_starts_at.astimezone(STORE_TZ)
    end = order.slot_ends_at.astimezone(STORE_TZ)

    def clock(dt: datetime) -> str:
        return dt.strftime("%I:%M %p").lstrip("0")

    lines = []
    for item in order.items:
        lines.append(
            f"{item.quantity} × {item.product_name} ({item.variant_name}) — "
            f"{format_money(item.line_total, order.currency)}"
        )
        if item.inscription:
            lines.append(f"    Message: {item.inscription}")
    if order.fulfilment_type.value == "delivery" and order.delivery_address:
        a = order.delivery_address
        address = f"{a.get('street', '')}, building {a.get('building', '')}"
        for label, k in (("floor", "floor"), ("apartment", "apartment")):
            if a.get(k):
                address += f", {label} {a[k]}"
        if order.zone_name:
            address += f", {order.zone_name}"
    else:
        address = PICKUP_ADDRESS
    if order.payment_method == PaymentMethod.cod:
        payment = "Cash on delivery or pickup"
    elif order.payment_status == PaymentStatus.paid:
        payment = "Paid by card"
    else:
        payment = "Card payment"
    context = {
        "customer_name": order.contact_name,
        "order_code": order.code,
        "order_total": format_money(order.total, order.currency),
        "fulfilment": "Delivery" if order.fulfilment_type.value == "delivery" else "Pickup",
        "when": f"{start.strftime('%A %d %B %Y')}, {clock(start)} to {clock(end)}",
        "address": address,
        "items": "\n".join(lines),
        "payment": payment,
        "tracking_url": f"{s.frontend_url.rstrip('/')}/track/{order.code}?t={tracking_token(order.code)}",
        "store_name": s.business_name,
    }
    context.update(extra or {})
    return context


# ----------------------------------------------------------------------------- the outbox
async def _load_template(db: AsyncSession, key: str) -> tuple[str, str, bool]:
    row = (
        await db.execute(select(NotificationTemplate).where(NotificationTemplate.key == key))
    ).scalar_one_or_none()
    default = TEMPLATES[key]
    return (row.subject, row.body, row.is_active) if row else (default.subject, default.body, True)


async def _with_owner_details(db: AsyncSession, context: dict[str, str]) -> dict[str, str]:
    """The business name and pickup details are the owner's to edit, so they are read when queuing."""
    row = await store_settings_crud.get(db)
    context = dict(context)
    if row.business_name and "store_name" in context:
        context["store_name"] = row.business_name
    if context.get("address") == PICKUP_ADDRESS and row.pickup_location:
        context["address"] = pickup_text(row.pickup_location, row.pickup_instructions)
    return context


def pickup_text(location: str, instructions: str | None) -> str:
    return f"Collect from: {location}" + (f". {instructions}" if instructions else "")


async def enqueue(
    db: AsyncSession,
    *,
    key: str,
    to_email: str,
    context: dict[str, str],
    order_id: int | None = None,
) -> Notification | None:
    """Queue an email in the caller's transaction (the caller commits). Returns None if the
    owner switched this template off."""
    subject_t, body_t, active = await _load_template(db, key)
    if not active:
        return None
    context = await _with_owner_details(db, context)
    try:
        subject, body = render(subject_t, context), render(body_t, context)
    except TemplateRenderError:
        logger.exception("Template %s failed to render; using the built-in wording", key)
        default = TEMPLATES[key]
        subject, body = render(default.subject, context), render(default.body, context)
    notification = Notification(
        order_id=order_id, template_key=key, to_email=to_email, subject=subject[:300], body=body
    )
    db.add(notification)
    return notification


async def send_pending(
    db: AsyncSession, sender: EmailSender, now: datetime, batch: int = 20
) -> int:
    """Send due emails. Failures back off and retry; after MAX_ATTEMPTS they stay visible as failed."""
    rows = (
        (
            await db.execute(
                select(Notification)
                .where(
                    Notification.status == NotificationStatus.pending,
                    Notification.next_attempt_at <= now,
                )
                .order_by(Notification.id)
                .limit(batch)
                .with_for_update(skip_locked=True)  # safe if a second worker ever runs
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for n in rows:
        n.attempts += 1
        try:
            await sender.send(n.to_email, n.subject, n.body)
            n.status, n.sent_at, n.last_error = NotificationStatus.sent, now, None
            sent += 1
        except Exception as exc:  # any sender failure is retried, never raised into the worker loop
            n.last_error = str(exc)[:500]
            if n.attempts >= MAX_ATTEMPTS:
                n.status = NotificationStatus.failed
            else:
                n.next_attempt_at = now + timedelta(seconds=BACKOFF_SECONDS * 2 ** (n.attempts - 1))
            logger.warning(
                "Email %s to %s failed (attempt %s): %s", n.id, n.to_email, n.attempts, exc
            )
    await db.commit()
    return sent


class Notifier:
    """Lets request handlers wake the worker so emails leave within moments, not on the next tick."""

    def __init__(self) -> None:
        self.event: asyncio.Event | None = None

    def wake(self) -> None:
        if self.event is not None:
            self.event.set()


notifier = Notifier()
