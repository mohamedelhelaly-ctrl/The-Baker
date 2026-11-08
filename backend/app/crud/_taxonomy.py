"""Shared behaviour of categories and occasions: slugs, ordering, archiving."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.slug import slugify


async def unique_slug(db: AsyncSession, model, name: str, exclude_id: int | None = None) -> str:
    base = slugify(name)
    slug, n = base, 1
    while True:
        query = select(model.id).where(model.slug == slug)
        if exclude_id is not None:
            query = query.where(model.id != exclude_id)
        if (await db.execute(query)).first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


class TaxonomyCRUD[M]:
    model: type[M]

    async def get(self, db: AsyncSession, item_id: int) -> M | None:
        return await db.get(self.model, item_id)

    async def list(self, db: AsyncSession, include_archived: bool = False) -> list[M]:
        query = select(self.model).order_by(self.model.sort_order, self.model.name, self.model.id)
        if not include_archived:
            query = query.where(self.model.is_archived.is_(False))
        return list((await db.execute(query)).scalars())

    async def create(self, db: AsyncSession, **data) -> M:
        item = self.model(slug=await unique_slug(db, self.model, data["name"]), **data)
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return item

    async def update(self, db: AsyncSession, item: M, **data) -> M:
        for key, value in data.items():
            setattr(item, key, value)  # slug stays stable on rename so links keep working
        await db.commit()
        await db.refresh(item)
        return item

    async def set_archived(self, db: AsyncSession, item: M, archived: bool) -> M:
        item.is_archived = archived
        await db.commit()
        await db.refresh(item)
        return item
