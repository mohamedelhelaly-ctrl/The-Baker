import datetime as dt

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.order import FulfilmentType, OrderStatus, PaymentMethod, PaymentStatus


def _strip_required(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("This field cannot be empty.")
    return v


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^[0-9+()\-\s]{7,20}$")

    _name = field_validator("full_name")(_strip_required)

    @field_validator("phone", mode="before")
    @classmethod
    def _blank_phone_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class AddressWrite(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    zone_id: int
    street: str = Field(min_length=1, max_length=120)
    building: str = Field(min_length=1, max_length=40)
    floor: str | None = Field(default=None, max_length=20)
    apartment: str | None = Field(default=None, max_length=20)
    landmark: str | None = Field(default=None, max_length=200)
    is_default: bool = False

    _required = field_validator("label", "street", "building")(_strip_required)

    @field_validator("floor", "apartment", "landmark", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class AddressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    zone_id: int
    zone_name: str | None = None
    street: str
    building: str
    floor: str | None
    apartment: str | None
    landmark: str | None
    is_default: bool


class OrderSummary(BaseModel):
    """One line of the customer's order history."""

    model_config = ConfigDict(from_attributes=True)
    code: str
    status: OrderStatus
    fulfilment_type: FulfilmentType
    fulfilment_date: dt.date
    slot_starts_at: dt.datetime
    slot_ends_at: dt.datetime
    total: int
    currency: str
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    placed_at: dt.datetime
    summary: str = ""  # "2 × Triple Chocolate Cake, 1 × Sourdough"
