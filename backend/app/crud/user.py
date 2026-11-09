from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.models.user import User, UserRole


class UserCRUD:
    async def get(self, db: AsyncSession, user_id: int) -> User | None:
        return await db.get(User, user_id)

    async def get_by_email(self, db: AsyncSession, email: str) -> User | None:
        result = await db.execute(select(User).where(User.email == email.strip().lower()))
        return result.scalar_one_or_none()

    async def create(
        self,
        db: AsyncSession,
        *,
        email: str,
        password_hash: str,
        full_name: str,
        phone: str | None = None,
        role: UserRole = UserRole.customer,
    ) -> User:
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            full_name=full_name.strip(),
            phone=phone,
            role=role,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    async def touch_login(self, db: AsyncSession, user: User) -> None:
        await db.execute(update(User).where(User.id == user.id).values(last_login_at=utcnow()))
        await db.commit()

    async def set_password(self, db: AsyncSession, user: User, password_hash: str) -> None:
        user.password_hash = password_hash
        await db.commit()

    async def list_team(self, db: AsyncSession) -> list[User]:
        """Staff and owners (customers are not part of the team)."""
        rows = await db.execute(
            select(User)
            .where(User.role.in_([UserRole.staff, UserRole.owner]))
            .order_by(User.role.desc(), User.full_name, User.id)
        )
        return list(rows.scalars())

    async def count_active_owners(self, db: AsyncSession) -> int:
        """Counts the active owners and locks their rows until the caller commits, so two owners who
        change each other at the same moment are handled one after the other."""
        ids = await db.execute(
            select(User.id)
            .where(User.role == UserRole.owner, User.is_active.is_(True))
            .order_by(User.id)
            .with_for_update()
        )
        return len(ids.all())

    async def has_owner(self, db: AsyncSession) -> bool:
        result = await db.execute(select(User.id).where(User.role == UserRole.owner).limit(1))
        return result.first() is not None


user_crud = UserCRUD()
