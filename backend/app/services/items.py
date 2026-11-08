"""Parse and resolve the cart items sent to availability and (later) checkout endpoints."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ApiError
from app.models.category import Category
from app.models.product import Product, ProductVariant

MAX_LINES = 30
MAX_QTY = 100


def parse_items(raw: str | None) -> list[tuple[int, int]]:
    """'12:2,15' -> [(12, 2), (15, 1)]. An empty value means no items."""
    if not raw or not raw.strip():
        return []
    pairs: list[tuple[int, int]] = []
    for part in raw.split(","):
        variant, _, qty = part.strip().partition(":")
        try:
            vid, quantity = int(variant), int(qty) if qty else 1
        except ValueError:
            raise ApiError(422, "invalid_items", "Items must look like 12:2,15.") from None
        if vid < 1 or not 1 <= quantity <= MAX_QTY:
            raise ApiError(422, "invalid_items", f"Quantity must be between 1 and {MAX_QTY}.")
        pairs.append((vid, quantity))
    if len(pairs) > MAX_LINES:
        raise ApiError(422, "invalid_items", "Too many items.")
    return pairs


async def quantities_by_product(db: AsyncSession, pairs: list[tuple[int, int]]) -> dict[int, int]:
    """Map variant lines to total units per product, rejecting anything that cannot be bought."""
    if not pairs:
        return {}
    ids = {vid for vid, _ in pairs}
    rows = (
        await db.execute(
            select(ProductVariant, Product, Category)
            .join(Product, ProductVariant.product_id == Product.id)
            .join(Category, Product.category_id == Category.id)
            .where(ProductVariant.id.in_(ids))
            .options(selectinload(ProductVariant.product))
        )
    ).all()
    found = {v.id: (v, p, c) for v, p, c in rows}
    totals: dict[int, int] = {}
    for vid, qty in pairs:
        if vid not in found:
            raise ApiError(422, "item_unavailable", "An item in your cart no longer exists.")
        variant, product, category = found[vid]
        if (
            not variant.is_active
            or product.is_archived
            or not product.is_available
            or category.is_archived
        ):
            raise ApiError(422, "item_unavailable", f"{product.name} is no longer available.")
        totals[product.id] = totals.get(product.id, 0) + qty
    return totals
