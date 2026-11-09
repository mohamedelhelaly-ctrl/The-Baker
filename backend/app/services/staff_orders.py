"""What staff do with an order (DESIGN.md §6, requirements S1.2 to S1.5).

Every action locks the order row first, so two staff members (or staff and a payment event)
cannot act on it at the same time. Giving capacity back, refunding a card payment and queuing the
customer's email happen in the same transaction as the status change. If a refund cannot be made
nothing changes and the person is told, so an order is never cancelled while the money is kept.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.crud.order import order_crud
from app.models.order import (
    Order,
    OrderMessage,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
)
from app.models.payment import Payment, PaymentRecordStatus
from app.models.user import User
from app.services.notifications import enqueue, notifier, order_context
from app.services.orders import (
    ACTIVE_STATUSES,
    FINISHED_STATUSES,
    STATUS_TEXT,
    change_status,
    find_transition,
    release_order_capacity,
)
from app.services.payments import get_payment_provider
from app.services.payments.base import PaymentProviderError
from app.services.payments.service import refund_payment

logger = logging.getLogger("baker.staff")


async def _locked(db: AsyncSession, order_id: int) -> Order:
    order = await order_crud.get_for_update(db, order_id)
    if order is None or order.status == OrderStatus.pending_payment:
        # An unpaid card order is not the bakery's to act on, so it looks like it does not exist.
        await db.rollback()
        raise ApiError(404, "order_not_found", "We could not find that order.")
    return order


async def _refund_card_payment(db: AsyncSession, order: Order) -> None:
    if order.payment_method != PaymentMethod.card or order.payment_status != PaymentStatus.paid:
        return
    paid = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.order_id == order.id, Payment.status == PaymentRecordStatus.paid
                )
            )
        )
        .scalars()
        .all()
    )
    provider = get_payment_provider()
    try:
        if provider is None:
            raise PaymentProviderError("No payment provider is configured")
        for payment in paid:
            await refund_payment(db, provider, order, payment)
    except PaymentProviderError as exc:
        logger.exception("Refund failed for order %s", order.code)
        await db.rollback()
        reason = str(exc)[:200]  # the provider's own words (no secrets), so staff can see why
        raise ApiError(
            502,
            "refund_failed",
            f"The card refund did not go through, so nothing was changed. Provider said: {reason}",
        ) from None


async def _close(db: AsyncSession, order: Order, to: OrderStatus, reason: str, actor: User) -> None:
    """Reject or cancel: refund, free the slot, record the reason, tell the customer."""
    await _refund_card_payment(db, order)
    change_status(order, to, actor_id=actor.id, reason=reason)
    if to == OrderStatus.rejected:
        order.rejection_reason = reason
    else:
        order.cancellation_reason = reason
    order.is_delayed = False
    order.delay_note = None
    await release_order_capacity(db, order)
    refunded = order.payment_method == PaymentMethod.card and order.payment_status in (
        PaymentStatus.refunded,
        PaymentStatus.partially_refunded,
    )
    await enqueue(
        db,
        key="order_rejected" if to == OrderStatus.rejected else "order_cancelled",
        to_email=order.contact_email,
        context=order_context(
            order, {"reason": reason + (" Your payment has been refunded." if refunded else "")}
        ),
        order_id=order.id,
    )


async def change_order_status(
    db: AsyncSession, order_id: int, to: OrderStatus, actor: User, reason: str | None = None
) -> Order:
    order = await _locked(db, order_id)
    try:
        transition = find_transition(order, to, actor.role)
    except ApiError:
        await db.rollback()
        raise
    reason = (reason or "").strip() or None
    if transition.needs_reason:
        if reason is None:
            await db.rollback()
            raise ApiError(
                422,
                "reason_required",
                "Please give the customer a reason.",
                {"reason": "Required."},
            )
        await _close(db, order, to, reason, actor)
    else:
        change_status(order, to, actor_id=actor.id)
        if to in FINISHED_STATUSES:
            order.is_delayed = False
            order.delay_note = None
        await enqueue(
            db,
            key="order_accepted" if to == OrderStatus.accepted else "status_changed",
            to_email=order.contact_email,
            context=order_context(order, {"status_text": STATUS_TEXT[to]}),
            order_id=order.id,
        )
    await db.commit()
    notifier.wake()
    return await _reload(db, order_id)


async def set_delay(db: AsyncSession, order_id: int, note: str, actor: User) -> Order:
    order = await _locked(db, order_id)
    if order.status not in ACTIVE_STATUSES:
        await db.rollback()
        raise ApiError(409, "not_active", "Only an order that is still open can be marked late.")
    order.is_delayed = True
    order.delay_note = note
    await enqueue(
        db,
        key="order_delayed",
        to_email=order.contact_email,
        context=order_context(order, {"delay_note": note}),
        order_id=order.id,
    )
    await db.commit()
    notifier.wake()
    return await _reload(db, order_id)


async def clear_delay(db: AsyncSession, order_id: int, actor: User) -> Order:
    order = await _locked(db, order_id)
    order.is_delayed = False
    order.delay_note = None
    await db.commit()
    return await _reload(db, order_id)


async def send_message(db: AsyncSession, order_id: int, body: str, actor: User) -> Order:
    order = await _locked(db, order_id)
    order.messages.append(OrderMessage(author_user_id=actor.id, body=body))
    await enqueue(
        db,
        key="staff_message",
        to_email=order.contact_email,
        context=order_context(order, {"message": body}),
        order_id=order.id,
    )
    await db.commit()
    notifier.wake()
    return await _reload(db, order_id)


MARKABLE = (
    OrderStatus.accepted,
    OrderStatus.preparing,
    OrderStatus.ready,
    OrderStatus.out_for_delivery,
    OrderStatus.delivered,
    OrderStatus.picked_up,
)


def can_mark_paid(order: Order) -> bool:
    return (
        order.payment_method == PaymentMethod.cod
        and order.payment_status == PaymentStatus.unpaid
        and order.status in (OrderStatus.received, *MARKABLE)
    )


async def mark_paid(db: AsyncSession, order_id: int, actor: User) -> Order:
    """Cash collected on delivery or pickup."""
    order = await _locked(db, order_id)
    if not can_mark_paid(order):
        await db.rollback()
        raise ApiError(409, "cannot_mark_paid", "This order is not waiting for a cash payment.")
    order.payment_status = PaymentStatus.paid
    await db.commit()
    return await _reload(db, order_id)


async def _reload(db: AsyncSession, order_id: int) -> Order:
    return await order_crud.get_by_id(db, order_id)  # type: ignore[return-value]
