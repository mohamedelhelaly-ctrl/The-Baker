"""When can an order happen? (DESIGN.md §4.1)

One engine answers every question: which dates are open, and which slots on a date can be
booked for a given cart. Checkout (M3) reuses `evaluate_day` and then locks the counters.

A slot is bookable for a cart only if all of these hold:
  1. the store is open that weekday (and the date is not a closure)
  2. every product is sold on that weekday
  3. the slot lies inside the opening hours
  4. slot start >= now + the longest lead time of the cart's products
  5. every product still has daily capacity for the requested quantity
  6. the slot has an order left
All dates and times are in the store timezone; `now` is passed in so tests can control it.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.clock import STORE_TZ
from app.models.product import Product
from app.models.schedule import (
    OpeningHours,
    ProductDailyUsage,
    SlotDailyUsage,
    SlotFulfilment,
    StoreClosure,
    TimeSlot,
)

# Reason codes the frontend can switch on
CLOSED = "closed"
CLOSURE = "closure"
PRODUCT_DAY = "product_unavailable_day"
PRODUCT_CAPACITY = "product_capacity"
OUTSIDE_HOURS = "outside_hours"
LEAD_TIME = "lead_time"
SLOT_FULL = "slot_full"
NO_SLOTS = "no_slots"


@dataclass(frozen=True)
class CartProduct:
    id: int
    name: str
    qty: int
    lead_time_hours: int
    daily_capacity: int | None
    blocked_weekdays: frozenset[int]


@dataclass
class SlotOption:
    slot: TimeSlot
    starts_at: datetime
    ends_at: datetime
    available: bool
    reason: str | None = None
    message: str | None = None
    remaining_orders: int = 0


@dataclass
class DayAvailability:
    date: date
    available: bool
    reason: str | None = None
    message: str | None = None
    slots: list[SlotOption] = field(default_factory=list)


@dataclass
class Context:
    """Everything needed to evaluate a date range, loaded with a fixed number of queries."""

    hours: dict[int, OpeningHours]
    closures: dict[date, str]
    slots: list[TimeSlot]
    slot_usage: dict[tuple[int, date], int]
    product_usage: dict[tuple[int, date], int]
    products: list[CartProduct]


async def load_context(
    db: AsyncSession,
    start: date,
    end: date,
    fulfilment: str,
    quantities: dict[int, int],
) -> Context:
    hours = {h.weekday: h for h in (await db.execute(select(OpeningHours))).scalars()}
    closures = {
        c.date: c.reason
        for c in (
            await db.execute(select(StoreClosure).where(StoreClosure.date.between(start, end)))
        ).scalars()
    }
    wanted = {fulfilment, SlotFulfilment.both.value}
    slots = list(
        (
            await db.execute(
                select(TimeSlot)
                .where(TimeSlot.is_active.is_(True), TimeSlot.fulfilment_type.in_(wanted))
                .order_by(TimeSlot.weekday, TimeSlot.starts_at, TimeSlot.id)
            )
        ).scalars()
    )
    # Plain column rows, not ORM entities: counters change under row locks during checkout, and
    # entities would come back stale from the session's identity map.
    slot_usage = {
        (slot_id, day): reserved
        for slot_id, day, reserved in (
            await db.execute(
                select(
                    SlotDailyUsage.time_slot_id, SlotDailyUsage.date, SlotDailyUsage.reserved_orders
                ).where(SlotDailyUsage.date.between(start, end))
            )
        ).all()
    }
    products: list[CartProduct] = []
    product_usage: dict[tuple[int, date], int] = {}
    if quantities:
        rows = (
            (
                await db.execute(
                    select(Product)
                    .options(selectinload(Product.availability))
                    .where(Product.id.in_(quantities))
                )
            )
            .scalars()
            .all()
        )
        products = [
            CartProduct(
                id=p.id,
                name=p.name,
                qty=quantities[p.id],
                lead_time_hours=p.lead_time_hours,
                daily_capacity=p.daily_capacity,
                blocked_weekdays=frozenset(a.weekday for a in p.availability if not a.is_available),
            )
            for p in rows
        ]
        product_usage = {
            (product_id, day): reserved
            for product_id, day, reserved in (
                await db.execute(
                    select(
                        ProductDailyUsage.product_id,
                        ProductDailyUsage.date,
                        ProductDailyUsage.reserved_qty,
                    ).where(
                        ProductDailyUsage.product_id.in_(quantities),
                        ProductDailyUsage.date.between(start, end),
                    )
                )
            ).all()
        }
    return Context(hours, closures, slots, slot_usage, product_usage, products)


def _hours_text(hours: int) -> str:
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    days = -(-hours // 24)
    return f"{days} day{'s' if days != 1 else ''}"


def evaluate_day(ctx: Context, day: date, now: datetime) -> DayAvailability:
    """Pure function: no database access. `now` must be timezone-aware."""
    weekday = day.weekday()

    hours = ctx.hours.get(weekday)
    if hours is None or hours.is_closed:
        return DayAvailability(day, False, CLOSED, "We are closed on this day.")
    if day in ctx.closures:
        reason = ctx.closures[day]
        return DayAvailability(
            day, False, CLOSURE, f"We are closed on this date{f' ({reason})' if reason else ''}."
        )

    for p in ctx.products:
        if weekday in p.blocked_weekdays:
            return DayAvailability(
                day, False, PRODUCT_DAY, f"{p.name} is not available on this day of the week."
            )
        if p.daily_capacity is not None:
            reserved = ctx.product_usage.get((p.id, day), 0)
            if reserved + p.qty > p.daily_capacity:
                left = max(0, p.daily_capacity - reserved)
                return DayAvailability(
                    day,
                    False,
                    PRODUCT_CAPACITY,
                    f"We can only make {left} more of {p.name} on this day."
                    if left
                    else f"{p.name} is fully booked on this day.",
                )

    lead_hours = max((p.lead_time_hours for p in ctx.products), default=0)
    earliest = now + timedelta(hours=lead_hours)

    options: list[SlotOption] = []
    for slot in (s for s in ctx.slots if s.weekday == weekday):
        starts = datetime.combine(day, slot.starts_at, tzinfo=STORE_TZ)
        ends = datetime.combine(day, slot.ends_at, tzinfo=STORE_TZ)
        used = ctx.slot_usage.get((slot.id, day), 0)
        remaining = max(0, slot.max_orders - used)
        option = SlotOption(slot, starts, ends, True, remaining_orders=remaining)
        if slot.starts_at < hours.opens_at or slot.ends_at > hours.closes_at:
            option.available, option.reason = False, OUTSIDE_HOURS
            option.message = "Outside our opening hours."
        elif starts < earliest:
            option.available, option.reason = False, LEAD_TIME
            option.message = (
                f"Needs at least {_hours_text(lead_hours)} notice."
                if lead_hours
                else "This time has already passed."
            )
        elif remaining <= 0:
            option.available, option.reason = False, SLOT_FULL
            option.message = "Fully booked."
        options.append(option)

    if any(o.available for o in options):
        return DayAvailability(day, True, slots=options)
    if not options:
        return DayAvailability(day, False, NO_SLOTS, "No delivery or pickup times on this day.")
    # Day is open but nothing can be booked: explain with the most useful slot reason.
    for reason in (LEAD_TIME, SLOT_FULL, OUTSIDE_HOURS):
        first = next((o for o in options if o.reason == reason), None)
        if first:
            return DayAvailability(day, False, reason, first.message, options)
    return DayAvailability(day, False, NO_SLOTS, "No times available.", options)


async def evaluate_range(
    db: AsyncSession,
    start: date,
    days: int,
    fulfilment: str,
    quantities: dict[int, int],
    now: datetime,
) -> list[DayAvailability]:
    end = start + timedelta(days=days - 1)
    ctx = await load_context(db, start, end, fulfilment, quantities)
    return [evaluate_day(ctx, start + timedelta(days=i), now) for i in range(days)]
