import enum
from datetime import date, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SlotFulfilment(enum.StrEnum):
    delivery = "delivery"
    pickup = "pickup"
    both = "both"


class OpeningHours(Base):
    """One row per weekday (0 = Monday ... 6 = Sunday), in the store timezone."""

    __tablename__ = "opening_hours"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    weekday: Mapped[int] = mapped_column(Integer, unique=True)
    opens_at: Mapped[time] = mapped_column(Time)
    closes_at: Mapped[time] = mapped_column(Time)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StoreClosure(Base):
    """A date the store is closed regardless of weekly hours (holidays, one-off closures)."""

    __tablename__ = "store_closures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    date: Mapped[date] = mapped_column(Date, unique=True)
    reason: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TimeSlot(Base):
    """A fixed weekly window customers pick for delivery or pickup, with an order limit."""

    __tablename__ = "time_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    weekday: Mapped[int] = mapped_column(Integer, index=True)
    starts_at: Mapped[time] = mapped_column(Time)
    ends_at: Mapped[time] = mapped_column(Time)
    fulfilment_type: Mapped[SlotFulfilment] = mapped_column(
        Enum(SlotFulfilment, name="slot_fulfilment"), default=SlotFulfilment.both
    )
    max_orders: Mapped[int] = mapped_column(Integer, default=6, server_default="6")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DeliveryZone(Base):
    __tablename__ = "delivery_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    fee: Mapped[int] = mapped_column(Integer)  # minor units
    min_order_amount: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProductAvailability(Base):
    """A weekday a product is NOT sold. No rows means available every day."""

    __tablename__ = "product_availability"
    __table_args__ = (UniqueConstraint("product_id", "weekday"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    weekday: Mapped[int] = mapped_column(Integer)
    is_available: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProductDailyUsage(Base):
    """Units of a product already reserved for a date. Locked with FOR UPDATE at checkout (M3)."""

    __tablename__ = "product_daily_usage"
    __table_args__ = (UniqueConstraint("product_id", "date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date] = mapped_column(Date)
    reserved_qty: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class SlotDailyUsage(Base):
    __tablename__ = "slot_daily_usage"
    __table_args__ = (UniqueConstraint("time_slot_id", "date"), Index("ix_slot_usage_date", "date"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    time_slot_id: Mapped[int] = mapped_column(
        ForeignKey("time_slots.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date] = mapped_column(Date)
    reserved_orders: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
