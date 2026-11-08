import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FulfilmentType(enum.StrEnum):
    delivery = "delivery"
    pickup = "pickup"


class PaymentMethod(enum.StrEnum):
    card = "card"
    cod = "cod"


class PaymentStatus(enum.StrEnum):
    unpaid = "unpaid"
    pending = "pending"
    paid = "paid"
    partially_refunded = "partially_refunded"
    refunded = "refunded"
    failed = "failed"


class OrderStatus(enum.StrEnum):
    pending_payment = "pending_payment"
    received = "received"
    accepted = "accepted"
    rejected = "rejected"
    preparing = "preparing"
    ready = "ready"
    out_for_delivery = "out_for_delivery"
    delivered = "delivered"
    picked_up = "picked_up"
    cancelled = "cancelled"


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_date_status", "fulfilment_date", "status"),
        Index("ix_orders_user_placed", "user_id", "placed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # public, e.g. BK-7F3K2Q
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    contact_name: Mapped[str] = mapped_column(String(120))
    contact_email: Mapped[str] = mapped_column(String(255))
    contact_phone: Mapped[str] = mapped_column(String(30))

    fulfilment_type: Mapped[FulfilmentType] = mapped_column(
        Enum(FulfilmentType, name="fulfilment_type")
    )
    fulfilment_date: Mapped[date] = mapped_column(Date)
    time_slot_id: Mapped[int | None] = mapped_column(
        ForeignKey("time_slots.id", ondelete="SET NULL"), index=True
    )
    slot_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # snapshots
    slot_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("delivery_zones.id", ondelete="SET NULL"), index=True
    )
    zone_name: Mapped[str | None] = mapped_column(String(80))
    delivery_address: Mapped[dict | None] = mapped_column(JSONB)

    subtotal: Mapped[int] = mapped_column(Integer)  # minor units
    delivery_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))

    payment_method: Mapped[PaymentMethod] = mapped_column(
        Enum(PaymentMethod, name="payment_method")
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, name="payment_status"), default=PaymentStatus.unpaid
    )
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"))
    is_delayed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    delay_note: Mapped[str | None] = mapped_column(String(300))
    rejection_reason: Mapped[str | None] = mapped_column(String(300))
    cancellation_reason: Mapped[str | None] = mapped_column(String(300))
    customer_notes: Mapped[str | None] = mapped_column(String(500))
    placed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", lazy="raise", cascade="all, delete-orphan", order_by="OrderItem.id"
    )
    events: Mapped[list["OrderStatusEvent"]] = relationship(
        back_populates="order",
        lazy="raise",
        cascade="all, delete-orphan",
        order_by="OrderStatusEvent.id",
    )


class OrderItem(Base):
    """A line of an order. Names and prices are snapshots, so catalog edits never change history."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_variants.id", ondelete="SET NULL"), index=True
    )
    product_name: Mapped[str] = mapped_column(String(120))
    variant_name: Mapped[str] = mapped_column(String(80))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    line_total: Mapped[int] = mapped_column(Integer)
    inscription: Mapped[str | None] = mapped_column(String(80))  # message written on the cake

    order: Mapped[Order] = relationship(back_populates="items", lazy="raise")


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[OrderStatus | None] = mapped_column(Enum(OrderStatus, name="order_status"))
    to_status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"))
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="events", lazy="raise")
