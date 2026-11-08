"""Quote, place and read orders. Guests may order; signed-in customers' orders are linked."""

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import store_now
from app.core.errors import ApiError
from app.core.rate_limit import limiter
from app.core.security import tracking_token, verify_tracking_token
from app.crud.order import order_crud
from app.database import get_db
from app.deps import get_optional_user
from app.models.user import User, UserRole
from app.schemas.checkout import (
    OrderCreate,
    OrderCreated,
    OrderRead,
    QuoteRequest,
    QuoteResponse,
)
from app.services.orders import place_order
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
    order, created = await place_order(db, body, user, idempotency_key, store_now())
    if not created:
        response.status_code = 200  # a retry of the same request: nothing new was created
    data = OrderRead.model_validate(order).model_dump()
    return OrderCreated(**data, tracking_token=tracking_token(order.code))


@router.get("/orders/{code}", response_model=OrderRead)
async def get_order(
    code: str,
    t: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    order = await order_crud.get_by_code(db, code.upper())
    allowed = order is not None and (
        verify_tracking_token(order.code, t)
        or (
            user is not None
            and (order.user_id == user.id or user.role in (UserRole.staff, UserRole.owner))
        )
    )
    if not allowed:
        # Same answer for "no such order" and "not yours", so codes cannot be probed.
        raise ApiError(404, "order_not_found", "We could not find that order.")
    return order
