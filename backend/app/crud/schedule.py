from datetime import date, time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule import DeliveryZone, OpeningHours, SlotFulfilment, StoreClosure, TimeSlot


class ScheduleCRUD:
    # ---- opening hours ----
    async def list_hours(self, db: AsyncSession) -> list[OpeningHours]:
        return list(
            (await db.execute(select(OpeningHours).order_by(OpeningHours.weekday))).scalars()
        )

    async def replace_hours(self, db: AsyncSession, entries: list[dict]) -> list[OpeningHours]:
        existing = {h.weekday: h for h in await self.list_hours(db)}
        for entry in entries:
            row = existing.get(entry["weekday"])
            if row is None:
                db.add(OpeningHours(**entry))
            else:
                for key, value in entry.items():
                    setattr(row, key, value)
        await db.commit()
        return await self.list_hours(db)

    # ---- closures ----
    async def list_closures(self, db: AsyncSession, from_date: date) -> list[StoreClosure]:
        query = (
            select(StoreClosure).where(StoreClosure.date >= from_date).order_by(StoreClosure.date)
        )
        return list((await db.execute(query)).scalars())

    async def get_closure_by_date(self, db: AsyncSession, day: date) -> StoreClosure | None:
        return (
            await db.execute(select(StoreClosure).where(StoreClosure.date == day))
        ).scalar_one_or_none()

    async def create_closure(self, db: AsyncSession, day: date, reason: str) -> StoreClosure:
        closure = StoreClosure(date=day, reason=reason.strip())
        db.add(closure)
        await db.commit()
        await db.refresh(closure)
        return closure

    async def delete_closure(self, db: AsyncSession, closure_id: int) -> bool:
        result = await db.execute(delete(StoreClosure).where(StoreClosure.id == closure_id))
        await db.commit()
        return result.rowcount > 0

    # ---- time slots ----
    async def list_slots(self, db: AsyncSession, weekday: int | None = None) -> list[TimeSlot]:
        query = select(TimeSlot).order_by(TimeSlot.weekday, TimeSlot.starts_at, TimeSlot.id)
        if weekday is not None:
            query = query.where(TimeSlot.weekday == weekday)
        return list((await db.execute(query)).scalars())

    async def get_slot(self, db: AsyncSession, slot_id: int) -> TimeSlot | None:
        return await db.get(TimeSlot, slot_id)

    async def find_overlap(
        self,
        db: AsyncSession,
        *,
        weekday: int,
        starts_at: time,
        ends_at: time,
        fulfilment: SlotFulfilment,
        exclude_id: int | None = None,
    ) -> TimeSlot | None:
        """Two slots clash if their times overlap and their fulfilment types can both apply."""
        for other in await self.list_slots(db, weekday):
            if other.id == exclude_id:
                continue
            same_type = SlotFulfilment.both in (other.fulfilment_type, fulfilment) or (
                other.fulfilment_type == fulfilment
            )
            if same_type and starts_at < other.ends_at and other.starts_at < ends_at:
                return other
        return None

    async def create_slot(self, db: AsyncSession, **data) -> TimeSlot:
        slot = TimeSlot(**data)
        db.add(slot)
        await db.commit()
        await db.refresh(slot)
        return slot

    async def update_slot(self, db: AsyncSession, slot: TimeSlot, **data) -> TimeSlot:
        for key, value in data.items():
            setattr(slot, key, value)
        await db.commit()
        await db.refresh(slot)
        return slot

    async def delete_slot(self, db: AsyncSession, slot: TimeSlot) -> None:
        await db.delete(slot)
        await db.commit()

    # ---- delivery zones ----
    async def list_zones(
        self, db: AsyncSession, include_inactive: bool = False
    ) -> list[DeliveryZone]:
        query = select(DeliveryZone).order_by(
            DeliveryZone.sort_order, DeliveryZone.name, DeliveryZone.id
        )
        if not include_inactive:
            query = query.where(DeliveryZone.is_active.is_(True))
        return list((await db.execute(query)).scalars())

    async def get_zone(self, db: AsyncSession, zone_id: int) -> DeliveryZone | None:
        return await db.get(DeliveryZone, zone_id)

    async def name_taken(self, db: AsyncSession, name: str, exclude_id: int | None = None) -> bool:
        from sqlalchemy import func

        query = select(DeliveryZone.id).where(func.lower(DeliveryZone.name) == name.strip().lower())
        if exclude_id is not None:
            query = query.where(DeliveryZone.id != exclude_id)
        return (await db.execute(query)).first() is not None

    async def create_zone(self, db: AsyncSession, **data) -> DeliveryZone:
        zone = DeliveryZone(**data)
        db.add(zone)
        await db.commit()
        await db.refresh(zone)
        return zone

    async def update_zone(self, db: AsyncSession, zone: DeliveryZone, **data) -> DeliveryZone:
        for key, value in data.items():
            setattr(zone, key, value)
        await db.commit()
        await db.refresh(zone)
        return zone


schedule_crud = ScheduleCRUD()
