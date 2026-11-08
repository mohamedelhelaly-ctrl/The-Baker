"""Placing orders and keeping capacity honest (DESIGN.md §4.2, §6).

Overselling is prevented by counter rows (`product_daily_usage`, `slot_daily_usage`) that are
locked with SELECT ... FOR UPDATE inside the order transaction. After the locks are held the
quote is computed again, so the decision is made on the latest committed numbers. Locks are
always taken in the same order (products by id, then the slot) so two checkouts cannot deadlock.
"""

import secrets
from datetime import date, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.crud.order import order_crud
from app.models.order import (
    FulfilmentType,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusEvent,
    PaymentMethod,
    PaymentStatus,
)
from app.models.schedule import ProductDailyUsage, SlotDailyUsage
from app.models.user import User
from app.schemas.checkout import OrderCreate, Problem
from app.services.notifications import enqueue, notifier, order_context
from app.services.payment_options import available_methods
from app.services.pricing import Quote, build_quote

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I: easy to read out loud


def new_order_code() -> str:
    return "BK-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


async def _lock_counters(db: AsyncSession, product_ids: list[int], slot_id: int, day: date) -> None:
    """Ensure a counter row exists per product and for the slot, then lock them in a fixed order."""
    for pid in sorted(product_ids):
        await db.execute(
            pg_insert(ProductDailyUsage)
            .values(product_id=pid, date=day, reserved_qty=0)
            .on_conflict_do_nothing(index_elements=["product_id", "date"])
        )
    await db.execute(
        pg_insert(SlotDailyUsage)
        .values(time_slot_id=slot_id, date=day, reserved_orders=0)
        .on_conflict_do_nothing(index_elements=["time_slot_id", "date"])
    )
    if product_ids:
        await db.execute(
            select(ProductDailyUsage.id)
            .where(ProductDailyUsage.product_id.in_(product_ids), ProductDailyUsage.date == day)
            .order_by(ProductDailyUsage.product_id)
            .with_for_update()
        )
    await db.execute(
        select(SlotDailyUsage.id)
        .where(SlotDailyUsage.time_slot_id == slot_id, SlotDailyUsage.date == day)
        .with_for_update()
    )


def _first_problems(problems: list[Problem]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for p in problems:
        fields.setdefault(p.field, p.message)
    return fields


def _problem_error(status: int, code: str, problems: list[Problem]) -> ApiError:
    return ApiError(status, code, problems[0].message, _first_problems(problems))


async def place_order(
    db: AsyncSession, data: OrderCreate, user: User | None, idempotency_key: str, now: datetime
) -> tuple[Order, bool]:
    """Returns (order, created). A repeated Idempotency-Key returns the original order."""
    existing = await order_crud.get_by_key(db, idempotency_key)
    if existing is not None:
        return existing, False

    methods = await available_methods(db)
    if data.payment_method not in methods:
        if data.payment_method == "card":
            raise ApiError(
                422,
                "card_unavailable",
                "Card payment is not available right now. Please choose cash on delivery.",
            )
        raise ApiError(
            422,
            "cod_unavailable",
            "Cash on delivery is not available right now. Please pay by card.",
        )

    quote_args = {
        "items": data.items,
        "fulfilment_type": data.fulfilment_type,
        "zone_id": data.zone_id,
        "day": data.date,
        "slot_id": data.slot_id,
        "now": now,
    }
    quote = await build_quote(db, **quote_args)  # cheap early exit, no locks yet
    if not quote.response.ready:
        raise _problem_error(
            422,
            "checkout_invalid",
            quote.response.problems
            or [Problem(field="items", code="not_ready", message="Your order is incomplete.")],
        )

    await _lock_counters(db, list(quote.quantities), data.slot_id, data.date)
    quote = await build_quote(db, **quote_args)  # decided again on the latest numbers
    if not quote.response.ready:
        await db.rollback()
        raise _problem_error(409, "no_longer_available", quote.response.problems)

    for pid, qty in quote.quantities.items():
        await db.execute(
            update(ProductDailyUsage)
            .where(ProductDailyUsage.product_id == pid, ProductDailyUsage.date == data.date)
            .values(reserved_qty=ProductDailyUsage.reserved_qty + qty)
        )
    await db.execute(
        update(SlotDailyUsage)
        .where(SlotDailyUsage.time_slot_id == data.slot_id, SlotDailyUsage.date == data.date)
        .values(reserved_orders=SlotDailyUsage.reserved_orders + 1)
    )

    order = _build_order(data, user, idempotency_key, quote, now)
    db.add(order)
    try:
        # Flush first: taking the unique idempotency key is what makes a racing duplicate fail here,
        # inside this block, rather than somewhere later (queuing an email also triggers a flush).
        await db.flush()
        if data.payment_method == "cod":  # card orders are confirmed when the payment succeeds
            await enqueue(
                db,
                key="order_confirmed",
                to_email=order.contact_email,
                context=order_context(order),
                order_id=order.id,
            )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Two identical requests raced: the other one won. Return its order.
        winner = await order_crud.get_by_key(db, idempotency_key)
        if winner is not None:
            return winner, False
        raise
    notifier.wake()
    return await order_crud.get_by_code(db, order.code), True  # type: ignore[return-value]


def _build_order(
    data: OrderCreate, user: User | None, key: str, quote: Quote, now: datetime
) -> Order:
    r = quote.response
    card = data.payment_method == "card"
    option = quote.slot_option
    order = Order(
        code=new_order_code(),
        idempotency_key=key,
        user_id=user.id if user else None,
        contact_name=data.contact.name,
        contact_email=data.contact.email.lower(),
        contact_phone=data.contact.phone.strip(),
        fulfilment_type=FulfilmentType(data.fulfilment_type),
        fulfilment_date=data.date,
        time_slot_id=quote.slot.id,
        slot_starts_at=option.starts_at,
        slot_ends_at=option.ends_at,
        zone_id=quote.zone.id if quote.zone else None,
        zone_name=quote.zone.name if quote.zone else None,
        delivery_address=data.address.model_dump(exclude_none=True)
        if data.fulfilment_type == "delivery" and data.address
        else None,
        subtotal=r.subtotal,
        delivery_fee=r.delivery_fee,
        total=r.total,
        currency=r.currency,
        payment_method=PaymentMethod(data.payment_method),
        payment_status=PaymentStatus.pending if card else PaymentStatus.unpaid,
        # Cash orders go straight to staff. Card orders wait for the payment confirmation.
        status=OrderStatus.pending_payment if card else OrderStatus.received,
        customer_notes=(data.customer_notes or "").strip() or None,
        placed_at=now,
    )
    order.items = [
        OrderItem(
            product_id=line.product.id,
            variant_id=line.variant.id,
            product_name=line.product.name,
            variant_name=line.variant.name,
            unit_price=line.unit_price,
            quantity=line.line.quantity,
            line_total=line.line_total,
            inscription=line.line.inscription,
        )
        for line in quote.resolved
    ]
    order.events = [
        OrderStatusEvent(
            from_status=None,
            to_status=OrderStatus.pending_payment if card else OrderStatus.received,
            actor_user_id=user.id if user else None,
        )
    ]
    return order


async def release_order_capacity(db: AsyncSession, order: Order) -> None:
    """Give an order's reserved capacity back (rejection, cancellation, expired payment).
    The caller commits, so the release and the status change are one transaction."""
    per_product: dict[int, int] = {}
    for item in order.items:
        if item.product_id is not None:
            per_product[item.product_id] = per_product.get(item.product_id, 0) + item.quantity
    if order.time_slot_id is None:
        return
    await _lock_counters(db, list(per_product), order.time_slot_id, order.fulfilment_date)
    for pid, qty in per_product.items():
        await db.execute(
            update(ProductDailyUsage)
            .where(
                ProductDailyUsage.product_id == pid, ProductDailyUsage.date == order.fulfilment_date
            )
            .values(reserved_qty=ProductDailyUsage.reserved_qty - qty)
        )
    await db.execute(
        update(SlotDailyUsage)
        .where(
            SlotDailyUsage.time_slot_id == order.time_slot_id,
            SlotDailyUsage.date == order.fulfilment_date,
        )
        .values(reserved_orders=SlotDailyUsage.reserved_orders - 1)
    )


def change_status(
    order: Order, to: OrderStatus, *, actor_id: int | None = None, reason: str | None = None
) -> None:
    """Move an order to a new status and record it on the timeline. The caller commits."""
    order.events.append(
        OrderStatusEvent(
            from_status=order.status, to_status=to, actor_user_id=actor_id, reason=reason
        )
    )
    order.status = to


async def cancel_unpaid_order(db: AsyncSession, order: Order, reason: str) -> None:
    """A card order that was never paid: cancel it, free its capacity and tell the customer.
    The caller commits, so all of this is one transaction."""
    change_status(order, OrderStatus.cancelled, reason=reason)
    order.cancellation_reason = reason
    order.payment_status = PaymentStatus.failed
    await release_order_capacity(db, order)
    await enqueue(
        db,
        key="order_cancelled",
        to_email=order.contact_email,
        context=order_context(order, {"reason": reason}),
        order_id=order.id,
    )
