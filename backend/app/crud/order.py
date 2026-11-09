import datetime as dt

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import Order, OrderItem, OrderStatus

# Unpaid card orders are not the bakery's to act on yet, so the staff views never include them.
STAFF_HIDDEN = (OrderStatus.pending_payment,)
# Orders whose items still need to be (or have been) made on the day: everything except dead orders.
PREP_EXCLUDED = (OrderStatus.pending_payment, OrderStatus.rejected, OrderStatus.cancelled)


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class OrderCRUD:
    _full = (
        selectinload(Order.items),
        selectinload(Order.events),
        selectinload(Order.messages),
    )

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

    async def get_by_id(self, db: AsyncSession, order_id: int) -> Order | None:
        result = await db.execute(
            select(Order)
            .options(*self._full)
            .where(Order.id == order_id)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _staff_filter(
        day: dt.date | None,
        statuses: tuple[OrderStatus, ...] | None,
        fulfilment: str | None,
        q: str | None,
    ):
        conditions = [Order.status.not_in(STAFF_HIDDEN)]
        if day is not None:
            conditions.append(Order.fulfilment_date == day)
        if statuses:
            conditions.append(Order.status.in_(statuses))
        if fulfilment:
            conditions.append(Order.fulfilment_type == fulfilment)
        if q and q.strip():
            pattern = _like(q.strip())
            conditions.append(
                or_(
                    Order.code.ilike(pattern, escape="\\"),
                    Order.contact_name.ilike(pattern, escape="\\"),
                    Order.contact_email.ilike(pattern, escape="\\"),
                    Order.contact_phone.ilike(pattern, escape="\\"),
                )
            )
        return and_(*conditions)

    async def list_for_staff(
        self,
        db: AsyncSession,
        *,
        day: dt.date | None,
        statuses: tuple[OrderStatus, ...] | None,
        fulfilment: str | None,
        q: str | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Order], int]:
        where = self._staff_filter(day, statuses, fulfilment, q)
        total = (
            await db.execute(select(func.count()).select_from(Order).where(where))
        ).scalar_one()
        rows = (
            await db.execute(
                select(Order)
                .options(selectinload(Order.items))
                .where(where)
                .order_by(Order.fulfilment_date, Order.slot_starts_at, Order.id)
                .limit(page_size)
                .offset((page - 1) * page_size)
            )
        ).scalars()
        return list(rows), total

    async def status_counts(
        self, db: AsyncSession, day: dt.date | None
    ) -> tuple[dict[OrderStatus, int], int]:
        where = self._staff_filter(day, None, None, None)
        counts = {
            status: n
            for status, n in (
                await db.execute(
                    select(Order.status, func.count()).where(where).group_by(Order.status)
                )
            ).all()
        }
        delayed = (
            await db.execute(
                select(func.count()).select_from(Order).where(where, Order.is_delayed.is_(True))
            )
        ).scalar_one()
        return counts, delayed

    async def prep_lines(self, db: AsyncSession, day: dt.date):
        """Quantities to make on one day, plus the cake messages to write."""
        live = and_(Order.fulfilment_date == day, Order.status.not_in(PREP_EXCLUDED))
        lines = (
            await db.execute(
                select(
                    OrderItem.product_name,
                    OrderItem.variant_name,
                    func.sum(OrderItem.quantity),
                    func.count(func.distinct(OrderItem.order_id)),
                )
                .join(Order, Order.id == OrderItem.order_id)
                .where(live)
                .group_by(OrderItem.product_name, OrderItem.variant_name)
                .order_by(OrderItem.product_name, OrderItem.variant_name)
            )
        ).all()
        messages = (
            await db.execute(
                select(
                    Order.code,
                    Order.slot_starts_at,
                    OrderItem.product_name,
                    OrderItem.variant_name,
                    OrderItem.quantity,
                    OrderItem.inscription,
                )
                .join(Order, Order.id == OrderItem.order_id)
                .where(live, OrderItem.inscription.is_not(None))
                .order_by(Order.slot_starts_at, Order.id, OrderItem.id)
            )
        ).all()
        order_count = (
            await db.execute(select(func.count()).select_from(Order).where(live))
        ).scalar_one()
        return lines, messages, order_count

    async def code_exists(self, db: AsyncSession, code: str) -> bool:
        return (await db.execute(select(Order.id).where(Order.code == code))).first() is not None


order_crud = OrderCRUD()
