from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.errors import ApiError
from app.core.money import exponent
from app.crud.category import category_crud
from app.crud.occasion import occasion_crud
from app.crud.product import product_crud
from app.database import get_db
from app.schemas.catalog import (
    CategoryRead,
    ImageRead,
    OccasionRead,
    ProductDetail,
    ProductListItem,
    StoreRead,
)
from app.schemas.common import Page

router = APIRouter(tags=["catalog"])


@router.get("/store", response_model=StoreRead)
async def store():
    s = get_settings()
    return StoreRead(
        name=s.business_name, currency=s.currency, currency_exponent=exponent(s.currency)
    )


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(db: AsyncSession = Depends(get_db)):
    return await category_crud.list(db)


@router.get("/occasions", response_model=list[OccasionRead])
async def list_occasions(db: AsyncSession = Depends(get_db)):
    return await occasion_crud.list(db)


@router.get("/products", response_model=Page[ProductListItem])
async def list_products(
    category: str | None = Query(default=None, max_length=100),
    occasion: str | None = Query(default=None, max_length=100),
    q: str | None = Query(default=None, max_length=100),
    sort: Literal["featured", "name", "price_asc", "price_desc", "newest"] = "featured",
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=12, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await product_crud.list_public(
        db, category=category, occasion=occasion, q=q, sort=sort, page=page, page_size=page_size
    )
    items = [
        ProductListItem(
            id=p.id,
            slug=p.slug,
            name=p.name,
            category=p.category,
            price_from=price,
            image=ImageRead.model_validate(p.images[0]) if p.images else None,
            is_featured=p.is_featured,
        )
        for p, price in rows
    ]
    return Page.build(items, total, page, page_size)


@router.get("/products/{slug}", response_model=ProductDetail)
async def get_product(slug: str, db: AsyncSession = Depends(get_db)):
    product = await product_crud.get_public_by_slug(db, slug)
    if product is None:
        raise ApiError(404, "product_not_found", "We could not find that product.")
    return product
