import datetime as dt

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.order import FulfilmentType, OrderStatus, PaymentMethod, PaymentStatus
from app.schemas.checkout import OrderRead


def _clean(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("This cannot be empty.")
    return value


class Reason(BaseModel):
    reason: str = Field(min_length=1, max_length=300)

    _strip = field_validator("reason")(_clean)


class TransitionRequest(BaseModel):
    to: OrderStatus
    reason: str | None = Field(default=None, max_length=300)


class DelayRequest(BaseModel):
    note: str = Field(min_length=1, max_length=300)

    _strip = field_validator("note")(_clean)


class MessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)

    _strip = field_validator("body")(_clean)


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    body: str
    created_at: dt.datetime


class ActionRead(BaseModel):
    to: OrderStatus
    needs_reason: bool


class StaffOrderRow(BaseModel):
    """One line of the queue."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    status: OrderStatus
    fulfilment_type: FulfilmentType
    fulfilment_date: dt.date
    slot_starts_at: dt.datetime
    slot_ends_at: dt.datetime
    zone_name: str | None
    contact_name: str
    contact_phone: str
    total: int
    currency: str
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    is_delayed: bool
    delay_note: str | None
    item_count: int = 0  # units, not lines (filled in by the router)


class StaffOrderRead(OrderRead):
    id: int
    actions: list[ActionRead]
    messages: list[MessageRead]
    can_mark_paid: bool
    can_delay: bool


class QueueSummary(BaseModel):
    counts: dict[OrderStatus, int]
    total: int
    delayed: int


class PrepLine(BaseModel):
    product_name: str
    variant_name: str
    quantity: int
    orders: int


class PrepMessage(BaseModel):
    order_code: str
    slot_starts_at: dt.datetime
    product_name: str
    variant_name: str
    quantity: int
    text: str


class PrepSheet(BaseModel):
    date: dt.date
    order_count: int
    total_units: int
    lines: list[PrepLine]
    messages: list[PrepMessage]
