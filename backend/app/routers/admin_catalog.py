"""Owner-only catalog management (module: catalog_admin)."""

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.errors import ApiError
from app.crud.category import category_crud
from app.crud.occasion import occasion_crud
from app.crud.product import product_crud
from app.database import get_db
from app.deps import require_module
from app.schemas.admin_catalog import (
    CategoryAdminRead,
    CategoryUpdate,
    CategoryWrite,
    ImageUpdate,
    OccasionAdminRead,
    OccasionUpdate,
    OccasionWrite,
    ProductAdminListItem,
    ProductAdminRead,
    ProductCreate,
    ProductUpdate,
    VariantAdminRead,
    VariantUpdate,
    VariantWrite,
)
from app.schemas.catalog import ImageRead
from app.schemas.common import Page
from app.schemas.schedule import ProductAvailabilityWrite
from app.services.images import new_image_key, process_image
from app.services.storage import get_storage

MAX_IMAGES_PER_PRODUCT = 8
WRITE = [Depends(require_module("catalog_admin", write=True))]

router = APIRouter(prefix="/admin", tags=["admin: catalog"])


# ---------- categories and occasions ----------
def _taxonomy_routes(path: str, crud, read, write, update, label: str) -> None:
    async def load(db: AsyncSession, item_id: int):
        item = await crud.get(db, item_id)
        if item is None:
            raise ApiError(404, f"{label}_not_found", f"That {label} does not exist.")
        return item

    @router.get(f"/{path}", response_model=list[read])
    async def list_items(include_archived: bool = True, db: AsyncSession = Depends(get_db)):
        return await crud.list(db, include_archived=include_archived)

    @router.post(f"/{path}", response_model=read, status_code=201, dependencies=WRITE)
    async def create_item(body: write, db: AsyncSession = Depends(get_db)):
        return await crud.create(db, **body.model_dump())

    @router.patch(f"/{path}/{{item_id}}", response_model=read, dependencies=WRITE)
    async def update_item(item_id: int, body: update, db: AsyncSession = Depends(get_db)):
        return await crud.update(db, await load(db, item_id), **body.model_dump(exclude_unset=True))

    @router.post(f"/{path}/{{item_id}}/archive", response_model=read, dependencies=WRITE)
    async def archive_item(item_id: int, db: AsyncSession = Depends(get_db)):
        return await crud.set_archived(db, await load(db, item_id), True)

    @router.post(f"/{path}/{{item_id}}/restore", response_model=read, dependencies=WRITE)
    async def restore_item(item_id: int, db: AsyncSession = Depends(get_db)):
        return await crud.set_archived(db, await load(db, item_id), False)


_taxonomy_routes(
    "categories", category_crud, CategoryAdminRead, CategoryWrite, CategoryUpdate, "category"
)
_taxonomy_routes(
    "occasions", occasion_crud, OccasionAdminRead, OccasionWrite, OccasionUpdate, "occasion"
)


# ---------- products ----------
async def _load_product(db: AsyncSession, product_id: int):
    product = await product_crud.get_full(db, product_id)
    if product is None:
        raise ApiError(404, "product_not_found", "That product does not exist.")
    return product


async def _check_category(db: AsyncSession, category_id: int) -> None:
    if await category_crud.get(db, category_id) is None:
        raise ApiError(422, "invalid_category", "Choose an existing category.")


async def _load_occasions(db: AsyncSession, ids: list[int]):
    found = await occasion_crud.get_many(db, ids)
    if len(found) != len(set(ids)):
        raise ApiError(422, "invalid_occasion", "One of the chosen occasions does not exist.")
    return found


@router.get("/products", response_model=Page[ProductAdminListItem])
async def list_products(
    q: str | None = Query(default=None, max_length=100),
    category_id: int | None = None,
    archived: bool | None = None,
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await product_crud.list_admin(
        db, q=q, category_id=category_id, archived=archived, page=page, page_size=page_size
    )
    items = [
        ProductAdminListItem(
            id=p.id,
            slug=p.slug,
            name=p.name,
            category_name=p.category.name,
            is_available=p.is_available,
            is_archived=p.is_archived,
            is_featured=p.is_featured,
            price_from=price,
            image=ImageRead.model_validate(p.images[0]) if p.images else None,
        )
        for p, price in rows
    ]
    return Page.build(items, total, page, page_size)


@router.get("/products/{product_id}", response_model=ProductAdminRead)
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    return await _load_product(db, product_id)


@router.post("/products", response_model=ProductAdminRead, status_code=201, dependencies=WRITE)
async def create_product(body: ProductCreate, db: AsyncSession = Depends(get_db)):
    await _check_category(db, body.category_id)
    occasions = await _load_occasions(db, body.occasion_ids)
    data = body.model_dump(exclude={"variants", "occasion_ids"})
    variants = [v.model_dump() for v in body.variants]
    return await product_crud.create(db, variants=variants, occasions=occasions, **data)


@router.patch("/products/{product_id}", response_model=ProductAdminRead, dependencies=WRITE)
async def update_product(product_id: int, body: ProductUpdate, db: AsyncSession = Depends(get_db)):
    product = await _load_product(db, product_id)
    data = body.model_dump(exclude_unset=True)
    occasion_ids = data.pop("occasion_ids", None)
    if data.get("category_id") is not None:
        await _check_category(db, data["category_id"])
    for required in (
        "category_id",
        "name",
        "description",
        "ingredients",
        "lead_time_hours",
        "is_available",
        "is_featured",
    ):
        if required in data and data[required] is None:
            raise ApiError(422, "invalid_field", f"{required} cannot be empty.")
    occasions = await _load_occasions(db, occasion_ids) if occasion_ids is not None else None
    return await product_crud.update(db, product, occasions=occasions, **data)


@router.post("/products/{product_id}/archive", response_model=ProductAdminRead, dependencies=WRITE)
async def archive_product(product_id: int, db: AsyncSession = Depends(get_db)):
    return await product_crud.set_archived(db, await _load_product(db, product_id), True)


@router.post("/products/{product_id}/restore", response_model=ProductAdminRead, dependencies=WRITE)
async def restore_product(product_id: int, db: AsyncSession = Depends(get_db)):
    return await product_crud.set_archived(db, await _load_product(db, product_id), False)


@router.put(
    "/products/{product_id}/availability", response_model=ProductAdminRead, dependencies=WRITE
)
async def set_availability(
    product_id: int, body: ProductAvailabilityWrite, db: AsyncSession = Depends(get_db)
):
    """Which weekdays (0 = Monday) the product is sold. All seven days clears the restriction."""
    return await product_crud.set_weekdays(
        db, await _load_product(db, product_id), body.available_weekdays
    )


# ---------- variants (sizes) ----------
@router.post(
    "/products/{product_id}/variants",
    response_model=VariantAdminRead,
    status_code=201,
    dependencies=WRITE,
)
async def add_variant(product_id: int, body: VariantWrite, db: AsyncSession = Depends(get_db)):
    await _load_product(db, product_id)
    return await product_crud.add_variant(db, product_id, **body.model_dump())


@router.patch(
    "/products/{product_id}/variants/{variant_id}",
    response_model=VariantAdminRead,
    dependencies=WRITE,
)
async def update_variant(
    product_id: int, variant_id: int, body: VariantUpdate, db: AsyncSession = Depends(get_db)
):
    variant = await product_crud.get_variant(db, product_id, variant_id)
    if variant is None:
        raise ApiError(404, "variant_not_found", "That size does not exist.")
    data = body.model_dump(exclude_unset=True)
    if any(data.get(k, "") is None for k in ("name", "price", "is_active")):
        raise ApiError(422, "invalid_field", "Name, price and active cannot be empty.")
    return await product_crud.update_variant(db, variant, **data)


@router.delete("/products/{product_id}/variants/{variant_id}", status_code=204, dependencies=WRITE)
async def delete_variant(product_id: int, variant_id: int, db: AsyncSession = Depends(get_db)):
    variant = await product_crud.get_variant(db, product_id, variant_id)
    if variant is None:
        raise ApiError(404, "variant_not_found", "That size does not exist.")
    if await product_crud.count_variants(db, product_id) <= 1:
        raise ApiError(409, "last_variant", "A product needs at least one size.")
    await product_crud.delete_variant(db, variant)


# ---------- images ----------
@router.post(
    "/products/{product_id}/images", response_model=ImageRead, status_code=201, dependencies=WRITE
)
async def upload_image(
    product_id: int,
    file: UploadFile = File(...),
    alt_text: str = Form(..., max_length=200),
    db: AsyncSession = Depends(get_db),
):
    await _load_product(db, product_id)
    alt = alt_text.strip()
    if not alt:
        raise ApiError(
            422, "alt_required", "Describe the photo for people who cannot see it (alt text)."
        )
    if await product_crud.count_images(db, product_id) >= MAX_IMAGES_PER_PRODUCT:
        raise ApiError(
            409, "too_many_images", f"A product can have at most {MAX_IMAGES_PER_PRODUCT} photos."
        )

    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(
            413, "image_too_large", f"Photos can be at most {limit // (1024 * 1024)} MB."
        )

    webp = await process_image(data)  # validates, strips EXIF, converts
    key = new_image_key(product_id)
    storage = get_storage()
    await storage.put(key, webp, "image/webp")
    try:
        return await product_crud.add_image(db, product_id, storage_key=key, alt_text=alt)
    except Exception:
        await storage.delete(key)  # do not leave an orphan file behind
        raise


@router.patch(
    "/products/{product_id}/images/{image_id}", response_model=ImageRead, dependencies=WRITE
)
async def update_image(
    product_id: int, image_id: int, body: ImageUpdate, db: AsyncSession = Depends(get_db)
):
    image = await product_crud.get_image(db, product_id, image_id)
    if image is None:
        raise ApiError(404, "image_not_found", "That photo does not exist.")
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise ApiError(422, "invalid_field", "Alt text and order cannot be empty.")
    return await product_crud.update_image(db, image, **data)


@router.delete("/products/{product_id}/images/{image_id}", status_code=204, dependencies=WRITE)
async def delete_image(product_id: int, image_id: int, db: AsyncSession = Depends(get_db)):
    image = await product_crud.get_image(db, product_id, image_id)
    if image is None:
        raise ApiError(404, "image_not_found", "That photo does not exist.")
    key = image.storage_key
    await product_crud.delete_image(db, image)
    await get_storage().delete(key)
