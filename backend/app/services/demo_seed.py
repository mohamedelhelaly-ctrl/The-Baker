"""Seeds a believable demo catalog. Idempotent: does nothing if any category already exists."""

import io
import logging

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.category import category_crud
from app.crud.occasion import occasion_crud
from app.crud.product import product_crud
from app.data.demo_catalog import CATEGORIES, OCCASIONS, PRODUCTS
from app.models.category import Category
from app.services.images import new_image_key
from app.services.storage import get_storage

logger = logging.getLogger("baker.seed")


def placeholder_image(name: str, category: str, base: tuple[int, int, int]) -> bytes:
    """A clean branded tile. Replace with real photos from the owner screens."""
    size = 900
    img = Image.new("RGB", (size, size), base)
    draw = ImageDraw.Draw(img)
    for i in range(0, size, 6):  # soft vertical gradient
        shade = tuple(min(255, int(c + (255 - c) * 0.35 * i / size)) for c in base)
        draw.rectangle([0, i, size, i + 6], fill=shade)
    draw.ellipse([size * 0.2, size * 0.18, size * 0.8, size * 0.78], fill=(255, 250, 243))
    title_font = ImageFont.load_default(size=64)
    small_font = ImageFont.load_default(size=36)
    words, lines, line = name.split(), [], ""
    for w in words:
        if draw.textlength(f"{line} {w}".strip(), font=title_font) > size * 0.5:
            lines.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    lines.append(line)
    y = size * 0.48 - 40 * len(lines)
    for text in lines:
        draw.text((size / 2, y), text, font=title_font, fill=(43, 29, 20), anchor="mm")
        y += 78
    draw.text(
        (size / 2, size * 0.9), category.upper(), font=small_font, fill=(255, 250, 243), anchor="mm"
    )
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=82)
    return out.getvalue()


async def seed_demo_catalog(db: AsyncSession) -> bool:
    if (await db.execute(select(func.count()).select_from(Category))).scalar_one() > 0:
        return False

    categories = {}
    colors = {}
    for order, (name, description, color) in enumerate(CATEGORIES):
        categories[name] = await category_crud.create(
            db, name=name, description=description, sort_order=order
        )
        colors[name] = color
    occasions = {}
    for order, name in enumerate(OCCASIONS):
        occasions[name] = await occasion_crud.create(db, name=name, sort_order=order)

    storage = get_storage()
    for category, name, description, ingredients, variants, occ_names, featured, lead in PRODUCTS:
        product = await product_crud.create(
            db,
            category_id=categories[category].id,
            name=name,
            description=description,
            ingredients=ingredients,
            lead_time_hours=lead,
            is_featured=featured,
            variants=[
                {"name": v_name, "price": egp * 100, "sort_order": i}
                for i, (v_name, egp) in enumerate(variants)
            ],
            occasions=[occasions[o] for o in occ_names],
        )
        key = new_image_key(product.id)
        await storage.put(key, placeholder_image(name, category, colors[category]), "image/webp")
        await product_crud.add_image(
            db, product.id, storage_key=key, alt_text=f"{name}: illustration of the product"
        )
    logger.info("Seeded demo catalog: %d categories, %d products", len(CATEGORIES), len(PRODUCTS))
    return True
