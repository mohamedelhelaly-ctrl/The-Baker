from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.store_settings import StoreSettings


class StoreSettingsCRUD:
    async def get(self, db: AsyncSession) -> StoreSettings:
        """The single settings row, created on first use (safe if two requests race)."""
        row = (
            await db.execute(select(StoreSettings).where(StoreSettings.id == 1))
        ).scalar_one_or_none()
        if row is None:
            await db.execute(pg_insert(StoreSettings).values(id=1).on_conflict_do_nothing())
            await db.commit()
            row = (
                await db.execute(select(StoreSettings).where(StoreSettings.id == 1))
            ).scalar_one()
        return row

    async def update(self, db: AsyncSession, row: StoreSettings, **data) -> StoreSettings:
        for key, value in data.items():
            setattr(row, key, value)
        await db.commit()
        await db.refresh(row)
        return row


store_settings_crud = StoreSettingsCRUD()
