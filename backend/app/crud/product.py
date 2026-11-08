from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from app.crud._taxonomy import unique_slug
from app.models.category import Category
from app.models.occasion import Occasion
from app.models.product import Product, ProductImage, ProductVariant

SORTS = {"featured", "name", "price_asc", "price_desc", "newest"}
FULL = (
    selectinload(Product.variants),
    selectinload(Product.images),
    selectinload(Product.occasions),
    selectinload(Product.category),
)


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _search(q: str):
    pattern = f"%{_escape_like(q.strip())}%"
    return or_(
        Product.name.ilike(pattern, escape="\\"), Product.description.ilike(pattern, escape="\\")
    )


def _price_from():
    """Cheapest active variant, computed in SQL so we can filter and sort on it."""
    return (
        select(func.min(ProductVariant.price))
        .where(ProductVariant.product_id == Product.id, ProductVariant.is_active.is_(True))
        .correlate(Product)
        .scalar_subquery()
    )


class ProductCRUD:
    # ---------- public ----------
    async def list_public(
        self,
        db: AsyncSession,
        *,
        category: str | None,
        occasion: str | None,
        q: str | None,
        sort: str,
        page: int,
        page_size: int,
    ) -> tuple[list[tuple[Product, int]], int]:
        price_from = _price_from().label("price_from")
        conds = [
            Product.is_archived.is_(False),
            Product.is_available.is_(True),
            Category.is_archived.is_(False),
            price_from.element.is_not(None),  # needs at least one active variant
        ]
        if category:
            conds.append(Category.slug == category)
        if occasion:
            conds.append(
                Product.occasions.any((Occasion.slug == occasion) & Occasion.is_archived.is_(False))
            )
        if q and q.strip():
            conds.append(_search(q))

        order = {
            "featured": [Product.is_featured.desc(), Product.name, Product.id],
            "name": [Product.name, Product.id],
            "price_asc": [price_from.element, Product.id],
            "price_desc": [price_from.element.desc(), Product.id],
            "newest": [Product.created_at.desc(), Product.id.desc()],
        }[sort]

        total = (
            await db.execute(
                select(func.count()).select_from(Product).join(Product.category).where(*conds)
            )
        ).scalar_one()
        rows = await db.execute(
            select(Product, price_from)
            .join(Product.category)
            .options(contains_eager(Product.category), selectinload(Product.images))
            .where(*conds)
            .order_by(*order)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [(p, price) for p, price in rows.all()], total

    async def get_public_by_slug(self, db: AsyncSession, slug: str) -> Product | None:
        result = await db.execute(
            select(Product)
            .join(Product.category)
            .options(*FULL)
            .where(
                Product.slug == slug,
                Product.is_archived.is_(False),
                Product.is_available.is_(True),
                Category.is_archived.is_(False),
            )
        )
        product = result.scalar_one_or_none()
        if product is None:
            return None
        product.variants = [v for v in product.variants if v.is_active]  # type: ignore[misc]
        return product if product.variants else None

    # ---------- admin ----------
    async def list_admin(
        self,
        db: AsyncSession,
        *,
        q: str | None,
        category_id: int | None,
        archived: bool | None,
        page: int,
        page_size: int,
    ) -> tuple[list[tuple[Product, int | None]], int]:
        price_from = _price_from().label("price_from")
        conds = []
        if q and q.strip():
            conds.append(_search(q))
        if category_id:
            conds.append(Product.category_id == category_id)
        if archived is not None:
            conds.append(Product.is_archived.is_(archived))
        total = (
            await db.execute(select(func.count()).select_from(Product).where(*conds))
        ).scalar_one()
        rows = await db.execute(
            select(Product, price_from)
            .options(selectinload(Product.category), selectinload(Product.images))
            .where(*conds)
            .order_by(Product.name, Product.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [(p, price) for p, price in rows.all()], total

    async def get_full(self, db: AsyncSession, product_id: int) -> Product | None:
        result = await db.execute(
            select(Product)
            .options(*FULL)
            .where(Product.id == product_id)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def create(
        self, db: AsyncSession, *, variants: list[dict], occasions: list[Occasion], **data
    ) -> Product:
        product = Product(slug=await unique_slug(db, Product, data["name"]), **data)
        product.variants = [ProductVariant(**v) for v in variants]
        product.occasions = occasions
        db.add(product)
        await db.commit()
        return await self.get_full(db, product.id)  # type: ignore[return-value]

    async def update(
        self, db: AsyncSession, product: Product, *, occasions: list[Occasion] | None, **data
    ) -> Product:
        for key, value in data.items():
            setattr(product, key, value)
        if occasions is not None:
            product.occasions = occasions
        await db.commit()
        return await self.get_full(db, product.id)  # type: ignore[return-value]

    async def set_archived(self, db: AsyncSession, product: Product, archived: bool) -> Product:
        product.is_archived = archived
        await db.commit()
        return await self.get_full(db, product.id)  # type: ignore[return-value]

    # ---------- variants ----------
    async def get_variant(
        self, db: AsyncSession, product_id: int, variant_id: int
    ) -> ProductVariant | None:
        result = await db.execute(
            select(ProductVariant).where(
                ProductVariant.id == variant_id, ProductVariant.product_id == product_id
            )
        )
        return result.scalar_one_or_none()

    async def count_variants(self, db: AsyncSession, product_id: int) -> int:
        return (
            await db.execute(
                select(func.count())
                .select_from(ProductVariant)
                .where(ProductVariant.product_id == product_id)
            )
        ).scalar_one()

    async def add_variant(self, db: AsyncSession, product_id: int, **data) -> ProductVariant:
        variant = ProductVariant(product_id=product_id, **data)
        db.add(variant)
        await db.commit()
        await db.refresh(variant)
        return variant

    async def update_variant(
        self, db: AsyncSession, variant: ProductVariant, **data
    ) -> ProductVariant:
        for key, value in data.items():
            setattr(variant, key, value)
        await db.commit()
        await db.refresh(variant)
        return variant

    async def delete_variant(self, db: AsyncSession, variant: ProductVariant) -> None:
        await db.delete(variant)
        await db.commit()

    # ---------- images ----------
    async def get_image(
        self, db: AsyncSession, product_id: int, image_id: int
    ) -> ProductImage | None:
        result = await db.execute(
            select(ProductImage).where(
                ProductImage.id == image_id, ProductImage.product_id == product_id
            )
        )
        return result.scalar_one_or_none()

    async def count_images(self, db: AsyncSession, product_id: int) -> int:
        return (
            await db.execute(
                select(func.count())
                .select_from(ProductImage)
                .where(ProductImage.product_id == product_id)
            )
        ).scalar_one()

    async def add_image(
        self, db: AsyncSession, product_id: int, *, storage_key: str, alt_text: str
    ) -> ProductImage:
        next_order = (
            await db.execute(
                select(func.coalesce(func.max(ProductImage.sort_order), -1) + 1).where(
                    ProductImage.product_id == product_id
                )
            )
        ).scalar_one()
        image = ProductImage(
            product_id=product_id, storage_key=storage_key, alt_text=alt_text, sort_order=next_order
        )
        db.add(image)
        await db.commit()
        await db.refresh(image)
        return image

    async def update_image(self, db: AsyncSession, image: ProductImage, **data) -> ProductImage:
        for key, value in data.items():
            setattr(image, key, value)
        await db.commit()
        await db.refresh(image)
        return image

    async def delete_image(self, db: AsyncSession, image: ProductImage) -> None:
        await db.delete(image)
        await db.commit()


product_crud = ProductCRUD()
