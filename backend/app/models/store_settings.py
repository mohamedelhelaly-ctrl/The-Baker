import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RefundPolicy(enum.StrEnum):
    """What a customer gets back when they cancel a paid order themselves (staff always refund in full)."""

    full = "full"
    percentage = "percentage"
    none = "none"


class StoreSettings(Base):
    """A single row of owner-controlled switches. Secrets never live here, only in the environment."""

    __tablename__ = "store_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    cod_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Customers may cancel or change an order until this long before its time slot starts.
    cancellation_window_hours: Mapped[int] = mapped_column(Integer, default=24, server_default="24")
    refund_policy: Mapped[RefundPolicy] = mapped_column(
        Enum(RefundPolicy, name="refund_policy"),
        default=RefundPolicy.full,
        server_default="full",
    )
    refund_percentage: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    policy_note: Mapped[str | None] = mapped_column(String(500))  # extra wording shown to customers
    # Business details and pickup (O4.1, O4.4). Empty business_name falls back to BUSINESS_NAME.
    business_name: Mapped[str | None] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(30))
    whatsapp: Mapped[str | None] = mapped_column(String(30))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(300))
    pickup_location: Mapped[str | None] = mapped_column(String(200))
    pickup_instructions: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
