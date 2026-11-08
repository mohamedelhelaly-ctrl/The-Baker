"""Public: delivery zones and when an order can be placed."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import store_now
from app.core.errors import ApiError
from app.crud.schedule import schedule_crud
from app.database import get_db
from app.schemas.schedule import (
    DatesResponse,
    DayRead,
    SlotOptionRead,
    SlotsResponse,
    ZonePublic,
)
from app.services.availability import evaluate_range
from app.services.items import parse_items, quantities_by_product

router = APIRouter(tags=["availability"])

Fulfilment = Literal["delivery", "pickup"]
MAX_DAYS_AHEAD = 90


@router.get("/delivery-zones", response_model=list[ZonePublic])
async def delivery_zones(db: AsyncSession = Depends(get_db)):
    return await schedule_crud.list_zones(db)


@router.get("/availability/dates", response_model=DatesResponse)
async def available_dates(
    fulfilment: Fulfilment,
    items: str | None = Query(default=None, description="Cart lines: variant_id[:qty],..."),
    days: int = Query(default=30, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    now = store_now()
    quantities = await quantities_by_product(db, parse_items(items))
    results = await evaluate_range(db, now.date(), days, fulfilment, quantities, now)
    earliest = next((r.date for r in results if r.available), None)
    return DatesResponse(
        earliest_date=earliest,
        days=[
            DayRead(date=r.date, available=r.available, reason=r.reason, message=r.message)
            for r in results
        ],
    )


@router.get("/availability/slots", response_model=SlotsResponse)
async def available_slots(
    date_: date = Query(alias="date"),
    fulfilment: Fulfilment = Query(),
    items: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    now = store_now()
    if date_ < now.date():
        raise ApiError(422, "past_date", "Choose today or a later date.")
    if date_ > now.date() + timedelta(days=MAX_DAYS_AHEAD):
        raise ApiError(422, "too_far_ahead", f"We take orders up to {MAX_DAYS_AHEAD} days ahead.")
    quantities = await quantities_by_product(db, parse_items(items))
    (day,) = await evaluate_range(db, date_, 1, fulfilment, quantities, now)
    return SlotsResponse(
        date=day.date,
        available=day.available,
        reason=day.reason,
        message=day.message,
        slots=[
            SlotOptionRead(
                slot_id=o.slot.id,
                starts_at=o.slot.starts_at,
                ends_at=o.slot.ends_at,
                available=o.available,
                reason=o.reason,
                message=o.message,
                remaining_orders=o.remaining_orders,
            )
            for o in day.slots
        ],
    )
