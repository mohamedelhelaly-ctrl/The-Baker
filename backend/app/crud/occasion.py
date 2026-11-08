from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud._taxonomy import TaxonomyCRUD
from app.models.occasion import Occasion


class OccasionCRUD(TaxonomyCRUD[Occasion]):
    model = Occasion

    async def get_many(self, db: AsyncSession, ids: list[int]) -> list[Occasion]:
        if not ids:
            return []
        result = await db.execute(select(Occasion).where(Occasion.id.in_(set(ids))))
        return list(result.scalars())


occasion_crud = OccasionCRUD()
