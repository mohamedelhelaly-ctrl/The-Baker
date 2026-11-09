"""The staff order queue (module: orders_queue; DESIGN.md §8.2)."""

import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import store_now
from app.core.errors import ApiError
from app.crud.order import order_crud
from app.database import get_db
from app.deps import require_module
from app.models.order import FulfilmentType, Order, OrderStatus
from app.models.user import User
from app.schemas.checkout import OrderRead
from app.schemas.common import Page
from app.schemas.staff import (
    ActionRead,
    DelayRequest,
    MessageRead,
    MessageRequest,
    PrepLine,
    PrepMessage,
    PrepSheet,
    QueueSummary,
    Reason,
    StaffOrderRead,
    StaffOrderRow,
    TransitionRequest,
)
from app.services import staff_orders
from app.services.orders import ACTIVE_STATUSES, FINISHED_STATUSES, next_transitions

router = APIRouter(prefix="/staff", tags=["staff: orders"])
staff_user = Depends(require_module("orders_queue", write=True))
GROUPS = {"active": ACTIVE_STATUSES, "finished": FINISHED_STATUSES}


def _statuses(value: str | None) -> tuple[OrderStatus, ...] | None:
    if not value:
        return None
    if value in GROUPS:
        return GROUPS[value]
    try:
        return (OrderStatus(value),)
    except ValueError:
        raise ApiError(
            422, "validation_error", "Unknown status.", {"status": "Unknown status."}
        ) from None


def _row(order: Order) -> StaffOrderRow:
    row = StaffOrderRow.model_validate(order, from_attributes=True)
    row.item_count = sum(i.quantity for i in order.items)
    return row


def _detail(order: Order, user: User) -> StaffOrderRead:
    data = OrderRead.model_validate(order).model_dump()
    return StaffOrderRead(
        **data,
        id=order.id,
        actions=[
            ActionRead(to=t.target, needs_reason=t.needs_reason)
            for t in next_transitions(order, user.role)
        ],
        messages=[MessageRead.model_validate(m) for m in order.messages],
        can_mark_paid=staff_orders.can_mark_paid(order),
        can_delay=order.status in ACTIVE_STATUSES,
    )


@router.get("/orders", response_model=Page[StaffOrderRow])
async def list_orders(
    date: dt.date | None = None,
    status: str | None = Query(default=None, max_length=30),
    fulfilment: FulfilmentType | None = None,
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = staff_user,
):
    orders, total = await order_crud.list_for_staff(
        db,
        day=date,
        statuses=_statuses(status),
        fulfilment=fulfilment.value if fulfilment else None,
        q=q,
        page=page,
        page_size=page_size,
    )
    rows = [_row(o) for o in orders]
    return Page[StaffOrderRow].build(rows, total, page, page_size)


@router.get("/orders/summary", response_model=QueueSummary)
async def summary(
    date: dt.date | None = None, db: AsyncSession = Depends(get_db), _: User = staff_user
):
    counts, delayed = await order_crud.status_counts(db, date)
    full = {s: counts.get(s, 0) for s in OrderStatus if s != OrderStatus.pending_payment}
    return QueueSummary(counts=full, total=sum(full.values()), delayed=delayed)


async def _get(db: AsyncSession, order_id: int) -> Order:
    order = await order_crud.get_by_id(db, order_id)
    if order is None or order.status == OrderStatus.pending_payment:
        raise ApiError(404, "order_not_found", "We could not find that order.")
    return order


@router.get("/orders/{order_id}", response_model=StaffOrderRead)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db), user: User = staff_user):
    return _detail(await _get(db, order_id), user)


@router.post("/orders/{order_id}/accept", response_model=StaffOrderRead)
async def accept(order_id: int, db: AsyncSession = Depends(get_db), user: User = staff_user):
    order = await staff_orders.change_order_status(db, order_id, OrderStatus.accepted, user)
    return _detail(order, user)


@router.post("/orders/{order_id}/reject", response_model=StaffOrderRead)
async def reject(
    order_id: int, body: Reason, db: AsyncSession = Depends(get_db), user: User = staff_user
):
    order = await staff_orders.change_order_status(
        db, order_id, OrderStatus.rejected, user, body.reason
    )
    return _detail(order, user)


@router.post("/orders/{order_id}/cancel", response_model=StaffOrderRead)
async def cancel(
    order_id: int, body: Reason, db: AsyncSession = Depends(get_db), user: User = staff_user
):
    order = await staff_orders.change_order_status(
        db, order_id, OrderStatus.cancelled, user, body.reason
    )
    return _detail(order, user)


@router.post("/orders/{order_id}/transition", response_model=StaffOrderRead)
async def transition(
    order_id: int,
    body: TransitionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = staff_user,
):
    order = await staff_orders.change_order_status(db, order_id, body.to, user, body.reason)
    return _detail(order, user)


@router.post("/orders/{order_id}/delay", response_model=StaffOrderRead)
async def delay(
    order_id: int, body: DelayRequest, db: AsyncSession = Depends(get_db), user: User = staff_user
):
    return _detail(await staff_orders.set_delay(db, order_id, body.note, user), user)


@router.post("/orders/{order_id}/clear-delay", response_model=StaffOrderRead)
async def clear_delay(order_id: int, db: AsyncSession = Depends(get_db), user: User = staff_user):
    return _detail(await staff_orders.clear_delay(db, order_id, user), user)


@router.post("/orders/{order_id}/messages", response_model=StaffOrderRead, status_code=201)
async def message(
    order_id: int,
    body: MessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = staff_user,
):
    return _detail(await staff_orders.send_message(db, order_id, body.body, user), user)


@router.post("/orders/{order_id}/mark-paid", response_model=StaffOrderRead)
async def mark_paid(order_id: int, db: AsyncSession = Depends(get_db), user: User = staff_user):
    return _detail(await staff_orders.mark_paid(db, order_id, user), user)


@router.get("/prep-sheet", response_model=PrepSheet)
async def prep_sheet(
    date: dt.date | None = None, db: AsyncSession = Depends(get_db), _: User = staff_user
):
    day = date or store_now().date()
    lines, messages, order_count = await order_crud.prep_lines(db, day)
    return PrepSheet(
        date=day,
        order_count=order_count,
        total_units=sum(int(qty) for _, _, qty, _ in lines),
        lines=[
            PrepLine(product_name=p, variant_name=v, quantity=int(q), orders=n)
            for p, v, q, n in lines
        ],
        messages=[
            PrepMessage(
                order_code=code,
                slot_starts_at=start,
                product_name=p,
                variant_name=v,
                quantity=q,
                text=text,
            )
            for code, start, p, v, q, text in messages
        ],
    )
