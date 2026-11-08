from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.password_reset_token import PasswordResetToken


class PasswordResetTokenCRUD:
    async def create(
        self, db: AsyncSession, *, user_id: int, token_hash: str, expires_at: datetime
    ) -> PasswordResetToken:
        token = PasswordResetToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
        db.add(token)
        await db.commit()
        return token

    async def get_valid(
        self, db: AsyncSession, token_hash: str, now: datetime
    ) -> PasswordResetToken | None:
        """A token is valid if it exists, is unused and has not expired."""
        result = await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        return result.scalar_one_or_none()

    async def mark_used(self, db: AsyncSession, token: PasswordResetToken, now: datetime) -> None:
        token.used_at = now
        await db.commit()


password_reset_token_crud = PasswordResetTokenCRUD()
