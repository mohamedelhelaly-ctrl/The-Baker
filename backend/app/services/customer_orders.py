"""A customer cancelling or changing their own order (DESIGN.md §4.4, §4.5).

Both are only possible before preparation starts and until the owner's window closes. Everything
(capacity, the refund, the new totals, the email) happens in one transaction under the order's row
lock, so a customer's change cannot race a staff action or a payment event.
"""

from datetime import date, datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.crud.order import order_crud
from app.crud.store_settings import store_settings_crud
from app.models.order import (
    FulfilmentType,
    Order,
    OrderStatus,
    OrderStatusEvent,
    PaymentMethod,
    PaymentStatus,
)
from app.models.schedule import ProductDailyUsage, SlotDailyUsage
from app.schemas.checkout import CartLine, OrderRead, OrderUpdate, Problem
from app.services.notifications import enqueue, notifier, order_context
from app.services.orders import _lock_counters, change_status, release_order_capacity
from app.services.policies import can_change, change_deadline, customer_refund
from app.services.pricing import build_quote
from app.services.staff_orders import refund_card_payment


async def order_view(db: AsyncSession, order: Order, now: datetime) -> OrderRead:
    """The order as the customer sees it, with what they can still do."""
    settings = await store_settings_crud.get(db)
    view = OrderRead.model_validate(order)
    allowed = can_change(order, settings.cancellation_window_hours, now)
    view.can_change = allowed
    view.can_modify_until = (
        change_deadline(order, settings.cancellation_window_hours)
        if order.status in (OrderStatus.received, OrderStatus.accepted)
        else None
    )
    view.cancel_refund = customer_refund(order, settings) if allowed else None
    return view


async def _locked_changeable(db: AsyncSession, order_id: int, now: datetime):
    order = await order_crud.get_for_update(db, order_id)
    settings = await store_settings_crud.get(db)
    if order is None:
        await db.rollback()
        raise ApiError(404, "order_not_found", "We could not find that order.")
    if order.status not in (OrderStatus.received, OrderStatus.accepted):
        await db.rollback()
        raise ApiError(
            409,
            "cannot_change",
            "This order can no longer be changed because the bakery has started on it or it is closed.",
        )
    if not can_change(order, settings.cancellation_window_hours, now):
        await db.rollback()
        raise ApiError(
            409,
            "window_closed",
            "The time to change or cancel this order has passed. Please contact the bakery.",
        )
    return order, settings


async def cancel_order(
    db: AsyncSession, order_id: int, now: datetime, actor_id: int | None, reason: str | None
) -> Order:
    order, settings = await _locked_changeable(db, order_id, now)
    refund = customer_refund(order, settings)
    if refund:  # paid by card and the policy returns something
        await refund_card_payment(db, order, None if refund == order.total else refund)
    note = (reason or "").strip()
    text = "You cancelled this order." + (f" Your note: {note}" if note else "")
    change_status(order, OrderStatus.cancelled, actor_id=actor_id, reason=text)
    order.cancellation_reason = text
    await release_order_capacity(db, order)
    if refund is None:
        money = ""
    elif refund == 0:
        money = " Under our policy this order is not refunded."
    elif refund == order.total:
        money = " Your card payment will be refunded in full."
    else:
        money = " Part of your card payment will be refunded, as our policy says."
    await enqueue(
        db,
        key="order_cancelled",
        to_email=order.contact_email,
        context=order_context(order, {"reason": text + money}),
        order_id=order.id,
    )
    await db.commit()
    notifier.wake()
    return await order_crud.get_by_id(db, order_id)  # type: ignore[return-value]


def _fail(status: int, code: str, problems: list[Problem]) -> ApiError:
    fields: dict[str, str] = {}
    for p in problems:
        fields.setdefault(p.field, p.message)
    return ApiError(status, code, problems[0].message, fields)


async def modify_order(
    db: AsyncSession, order_id: int, data: OrderUpdate, now: datetime, actor_id: int | None
) -> Order:
    order, _ = await _locked_changeable(db, order_id, now)
    delivery = order.fulfilment_type == FulfilmentType.delivery
    if not delivery and (data.zone_id is not None or data.address is not None):
        await db.rollback()
        raise ApiError(422, "pickup_order", "This is a pickup order, so there is no address.")

    new_day: date = data.date or order.fulfilment_date
    new_slot = data.slot_id or order.time_slot_id
    zone_id = (data.zone_id or order.zone_id) if delivery else None
    if new_slot is None:
        await db.rollback()
        raise ApiError(
            409,
            "slot_gone",
            "The time slot of this order no longer exists. Please contact the bakery.",
        )
    schedule_changed = (new_day, new_slot) != (order.fulfilment_date, order.time_slot_id)
    notes = (
        order.customer_notes
        if data.customer_notes is None
        else (data.customer_notes.strip() or None)
    )
    address = (
        data.address.model_dump(exclude_none=True)
        if (delivery and data.address)
        else order.delivery_address
    )
    if (
        not schedule_changed
        and zone_id == order.zone_id
        and address == order.delivery_address
        and notes == order.customer_notes
    ):
        await db.rollback()
        raise ApiError(422, "no_changes", "Nothing was changed.")

    items = [
        CartLine(variant_id=i.variant_id, quantity=i.quantity, inscription=i.inscription)
        for i in order.items
        if i.variant_id is not None
    ]
    if len(items) != len(order.items):
        await db.rollback()
        raise ApiError(
            409, "item_gone", "An item in this order no longer exists. Please contact the bakery."
        )

    product_ids = sorted({i.product_id for i in order.items if i.product_id is not None})
    if schedule_changed:
        # Lock the old and the new day in date order, so two customers swapping slots cannot deadlock.
        targets = sorted({(order.fulfilment_date, order.time_slot_id), (new_day, new_slot)})
        for day, slot_id in targets:
            await _lock_counters(db, product_ids, slot_id, day)
        await release_order_capacity(db, order)  # the order's own units must not count against it

    quote = await build_quote(
        db,
        items=items,
        fulfilment_type=order.fulfilment_type.value,
        zone_id=zone_id,
        day=new_day if schedule_changed else None,
        slot_id=new_slot if schedule_changed else None,
        now=now,
    )
    # Prices stay as ordered, so the delivery minimum is checked against the order's own subtotal.
    problems = [
        p
        for p in quote.response.problems
        if p.code != "below_minimum" and (schedule_changed or p.field != "items")
    ]
    zone = quote.zone
    if delivery and zone is not None and order.subtotal < zone.min_order_amount:
        problems.append(
            Problem(
                field="zone",
                code="below_minimum",
                message=f"Delivery to {zone.name} needs a larger order. Choose another area or pickup.",
            )
        )
    if delivery and zone is None and not problems:
        problems.append(
            Problem(
                field="zone", code="zone_unavailable", message="We do not deliver to that area."
            )
        )
    if schedule_changed and quote.slot_option is None and not problems:
        problems.append(
            Problem(field="slot", code="slot_unavailable", message="Choose an available time slot.")
        )
    if problems:
        await db.rollback()
        raise _fail(409 if schedule_changed else 422, "cannot_change_to_that", problems)

    new_fee = zone.fee if delivery and zone else 0
    if (
        order.payment_method == PaymentMethod.card
        and order.payment_status == PaymentStatus.paid
        and new_fee != order.delivery_fee
    ):
        await db.rollback()
        raise ApiError(
            422,
            "fee_differs",
            "That area has a different delivery fee. Choose an area with the same fee, or cancel and order again.",
            {"zone": "Choose an area with the same delivery fee."},
        )

    if schedule_changed:
        for pid, qty in quote.quantities.items():
            await db.execute(
                update(ProductDailyUsage)
                .where(ProductDailyUsage.product_id == pid, ProductDailyUsage.date == new_day)
                .values(reserved_qty=ProductDailyUsage.reserved_qty + qty)
            )
        await db.execute(
            update(SlotDailyUsage)
            .where(SlotDailyUsage.time_slot_id == new_slot, SlotDailyUsage.date == new_day)
            .values(reserved_orders=SlotDailyUsage.reserved_orders + 1)
        )
        option = quote.slot_option
        order.fulfilment_date = new_day
        order.time_slot_id = new_slot
        order.slot_starts_at, order.slot_ends_at = option.starts_at, option.ends_at
    if delivery:
        order.zone_id, order.zone_name = zone.id, zone.name
        order.delivery_address = address
        order.delivery_fee = new_fee
        order.total = order.subtotal + new_fee
    order.customer_notes = notes
    order.events.append(
        OrderStatusEvent(
            from_status=order.status,
            to_status=order.status,
            actor_user_id=actor_id,
            reason="The customer changed the order.",
        )
    )
    await enqueue(
        db,
        key="order_modified",
        to_email=order.contact_email,
        context=order_context(order),
        order_id=order.id,
    )
    await db.commit()
    notifier.wake()
    return await order_crud.get_by_id(db, order_id)  # type: ignore[return-value]
