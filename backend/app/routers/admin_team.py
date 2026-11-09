"""Staff and owner accounts (module: team, owner only; DESIGN.md §8.3, requirement O3.1)."""

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import hash_password
from app.crud.user import user_crud
from app.database import get_db
from app.deps import require_module
from app.models.user import User, UserRole
from app.schemas.team import TeamMemberCreate, TeamMemberRead, TeamMemberUpdate

owner_user = Depends(require_module("team", write=True))
router = APIRouter(prefix="/admin/team", tags=["admin: team"])


async def _member(db: AsyncSession, member_id: int) -> User:
    member = await user_crud.get(db, member_id)
    if member is None or member.role not in (UserRole.staff, UserRole.owner):
        raise ApiError(404, "member_not_found", "We could not find that team member.")
    return member


async def _keep_an_owner(db: AsyncSession, member: User, will_stay_owner: bool) -> None:
    """Never leave the shop without an active owner, or nobody could manage it."""
    if (
        member.role == UserRole.owner
        and member.is_active
        and not will_stay_owner
        and await user_crud.count_active_owners(db) <= 1
    ):
        raise ApiError(
            409,
            "last_owner",
            "This is the only active owner. Make someone else an owner first.",
        )


@router.get("", response_model=list[TeamMemberRead])
async def list_team(db: AsyncSession = Depends(get_db)):
    return await user_crud.list_team(db)


@router.post("", response_model=TeamMemberRead, status_code=201)
async def add_member(
    body: TeamMemberCreate, db: AsyncSession = Depends(get_db), _: User = owner_user
):
    if await user_crud.get_by_email(db, body.email):
        raise ApiError(
            409,
            "email_taken",
            "An account with this email already exists.",
            {"email": "An account with this email already exists."},
        )
    try:
        return await user_crud.create(
            db,
            email=body.email,
            password_hash=await hash_password(body.password),
            full_name=body.full_name,
            role=UserRole(body.role),
        )
    except IntegrityError:  # two requests racing on the same email
        await db.rollback()
        raise ApiError(409, "email_taken", "An account with this email already exists.") from None


@router.patch("/{member_id}", response_model=TeamMemberRead)
async def update_member(
    member_id: int,
    body: TeamMemberUpdate,
    db: AsyncSession = Depends(get_db),
    me: User = owner_user,
):
    member = await _member(db, member_id)
    new_role = UserRole(body.role) if body.role else member.role
    new_active = member.is_active if body.is_active is None else body.is_active
    if member.id == me.id and (new_role != member.role or not new_active):
        raise ApiError(
            409, "own_account", "You cannot change your own role or switch off your own account."
        )
    await _keep_an_owner(db, member, will_stay_owner=new_role == UserRole.owner and new_active)
    member.role, member.is_active = new_role, new_active
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{member_id}", response_model=TeamMemberRead)
async def remove_member(member_id: int, db: AsyncSession = Depends(get_db), me: User = owner_user):
    """Removing a member switches the account off (it keeps its order history and can be switched back on)."""
    member = await _member(db, member_id)
    if member.id == me.id:
        raise ApiError(409, "own_account", "You cannot remove your own account.")
    await _keep_an_owner(db, member, will_stay_owner=False)
    member.is_active = False
    await db.commit()
    await db.refresh(member)
    return member
