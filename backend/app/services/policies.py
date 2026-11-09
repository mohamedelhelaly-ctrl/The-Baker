"""The cancellation and refund policy, in one place (DESIGN.md §4.4, §4.5)."""

from datetime import datetime, timedelta

from app.models.order import Order, OrderStatus, PaymentMethod, PaymentStatus
from app.models.store_settings import RefundPolicy, StoreSettings

CHANGEABLE = (OrderStatus.received, OrderStatus.accepted)  # before preparation starts


def change_deadline(order: Order, window_hours: int) -> datetime:
    return order.slot_starts_at - timedelta(hours=window_hours)


def can_change(order: Order, window_hours: int, now: datetime) -> bool:
    """Customers can cancel or change an order until the window closes, but only before the bakery
    starts preparing it."""
    return order.status in CHANGEABLE and now <= change_deadline(order, window_hours)


def customer_refund(order: Order, settings: StoreSettings) -> int | None:
    """What the customer gets back if they cancel now. None: nothing was paid by card, so there is
    nothing to refund. 0: paid, but the policy keeps it."""
    if order.payment_method != PaymentMethod.card or order.payment_status != PaymentStatus.paid:
        return None
    if settings.refund_policy == RefundPolicy.full:
        return order.total
    if settings.refund_policy == RefundPolicy.percentage:
        return order.total * settings.refund_percentage // 100
    return 0


def policy_text(settings: StoreSettings) -> str:
    hours = settings.cancellation_window_hours
    when = (
        "until its time slot starts"
        if hours == 0
        else f"until {hours} hour{'s' if hours != 1 else ''} before its time slot"
    )
    text = f"You can cancel or change an order {when}, as long as we have not started preparing it."
    if settings.refund_policy == RefundPolicy.full:
        text += " A cancelled order paid by card is refunded in full."
    elif settings.refund_policy == RefundPolicy.percentage:
        text += f" A cancelled order paid by card is refunded {settings.refund_percentage}% of its total."
    else:
        text += " A cancelled order paid by card is not refunded."
    if settings.policy_note:
        text += " " + settings.policy_note
    return text
