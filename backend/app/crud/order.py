from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import Order


class OrderCRUD:
    _full = (selectinload(Order.items), selectinload(Order.events))

    async def get_by_code(self, db: AsyncSession, code: str) -> Order | None:
        result = await db.execute(
            select(Order)
            .options(*self._full)
            .where(Order.code == code)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_by_key(self, db: AsyncSession, key: str) -> Order | None:
        result = await db.execute(
            select(Order)
            .options(*self._full)
            .where(Order.idempotency_key == key)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_for_update(self, db: AsyncSession, order_id: int) -> Order | None:
        """Load an order and lock its row, so payment events and expiry cannot race each other."""
        result = await db.execute(
            select(Order)
            .options(*self._full)
            .where(Order.id == order_id)
            .with_for_update(of=Order)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def code_exists(self, db: AsyncSession, code: str) -> bool:
        return (await db.execute(select(Order.id).where(Order.code == code))).first() is not None


order_crud = OrderCRUD()
