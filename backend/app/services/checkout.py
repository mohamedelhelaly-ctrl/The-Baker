"""Place an order and, for card payments, open the payment page."""

import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.crud.order import order_crud
from app.models.order import Order, PaymentMethod
from app.models.user import User
from app.schemas.checkout import OrderCreate
from app.services.notifications import notifier
from app.services.orders import cancel_unpaid_order, place_order
from app.services.payments import get_payment_provider
from app.services.payments.base import PaymentProviderError
from app.services.payments.service import latest_pending_payment, start_card_payment

logger = logging.getLogger("baker.checkout")


async def place_and_pay(
    db: AsyncSession, data: OrderCreate, user: User | None, key: str, now: datetime
) -> tuple[Order, bool, str | None]:
    """Returns (order, created, payment_url). `payment_url` is set for card orders awaiting payment."""
    order, created = await place_order(db, data, user, key, now)
    if order.payment_method != PaymentMethod.card:
        return order, created, None

    provider = get_payment_provider()
    if not created:  # a retried request: hand back the same open payment page, if there is one
        payment = await latest_pending_payment(db, order.id, now)
        return order, False, payment.checkout_url if payment else None

    try:
        payment = await start_card_payment(db, order, provider, now)  # type: ignore[arg-type]
    except PaymentProviderError:
        logger.exception("Could not open a payment page for order %s", order.code)
        # Give the customer's slot back, and free the idempotency key so a retry creates a fresh order.
        locked = await order_crud.get_for_update(db, order.id)
        locked.idempotency_key = f"{key}:failed:{order.code}"[:64]
        await cancel_unpaid_order(db, locked, "We could not start the payment.")
        await db.commit()
        notifier.wake()
        raise ApiError(
            502,
            "payment_unavailable",
            "We could not start the card payment. Please try again, or choose cash on delivery.",
        ) from None
    return order, True, payment.checkout_url
