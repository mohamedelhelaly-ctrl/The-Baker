"""Prices and checks for a cart, always computed on the server (DESIGN.md §4.3).

`build_quote` never raises for a problem with the customer's choices. It returns them as a list
of `Problem`s tagged with the checkout step they belong to, so the UI can show each one where it
can be fixed. `ready` is true only when the order could be placed right now.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.core.money import exponent, format_money
from app.models.category import Category
from app.models.product import Product, ProductVariant
from app.models.schedule import DeliveryZone, TimeSlot
from app.schemas.catalog import ImageRead
from app.schemas.checkout import CartLine, Problem, QuoteLine, QuoteResponse
from app.services.availability import SlotOption, evaluate_range

MAX_DAYS_AHEAD = 90


@dataclass
class ResolvedLine:
    line: CartLine
    variant: ProductVariant
    product: Product
    unit_price: int
    line_total: int


@dataclass
class Quote:
    response: QuoteResponse
    resolved: list[ResolvedLine] = field(default_factory=list)
    zone: DeliveryZone | None = None
    slot: TimeSlot | None = None
    slot_option: SlotOption | None = None
    quantities: dict[int, int] = field(default_factory=dict)


_CAKE = re.compile(r"\bcakes?\b", re.IGNORECASE)


def takes_inscription(product_name: str, category_name: str) -> bool:
    """A message can be written on cakes only (not cupcakes, bread or pastries)."""
    return bool(_CAKE.search(product_name) or _CAKE.search(category_name))


async def _load_variants(db: AsyncSession, ids: set[int]):
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(ProductVariant, Product, Category)
            .join(Product, ProductVariant.product_id == Product.id)
            .join(Category, Product.category_id == Category.id)
            .options(selectinload(ProductVariant.product).selectinload(Product.images))
            .where(ProductVariant.id.in_(ids))
        )
    ).all()
    return {variant.id: (variant, product, category) for variant, product, category in rows}


async def build_quote(
    db: AsyncSession,
    *,
    items: list[CartLine],
    fulfilment_type: str | None,
    zone_id: int | None,
    day: date | None,
    slot_id: int | None,
    now: datetime,
) -> Quote:
    settings = get_settings()
    currency = settings.currency
    problems: list[Problem] = []
    lines: list[QuoteLine] = []
    resolved: list[ResolvedLine] = []
    quantities: dict[int, int] = {}

    # ---- lines and subtotal ----
    found = await _load_variants(db, {i.variant_id for i in items})
    for cart_line in items:
        entry = found.get(cart_line.variant_id)
        if entry is None:
            lines.append(
                QuoteLine(
                    variant_id=cart_line.variant_id,
                    product_id=None,
                    slug=None,
                    product_name="Item no longer available",
                    variant_name="",
                    unit_price=0,
                    quantity=cart_line.quantity,
                    line_total=0,
                    inscription=cart_line.inscription,
                    image=None,
                    available=False,
                    message="This item no longer exists.",
                )
            )
            problems.append(
                Problem(
                    field="items",
                    code="item_unavailable",
                    message="An item in your cart no longer exists.",
                )
            )
            continue
        variant, product, category = entry
        usable = (
            variant.is_active
            and product.is_available
            and not product.is_archived
            and not category.is_archived
        )
        total = variant.price * cart_line.quantity
        lines.append(
            QuoteLine(
                variant_id=variant.id,
                product_id=product.id,
                slug=product.slug,
                product_name=product.name,
                variant_name=variant.name,
                unit_price=variant.price,
                quantity=cart_line.quantity,
                line_total=total if usable else 0,
                inscription=cart_line.inscription
                if takes_inscription(product.name, category.name)
                else None,
                image=ImageRead.model_validate(product.images[0]) if product.images else None,
                available=usable,
                message=None if usable else f"{product.name} is no longer available.",
            )
        )
        if not usable:
            problems.append(
                Problem(
                    field="items",
                    code="item_unavailable",
                    message=f"{product.name} is no longer available.",
                )
            )
            continue
        resolved.append(ResolvedLine(cart_line, variant, product, variant.price, total))
        quantities[product.id] = quantities.get(product.id, 0) + cart_line.quantity

    subtotal = sum(r.line_total for r in resolved)

    # ---- delivery zone and fee ----
    zone: DeliveryZone | None = None
    delivery_fee = 0
    zone_minimum: int | None = None
    if fulfilment_type == "delivery" and zone_id is not None:
        zone = await db.get(DeliveryZone, zone_id)
        if zone is None or not zone.is_active:
            zone = None
            problems.append(
                Problem(
                    field="zone", code="zone_unavailable", message="We do not deliver to that area."
                )
            )
        else:
            delivery_fee = zone.fee
            zone_minimum = zone.min_order_amount
            if subtotal < zone.min_order_amount:
                missing = zone.min_order_amount - subtotal
                problems.append(
                    Problem(
                        field="zone",
                        code="below_minimum",
                        message=(
                            f"Delivery to {zone.name} needs an order of at least "
                            f"{format_money(zone.min_order_amount, currency)}. Add "
                            f"{format_money(missing, currency)} more, or choose pickup."
                        ),
                    )
                )

    # ---- date and time slot ----
    slot = None
    slot_option = None
    if fulfilment_type and day is not None and slot_id is not None:
        today = now.date()
        if day < today:
            problems.append(
                Problem(field="date", code="past_date", message="Choose today or a later date.")
            )
        elif day > today + timedelta(days=MAX_DAYS_AHEAD):
            problems.append(
                Problem(
                    field="date",
                    code="too_far_ahead",
                    message=f"We take orders up to {MAX_DAYS_AHEAD} days ahead.",
                )
            )
        else:
            (result,) = await evaluate_range(db, day, 1, fulfilment_type, quantities, now)
            if not result.available:
                problems.append(
                    Problem(
                        field="date",
                        code=result.reason or "unavailable",
                        message=result.message or "That date is not available.",
                    )
                )
            else:
                slot_option = next((o for o in result.slots if o.slot.id == slot_id), None)
                if slot_option is None:
                    problems.append(
                        Problem(
                            field="slot",
                            code="slot_invalid",
                            message="That time is not available. Please choose another.",
                        )
                    )
                elif not slot_option.available:
                    problems.append(
                        Problem(
                            field="slot",
                            code=slot_option.reason or "unavailable",
                            message=slot_option.message or "That time is not available.",
                        )
                    )
                    slot_option = None
                else:
                    slot = slot_option.slot

    complete = bool(
        resolved
        and fulfilment_type
        and (fulfilment_type == "pickup" or zone is not None)
        and day is not None
        and slot is not None
    )
    response = QuoteResponse(
        lines=lines,
        subtotal=subtotal,
        delivery_fee=delivery_fee,
        total=subtotal + delivery_fee,
        currency=currency,
        currency_exponent=exponent(currency),
        zone_minimum=zone_minimum,
        problems=problems,
        ready=complete and not problems,
    )
    return Quote(response, resolved, zone, slot, slot_option, quantities)
