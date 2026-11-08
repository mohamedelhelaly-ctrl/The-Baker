import asyncio
import hashlib
import secrets
from datetime import timedelta

import bcrypt
import jwt

from app.config import get_settings
from app.core.clock import utcnow

MAX_PASSWORD_BYTES = 72  # bcrypt limit


def password_too_long(password: str) -> bool:
    return len(password.encode("utf-8")) > MAX_PASSWORD_BYTES


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def _verify(password: str, password_hash: str) -> bool:
    if password_too_long(password):
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


# bcrypt is CPU bound (~100ms+), so keep it off the event loop.
async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hash, password)


async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(_verify, password, password_hash)


def create_access_token(user_id: int) -> str:
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int | None:
    """Return the user id, or None if the token is invalid or expired."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
