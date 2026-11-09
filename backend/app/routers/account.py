"""The signed-in customer's own profile, saved addresses and order history (module: account)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.permissions import allowed_modules
from app.crud.order import order_crud
from app.database import get_db
from app.deps import require_module
from app.models.address import SavedAddress
from app.models.cart import SavedCart
from app.models.schedule import DeliveryZone
from app.models.user import User
from app.schemas.account import (
    AddressRead,
    AddressWrite,
    CartBody,
    OrderSummary,
    ProfileUpdate,
)
from app.schemas.common import Page
from app.schemas.user import MeRead

MAX_ADDRESSES = 10
router = APIRouter(prefix="/me", tags=["account"])
account = Depends(require_module("account", write=True))


@router.patch("", response_model=MeRead)
async def update_profile(
    body: ProfileUpdate, db: AsyncSession = Depends(get_db), user: User = account
):
    user.full_name = body.full_name
    user.phone = body.phone.strip() if body.phone else None
    await db.commit()
    await db.refresh(user)
    return MeRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        role=user.role,
        permissions=allowed_modules(user.role),
    )


# -------------------------------------------------------------------- addresses
async def _read(db: AsyncSession, address: SavedAddress) -> AddressRead:
    zone = await db.get(DeliveryZone, address.zone_id)
    view = AddressRead.model_validate(address)
    view.zone_name = zone.name if zone else None
    return view


async def _check_zone(db: AsyncSession, zone_id: int) -> None:
    zone = await db.get(DeliveryZone, zone_id)
    if zone is None or not zone.is_active:
        raise ApiError(
            422,
            "zone_unavailable",
            "We do not deliver to that area.",
            {"zone_id": "Choose a delivery area."},
        )


async def _owned(db: AsyncSession, address_id: int, user: User) -> SavedAddress:
    address = await db.get(SavedAddress, address_id)
    if address is None or address.user_id != user.id:
        raise ApiError(404, "address_not_found", "We could not find that address.")
    return address


async def _make_only_default(db: AsyncSession, user_id: int, keep_id: int) -> None:
    await db.execute(
        update(SavedAddress)
        .where(SavedAddress.user_id == user_id, SavedAddress.id != keep_id)
        .values(is_default=False)
    )


@router.get("/addresses", response_model=list[AddressRead])
async def list_addresses(db: AsyncSession = Depends(get_db), user: User = account):
    rows = (
        await db.execute(
            select(SavedAddress)
            .where(SavedAddress.user_id == user.id)
            .order_by(SavedAddress.is_default.desc(), SavedAddress.id)
        )
    ).scalars()
    return [await _read(db, a) for a in rows]


@router.post("/addresses", response_model=AddressRead, status_code=201)
async def create_address(
    body: AddressWrite, db: AsyncSession = Depends(get_db), user: User = account
):
    await _check_zone(db, body.zone_id)
    count = len(
        (await db.execute(select(SavedAddress.id).where(SavedAddress.user_id == user.id))).all()
    )
    if count >= MAX_ADDRESSES:
        raise ApiError(
            422,
            "too_many_addresses",
            f"You can save up to {MAX_ADDRESSES} addresses. Delete one first.",
        )
    data = body.model_dump()
    address = SavedAddress(
        user_id=user.id, **{**data, "is_default": data["is_default"] or count == 0}
    )
    db.add(address)
    await db.flush()
    if address.is_default:
        await _make_only_default(db, user.id, address.id)
    await db.commit()
    await db.refresh(address)
    return await _read(db, address)


@router.patch("/addresses/{address_id}", response_model=AddressRead)
async def update_address(
    address_id: int, body: AddressWrite, db: AsyncSession = Depends(get_db), user: User = account
):
    address = await _owned(db, address_id, user)
    if body.zone_id != address.zone_id:
        await _check_zone(db, body.zone_id)
    for key, value in body.model_dump().items():
        setattr(address, key, value)
    if address.is_default:
        await _make_only_default(db, user.id, address.id)
    await db.commit()
    await db.refresh(address)
    return await _read(db, address)


@router.delete("/addresses/{address_id}", status_code=204)
async def delete_address(address_id: int, db: AsyncSession = Depends(get_db), user: User = account):
    address = await _owned(db, address_id, user)
    await db.delete(address)
    await db.commit()


# ----------------------------------------------------------------------- orders
@router.get("/orders", response_model=Page[OrderSummary])
async def my_orders(
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: User = account,
):
    orders, total = await order_crud.list_for_user(db, user.id, page, page_size)
    rows = []
    for order in orders:
        row = OrderSummary.model_validate(order)
        row.summary = ", ".join(f"{i.quantity} × {i.product_name}" for i in order.items)
        rows.append(row)
    return Page[OrderSummary].build(rows, total, page, page_size)


# ------------------------------------------------------------------------- cart
@router.get("/cart", response_model=CartBody)
async def get_cart(db: AsyncSession = Depends(get_db), user: User = account):
    row = (
        await db.execute(select(SavedCart).where(SavedCart.user_id == user.id))
    ).scalar_one_or_none()
    return CartBody(lines=row.lines if row else [])


@router.put("/cart", response_model=CartBody)
async def put_cart(body: CartBody, db: AsyncSession = Depends(get_db), user: User = account):
    """Replace the saved cart. One row per customer, so two tabs saving at once cannot create two."""
    lines = [line.model_dump() for line in body.lines]
    await db.execute(
        pg_insert(SavedCart)
        .values(user_id=user.id, lines=lines)
        .on_conflict_do_update(
            index_elements=["user_id"], set_={"lines": lines, "updated_at": func.now()}
        )
    )
    await db.commit()
    return CartBody(lines=lines)
