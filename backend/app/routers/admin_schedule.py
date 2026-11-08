"""Opening hours, closures, time slots and delivery zones (module: schedule_admin).

Staff may read (so they can see the schedule); only the owner may change it.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import store_now
from app.core.errors import ApiError
from app.crud.schedule import schedule_crud
from app.database import get_db
from app.deps import require_module
from app.schemas.schedule import (
    ClosureRead,
    ClosureWrite,
    HoursEntry,
    HoursWrite,
    SlotRead,
    SlotUpdate,
    SlotWrite,
    ZoneAdminRead,
    ZoneUpdate,
    ZoneWrite,
)

WRITE = [Depends(require_module("schedule_admin", write=True))]
router = APIRouter(prefix="/admin", tags=["admin: schedule"])


# ---------- opening hours ----------
@router.get("/opening-hours", response_model=list[HoursEntry])
async def get_hours(db: AsyncSession = Depends(get_db)):
    return await schedule_crud.list_hours(db)


@router.put("/opening-hours", response_model=list[HoursEntry], dependencies=WRITE)
async def put_hours(body: HoursWrite, db: AsyncSession = Depends(get_db)):
    return await schedule_crud.replace_hours(db, [d.model_dump() for d in body.days])


# ---------- closures ----------
@router.get("/closures", response_model=list[ClosureRead])
async def list_closures(db: AsyncSession = Depends(get_db)):
    return await schedule_crud.list_closures(db, store_now().date())  # upcoming only


@router.post("/closures", response_model=ClosureRead, status_code=201, dependencies=WRITE)
async def create_closure(body: ClosureWrite, db: AsyncSession = Depends(get_db)):
    day: date = body.date
    if day < store_now().date():
        raise ApiError(422, "past_date", "Choose today or a later date.")
    if await schedule_crud.get_closure_by_date(db, day):
        raise ApiError(409, "closure_exists", "That date is already marked as closed.")
    return await schedule_crud.create_closure(db, day, body.reason)


@router.delete("/closures/{closure_id}", status_code=204, dependencies=WRITE)
async def delete_closure(closure_id: int, db: AsyncSession = Depends(get_db)):
    if not await schedule_crud.delete_closure(db, closure_id):
        raise ApiError(404, "closure_not_found", "That closure does not exist.")


# ---------- time slots ----------
async def _check_no_overlap(
    db: AsyncSession, *, weekday, starts_at, ends_at, fulfilment, exclude_id=None
):
    clash = await schedule_crud.find_overlap(
        db,
        weekday=weekday,
        starts_at=starts_at,
        ends_at=ends_at,
        fulfilment=fulfilment,
        exclude_id=exclude_id,
    )
    if clash:
        raise ApiError(
            409,
            "slot_overlap",
            f"This overlaps the existing slot {clash.starts_at:%H:%M} to {clash.ends_at:%H:%M}.",
        )


@router.get("/time-slots", response_model=list[SlotRead])
async def list_slots(weekday: int | None = None, db: AsyncSession = Depends(get_db)):
    return await schedule_crud.list_slots(db, weekday)


@router.post("/time-slots", response_model=SlotRead, status_code=201, dependencies=WRITE)
async def create_slot(body: SlotWrite, db: AsyncSession = Depends(get_db)):
    await _check_no_overlap(
        db,
        weekday=body.weekday,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        fulfilment=body.fulfilment_type,
    )
    return await schedule_crud.create_slot(db, **body.model_dump())


@router.patch("/time-slots/{slot_id}", response_model=SlotRead, dependencies=WRITE)
async def update_slot(slot_id: int, body: SlotUpdate, db: AsyncSession = Depends(get_db)):
    slot = await schedule_crud.get_slot(db, slot_id)
    if slot is None:
        raise ApiError(404, "slot_not_found", "That time slot does not exist.")
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise ApiError(422, "invalid_field", "Fields cannot be empty.")
    merged = {
        "weekday": slot.weekday,
        "starts_at": slot.starts_at,
        "ends_at": slot.ends_at,
        "fulfilment_type": slot.fulfilment_type,
        **data,
    }
    if merged["starts_at"] >= merged["ends_at"]:
        raise ApiError(422, "invalid_slot", "The slot must start before it ends.")
    await _check_no_overlap(
        db,
        weekday=merged["weekday"],
        starts_at=merged["starts_at"],
        ends_at=merged["ends_at"],
        fulfilment=merged["fulfilment_type"],
        exclude_id=slot.id,
    )
    return await schedule_crud.update_slot(db, slot, **data)


@router.delete("/time-slots/{slot_id}", status_code=204, dependencies=WRITE)
async def delete_slot(slot_id: int, db: AsyncSession = Depends(get_db)):
    slot = await schedule_crud.get_slot(db, slot_id)
    if slot is None:
        raise ApiError(404, "slot_not_found", "That time slot does not exist.")
    await schedule_crud.delete_slot(db, slot)


# ---------- delivery zones ----------
@router.get("/delivery-zones", response_model=list[ZoneAdminRead])
async def list_zones(db: AsyncSession = Depends(get_db)):
    return await schedule_crud.list_zones(db, include_inactive=True)


@router.post("/delivery-zones", response_model=ZoneAdminRead, status_code=201, dependencies=WRITE)
async def create_zone(body: ZoneWrite, db: AsyncSession = Depends(get_db)):
    if await schedule_crud.name_taken(db, body.name):
        raise ApiError(409, "zone_exists", "A delivery zone with this name already exists.")
    return await schedule_crud.create_zone(db, **body.model_dump())


@router.patch("/delivery-zones/{zone_id}", response_model=ZoneAdminRead, dependencies=WRITE)
async def update_zone(zone_id: int, body: ZoneUpdate, db: AsyncSession = Depends(get_db)):
    zone = await schedule_crud.get_zone(db, zone_id)
    if zone is None:
        raise ApiError(404, "zone_not_found", "That delivery zone does not exist.")
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise ApiError(422, "invalid_field", "Fields cannot be empty.")
    if "name" in data and await schedule_crud.name_taken(db, data["name"], exclude_id=zone.id):
        raise ApiError(409, "zone_exists", "A delivery zone with this name already exists.")
    return await schedule_crud.update_zone(db, zone, **data)
