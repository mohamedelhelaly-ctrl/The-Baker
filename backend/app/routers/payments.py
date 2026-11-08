"""Payment provider callbacks, plus the demo payment page's backend."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.rate_limit import limiter
from app.core.security import verify_tracking_token
from app.crud.order import order_crud
from app.database import get_db
from app.models.order import OrderStatus
from app.services.payments import get_payment_provider
from app.services.payments.base import InvalidSignature, PaymentEvent
from app.services.payments.service import apply_event, latest_pending_payment

router = APIRouter(tags=["payments"])


@router.post("/payments/paymob/webhook")
async def paymob_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Paymob's "Transaction Processed Callback". The signature (query parameter `hmac`) is
    verified and each transaction is processed once. Valid callbacks we do not act on (declined
    attempts, refunds, card tokens) still get a 200 so Paymob does not retry them."""
    provider = get_payment_provider()
    if provider is None or provider.name != "paymob":
        raise ApiError(404, "not_found", "Not found.")
    payload = await request.body()
    signature = request.query_params.get("hmac") or request.headers.get("hmac")
    try:
        event = provider.parse_webhook(payload, signature)
    except InvalidSignature:
        raise ApiError(400, "invalid_signature", "The callback signature is not valid.") from None
    outcome = await apply_event(db, provider, event)
    return {"received": True, "outcome": outcome}


class FakeOutcome(BaseModel):
    outcome: Literal["paid", "expired"]


@router.post("/payments/fake/{code}/complete")
@limiter.limit("30/minute")
async def fake_payment_complete(
    request: Request,
    code: str,
    body: FakeOutcome,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    """Development and demos only: stands in for the provider's hosted page by feeding the same
    event handler the real webhook uses. Returns 404 unless the fake provider is active."""
    provider = get_payment_provider()
    order = await order_crud.get_by_code(db, code.upper())
    if (
        provider is None
        or provider.name != "fake"
        or order is None
        or not verify_tracking_token(order.code, t)
    ):
        raise ApiError(404, "not_found", "Not found.")
    if order.status != OrderStatus.pending_payment:
        raise ApiError(409, "not_awaiting_payment", "This order is not waiting for a payment.")
    payment = await latest_pending_payment(db, order.id, utcnow())
    if payment is None:
        raise ApiError(409, "no_open_payment", "There is no open payment page for this order.")
    event = PaymentEvent(
        event_id=f"fake_{uuid.uuid4().hex}",
        kind=body.outcome,
        order_code=order.code,
        session_ref=payment.provider_ref,
        payment_ref=f"fake_pi_{uuid.uuid4().hex[:10]}",
        amount=order.total,
    )
    return {"outcome": await apply_event(db, provider, event)}
