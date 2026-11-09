import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.order import FulfilmentType, OrderStatus, PaymentMethod, PaymentStatus
from app.schemas.catalog import ImageRead

MAX_QTY = 100
MAX_LINES = 30


class CartLine(BaseModel):
    variant_id: int = Field(ge=1)
    quantity: int = Field(ge=1, le=MAX_QTY)
    inscription: str | None = Field(default=None, max_length=80)  # message written on the cake

    @field_validator("inscription")
    @classmethod
    def _blank_is_none(cls, v: str | None):
        v = v.strip() if v else v
        return v or None


class QuoteRequest(BaseModel):
    items: list[CartLine] = Field(max_length=MAX_LINES)
    fulfilment_type: Literal["delivery", "pickup"] | None = None
    zone_id: int | None = None
    date: dt.date | None = None
    slot_id: int | None = None


class QuoteLine(BaseModel):
    variant_id: int
    product_id: int | None
    slug: str | None
    product_name: str
    variant_name: str
    unit_price: int
    quantity: int
    line_total: int
    inscription: str | None
    image: ImageRead | None
    available: bool
    message: str | None = None


class Problem(BaseModel):
    field: str  # items | zone | date | slot
    code: str
    message: str


class QuoteResponse(BaseModel):
    lines: list[QuoteLine]
    subtotal: int
    delivery_fee: int
    total: int
    currency: str
    currency_exponent: int
    zone_minimum: int | None
    problems: list[Problem]
    ready: bool  # everything needed to place the order is present and valid


class Address(BaseModel):
    street: str = Field(min_length=1, max_length=120)
    building: str = Field(min_length=1, max_length=40)
    floor: str | None = Field(default=None, max_length=20)
    apartment: str | None = Field(default=None, max_length=20)
    landmark: str | None = Field(default=None, max_length=200)

    @field_validator("street", "building")
    @classmethod
    def _not_blank(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty.")
        return v


class Contact(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(pattern=r"^[0-9+()\-\s]{7,20}$")

    @field_validator("name")
    @classmethod
    def _not_blank(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty.")
        return v


class OrderCreate(BaseModel):
    items: list[CartLine] = Field(min_length=1, max_length=MAX_LINES)
    fulfilment_type: Literal["delivery", "pickup"]
    zone_id: int | None = None
    address: Address | None = None
    date: dt.date
    slot_id: int
    contact: Contact
    payment_method: Literal["cod", "card"] = "cod"
    customer_notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _delivery_needs_zone_and_address(self):
        if self.fulfilment_type == "delivery":
            if self.zone_id is None:
                raise ValueError("Choose a delivery area.")
            if self.address is None:
                raise ValueError("Enter a delivery address.")
        return self


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_name: str
    variant_name: str
    unit_price: int
    quantity: int
    line_total: int
    inscription: str | None


class StatusEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    from_status: OrderStatus | None
    to_status: OrderStatus
    reason: str | None
    created_at: dt.datetime


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    status: OrderStatus
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    fulfilment_type: FulfilmentType
    fulfilment_date: dt.date
    slot_starts_at: dt.datetime
    slot_ends_at: dt.datetime
    time_slot_id: int | None
    zone_id: int | None
    zone_name: str | None
    delivery_address: dict | None
    contact_name: str
    contact_email: str
    contact_phone: str
    subtotal: int
    delivery_fee: int
    total: int
    currency: str
    customer_notes: str | None
    is_delayed: bool
    delay_note: str | None
    rejection_reason: str | None
    cancellation_reason: str | None
    placed_at: dt.datetime
    items: list[OrderItemRead]
    events: list[StatusEventRead]
    # Filled in for the customer's own views (see services/customer_orders.py).
    can_change: bool = False
    can_modify_until: dt.datetime | None = None
    cancel_refund: int | None = (
        None  # what they would get back by cancelling now (None: nothing paid)
    )


class OrderCreated(OrderRead):
    tracking_token: str  # guests use it to open /track/{code}?t=...
    payment_url: str | None = None  # card orders: where to send the customer to pay


class PaymentLink(BaseModel):
    payment_url: str


class OrderUpdate(BaseModel):
    """What a customer may change about an order (the items stay as ordered)."""

    zone_id: int | None = None
    address: Address | None = None
    date: dt.date | None = None
    slot_id: int | None = None
    customer_notes: str | None = Field(default=None, max_length=500)


class CustomerCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=200)
