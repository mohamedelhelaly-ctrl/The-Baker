"""What happens when money moves (DESIGN.md §6.2).

A card order is placed first (capacity reserved, status `pending_payment`), then the customer
pays on the provider's page. The provider's webhook, verified and de-duplicated, is the only
thing that marks an order paid. Unpaid orders expire and give their capacity back.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import tracking_token
from app.crud.order import order_crud
from app.models.order import Order, OrderStatus, PaymentStatus
from app.models.payment import Payment, PaymentRecordStatus, ProcessedWebhookEvent
from app.services.notifications import enqueue, notifier, order_context
from app.services.orders import cancel_unpaid_order, change_status
from app.services.payments.base import PaymentEvent, PaymentProvider, PaymentProviderError

logger = logging.getLogger("baker.payments")

SESSION_MINUTES = 31  # how long an open payment page is reused before a fresh one is created
ORDER_EXPIRY_MINUTES = (
    35  # unpaid card orders are cancelled after this, so capacity is not held forever
)


def _urls(order: Order) -> tuple[str, str]:
    base = f"{get_settings().frontend_url.rstrip('/')}/track/{order.code}?t={tracking_token(order.code)}"
    return f"{base}&paid=1", f"{base}&cancelled=1"


async def latest_pending_payment(db: AsyncSession, order_id: int, now: datetime) -> Payment | None:
    """A payment page that is still open (its session has not run out)."""
    cutoff = now - timedelta(minutes=SESSION_MINUTES - 1)
    return (
        await db.execute(
            select(Payment)
            .where(
                Payment.order_id == order_id,
                Payment.status == PaymentRecordStatus.pending,
                Payment.created_at > cutoff,
            )
            .order_by(Payment.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def start_card_payment(
    db: AsyncSession, order: Order, provider: PaymentProvider, now: datetime
) -> Payment:
    """Open (or reuse) a payment page for the order. The provider call happens with no row locks held."""
    existing = await latest_pending_payment(db, order.id, now)
    if existing is not None:
        return existing
    success_url, cancel_url = _urls(order)
    session = await provider.create_checkout(
        order=order,
        success_url=success_url,
        cancel_url=cancel_url,
        expires_at=now + timedelta(minutes=SESSION_MINUTES),
    )
    payment = Payment(
        order_id=order.id,
        provider=provider.name,
        provider_ref=session.ref,
        checkout_url=session.url,
        amount=order.total,
        status=PaymentRecordStatus.pending,
        created_at=now,  # the app clock, so "is this page still open?" uses one consistent time source
    )
    db.add(payment)
    await db.commit()
    return payment


async def refund_payment(
    db: AsyncSession,
    provider: PaymentProvider,
    order: Order,
    payment: Payment,
    amount: int | None = None,
) -> None:
    """Refund through the provider and record it. The caller commits."""
    amount = payment.amount - payment.refunded_amount if amount is None else amount
    await provider.refund(
        session_ref=payment.provider_ref,
        payment_ref=payment.provider_payment_id,
        amount=amount,
        can_void=payment.refunded_amount == 0 and amount == payment.amount,  # same-day full refunds
    )
    payment.refunded_amount += amount
    full = payment.refunded_amount >= payment.amount
    payment.status = (
        PaymentRecordStatus.refunded if full else PaymentRecordStatus.partially_refunded
    )
    order.payment_status = PaymentStatus.refunded if full else PaymentStatus.partially_refunded


async def apply_event(db: AsyncSession, provider: PaymentProvider, event: PaymentEvent) -> str:
    """Handle one provider event. Safe to call twice with the same event. Returns what happened."""
    if event.kind == "ignored":
        return "ignored"
    try:  # de-duplicate: the unique key makes a second delivery fail here
        db.add(ProcessedWebhookEvent(provider=provider.name, event_id=event.event_id))
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return "duplicate"

    payment = None
    if event.session_ref:
        payment = (
            await db.execute(select(Payment).where(Payment.provider_ref == event.session_ref))
        ).scalar_one_or_none()
    if payment is None:
        await db.commit()
        logger.warning(
            "Payment event %s matches no payment (session %s)", event.event_id, event.session_ref
        )
        return "unknown_payment"

    order = await order_crud.get_for_update(db, payment.order_id)  # serialises with expiry
    if event.kind == "paid":
        return await _on_paid(db, provider, order, payment, event)
    return await _on_expired(db, order, payment)


async def _on_paid(
    db: AsyncSession, provider: PaymentProvider, order: Order, payment: Payment, event: PaymentEvent
) -> str:
    payment.provider_payment_id = event.payment_ref or payment.provider_payment_id
    already_paid = order.payment_status == PaymentStatus.paid
    if order.status == OrderStatus.pending_payment and not already_paid:
        payment.status = PaymentRecordStatus.paid
        order.payment_status = PaymentStatus.paid
        change_status(order, OrderStatus.received, reason="Payment received")
        await enqueue(
            db,
            key="order_confirmed",
            to_email=order.contact_email,
            context=order_context(order),
            order_id=order.id,
        )
        await db.commit()
        notifier.wake()
        return "paid"

    # Money arrived for an order that cannot use it (it expired, or another payment already covered
    # it). Give it straight back rather than keep it.
    payment.status = PaymentRecordStatus.paid
    keep_status = order.payment_status
    try:
        await refund_payment(db, provider, order, payment)
    except PaymentProviderError:
        logger.exception(
            "Could not refund payment %s for order %s; refund it manually", payment.id, order.code
        )
        await db.commit()
        return "refund_failed"
    if already_paid:
        order.payment_status = keep_status  # the order itself is still paid by the first payment
    elif order.status == OrderStatus.cancelled:
        await enqueue(
            db,
            key="order_cancelled",
            to_email=order.contact_email,
            order_id=order.id,
            context=order_context(
                order,
                {"reason": "Your payment arrived after the order expired, so it was refunded."},
            ),
        )
        notifier.wake()
    await db.commit()
    return "refunded_late_payment"


async def _on_expired(db: AsyncSession, order: Order, payment: Payment) -> str:
    if payment.status == PaymentRecordStatus.pending:
        payment.status = PaymentRecordStatus.failed
        payment.failure_reason = "Checkout expired"
    other_open = (
        await db.execute(
            select(Payment.id).where(
                Payment.order_id == order.id,
                Payment.id != payment.id,
                Payment.status == PaymentRecordStatus.pending,
            )
        )
    ).first()
    if order.status == OrderStatus.pending_payment and other_open is None:
        await cancel_unpaid_order(db, order, "The payment was not completed in time.")
        await db.commit()
        notifier.wake()
        return "cancelled"
    await db.commit()
    return "expired_noop"


async def expire_unpaid_orders(
    db: AsyncSession, provider: PaymentProvider | None, now: datetime
) -> int:
    """Cancel card orders left unpaid too long and release their capacity. Safe to run often."""
    cutoff = now - timedelta(minutes=ORDER_EXPIRY_MINUTES)
    ids = (
        (
            await db.execute(
                select(Order.id)
                .where(Order.status == OrderStatus.pending_payment, Order.placed_at < cutoff)
                .order_by(Order.id)
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    cancelled = 0
    for order_id in ids:
        order = await order_crud.get_for_update(db, order_id)
        if order is None or order.status != OrderStatus.pending_payment:
            await db.rollback()
            continue
        pending = (
            (
                await db.execute(
                    select(Payment).where(
                        Payment.order_id == order.id, Payment.status == PaymentRecordStatus.pending
                    )
                )
            )
            .scalars()
            .all()
        )
        for payment in pending:
            if provider is not None and payment.provider_ref:
                try:  # close the payment page so it cannot be paid after we gave up
                    await provider.expire_checkout(payment.provider_ref)
                except PaymentProviderError:
                    logger.warning(
                        "Could not expire session %s; a late payment will be refunded",
                        payment.provider_ref,
                    )
            payment.status = PaymentRecordStatus.failed
            payment.failure_reason = "Order expired"
        await cancel_unpaid_order(db, order, "The payment was not completed in time.")
        await db.commit()
        cancelled += 1
    if cancelled:
        notifier.wake()
    return cancelled
