"""Startup tasks that must be safe to run on every boot."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import hash_password
from app.crud.user import user_crud
from app.models.user import UserRole

logger = logging.getLogger("baker.bootstrap")


async def ensure_first_owner(db: AsyncSession) -> bool:
    """Create the first owner from env vars if no owner exists. Returns True if created."""
    settings = get_settings()
    if not settings.first_owner_email or not settings.first_owner_password:
        return False
    if await user_crud.has_owner(db):
        return False
    if await user_crud.get_by_email(db, settings.first_owner_email):
        logger.warning("FIRST_OWNER_EMAIL belongs to a non-owner account; not promoting it.")
        return False
    await user_crud.create(
        db,
        email=settings.first_owner_email,
        password_hash=await hash_password(settings.first_owner_password),
        full_name=settings.first_owner_name,
        role=UserRole.owner,
    )
    logger.info("Created first owner %s", settings.first_owner_email)
    return True
