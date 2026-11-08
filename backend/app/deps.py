from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.permissions import PERMISSIONS
from app.core.security import decode_access_token
from app.crud.user import user_crud
from app.database import get_db
from app.models.user import User

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise ApiError(401, "not_authenticated", "Please sign in to continue.")
    user_id = decode_access_token(credentials.credentials)
    user = await user_crud.get(db, user_id) if user_id else None
    if user is None or not user.is_active:
        raise ApiError(401, "invalid_token", "Your session has expired. Please sign in again.")
    return user


def require_module(module: str, write: bool = False):
    """Guard factory built from core/permissions.py."""
    action = "write" if write else "read"

    async def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in PERMISSIONS[module][action]:
            raise ApiError(403, "forbidden", "You do not have access to this area.")
        return user

    return guard


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Guests may check out. A signed-in customer's order is attached to their account;
    a missing or expired token simply means guest."""
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    user = await user_crud.get(db, user_id) if user_id else None
    return user if user and user.is_active else None
