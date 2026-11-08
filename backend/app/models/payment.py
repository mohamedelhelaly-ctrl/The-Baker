import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PaymentRecordStatus(enum.StrEnum):
    pending = "pending"
    paid = "paid"
    failed = "failed"
    partially_refunded = "partially_refunded"
    refunded = "refunded"


class Payment(Base):
    """One attempt to collect money for an order (an order can have several Checkout sessions)."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # paymob | fake
    provider_ref: Mapped[str | None] = mapped_column(
        String(255), unique=True
    )  # the provider's payment id (Paymob order id)
    provider_payment_id: Mapped[str | None] = mapped_column(
        String(255)
    )  # the provider's transaction id, needed to refund
    checkout_url: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[int] = mapped_column(Integer)  # minor units
    refunded_amount: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[PaymentRecordStatus] = mapped_column(
        Enum(PaymentRecordStatus, name="payment_record_status"), default=PaymentRecordStatus.pending
    )
    failure_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProcessedWebhookEvent(Base):
    """Every webhook event is handled once, even if the provider delivers it several times."""

    __tablename__ = "processed_webhook_events"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    event_id: Mapped[str] = mapped_column(String(255))
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
