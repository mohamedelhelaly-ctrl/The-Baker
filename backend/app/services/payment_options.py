from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.store_settings import store_settings_crud
from app.services.payments import get_payment_provider


async def available_methods(db: AsyncSession) -> list[str]:
    """What customers can pick at checkout: switched on by the owner and, for card, actually set up."""
    settings = await store_settings_crud.get(db)
    methods = []
    if settings.cod_enabled:
        methods.append("cod")
    if settings.card_enabled and get_payment_provider() is not None:
        methods.append("card")
    return methods
