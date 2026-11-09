"""Quote, place and read orders. Guests may order; signed-in customers' orders are linked."""

from datetime import timedelta

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import store_now
from app.core.errors import ApiError
from app.core.rate_limit import limiter
from app.core.security import tracking_token, verify_tracking_token
from app.crud.order import order_crud
from app.database import get_db
from app.deps import get_optional_user
from app.models.order import OrderStatus, PaymentMethod
from app.models.user import User, UserRole
from app.schemas.checkout import (
    CustomerCancel,
    OrderCreate,
    OrderCreated,
    OrderRead,
    OrderUpdate,
    PaymentLink,
    QuoteRequest,
    QuoteResponse,
)
from app.services.checkout import place_and_pay
from app.services.customer_orders import cancel_order, modify_order, order_view
from app.services.payments import get_payment_provider
from app.services.payments.base import PaymentProviderError
from app.services.payments.service import ORDER_EXPIRY_MINUTES, start_card_payment
from app.services.pricing import build_quote

router = APIRouter(tags=["checkout"])


@router.post("/checkout/quote", response_model=QuoteResponse)
@limiter.limit("60/minute")
async def quote(request: Request, body: QuoteRequest, db: AsyncSession = Depends(get_db)):
    result = await build_quote(
        db,
        items=body.items,
        fulfilment_type=body.fulfilment_type,
        zone_id=body.zone_id,
        day=body.date,
        slot_id=body.slot_id,
        now=store_now(),
    )
    return result.response


@router.post("/orders", response_model=OrderCreated, status_code=201)
@limiter.limit("10/minute")
async def create_order(
    request: Request,
    response: Response,
    body: OrderCreate,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=64),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    order, created, payment_url = await place_and_pay(db, body, user, idempotency_key, store_now())
    if not created:
        response.status_code = 200  # a retry of the same request: nothing new was created
    data = (await order_view(db, order, store_now())).model_dump()
    return OrderCreated(**data, tracking_token=tracking_token(order.code), payment_url=payment_url)


async def _visible_order(db: AsyncSession, code: str, token: str | None, user: User | None):
    order = await order_crud.get_by_code(db, code.upper())
    allowed = order is not None and (
        verify_tracking_token(order.code, token)
        or (
            user is not None
            and (order.user_id == user.id or user.role in (UserRole.staff, UserRole.owner))
        )
    )
    if not allowed:
        # Same answer for "no such order" and "not yours", so codes cannot be probed.
        raise ApiError(404, "order_not_found", "We could not find that order.")
    return order


@router.get("/orders/{code}", response_model=OrderRead)
async def get_order(
    code: str,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    return await order_view(db, await _visible_order(db, code, t, user), store_now())


async def _own_order(db: AsyncSession, code: str, token: str | None, user: User | None):
    """Changing an order is for the customer only: the token holder or the signed-in owner of it."""
    order = await order_crud.get_by_code(db, code.upper())
    allowed = order is not None and (
        verify_tracking_token(order.code, token)
        or (user is not None and order.user_id is not None and order.user_id == user.id)
    )
    if not allowed:
        raise ApiError(404, "order_not_found", "We could not find that order.")
    return order


@router.patch("/orders/{code}", response_model=OrderRead)
@limiter.limit("20/minute")
async def update_order(
    request: Request,
    code: str,
    body: OrderUpdate,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    order = await _own_order(db, code, t, user)
    now = store_now()
    updated = await modify_order(db, order.id, body, now, user.id if user else None)
    return await order_view(db, updated, now)


@router.post("/orders/{code}/cancel", response_model=OrderRead)
@limiter.limit("20/minute")
async def customer_cancel(
    request: Request,
    code: str,
    body: CustomerCancel | None = None,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    order = await _own_order(db, code, t, user)
    now = store_now()
    reason = body.reason if body else None
    cancelled = await cancel_order(db, order.id, now, user.id if user else None, reason)
    return await order_view(db, cancelled, now)


@router.post("/orders/{code}/payment-link", response_model=PaymentLink)
@limiter.limit("20/minute")
async def payment_link(
    request: Request,
    code: str,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """A (new) payment page for a card order that is still waiting to be paid."""
    order = await _visible_order(db, code, t, user)
    now = store_now()
    if order.status != OrderStatus.pending_payment or order.payment_method != PaymentMethod.card:
        raise ApiError(409, "not_awaiting_payment", "This order is not waiting for a payment.")
    if now > order.placed_at + timedelta(minutes=ORDER_EXPIRY_MINUTES):
        raise ApiError(409, "payment_expired", "The time to pay for this order has run out.")
    provider = get_payment_provider()
    if provider is None:
        raise ApiError(422, "card_unavailable", "Card payment is not available right now.")
    try:
        payment = await start_card_payment(db, order, provider, now)
    except PaymentProviderError:
        raise ApiError(
            502, "payment_unavailable", "We could not open the payment page. Please try again."
        ) from None
    return PaymentLink(payment_url=payment.checkout_url)
