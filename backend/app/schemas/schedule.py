from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.schedule import SlotFulfilment

MAX_AMOUNT = 100_000_000  # minor units


class HoursEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    opens_at: time
    closes_at: time
    is_closed: bool = False

    @model_validator(mode="after")
    def _order(self):
        if not self.is_closed and self.opens_at >= self.closes_at:
            raise ValueError("Opening time must be before closing time.")
        return self


class HoursWrite(BaseModel):
    days: list[HoursEntry] = Field(min_length=7, max_length=7)

    @field_validator("days")
    @classmethod
    def _all_weekdays(cls, days: list[HoursEntry]):
        if sorted(d.weekday for d in days) != list(range(7)):
            raise ValueError("Provide exactly one entry for each day of the week.")
        return days


class ClosureWrite(BaseModel):
    date: date
    reason: str = Field(default="", max_length=200)


class ClosureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    reason: str


class SlotWrite(BaseModel):
    weekday: int = Field(ge=0, le=6)
    starts_at: time
    ends_at: time
    fulfilment_type: SlotFulfilment = SlotFulfilment.both
    max_orders: int = Field(default=6, ge=1, le=200)
    is_active: bool = True

    @model_validator(mode="after")
    def _order(self):
        if self.starts_at >= self.ends_at:
            raise ValueError("The slot must start before it ends.")
        return self


class SlotUpdate(BaseModel):
    weekday: int | None = Field(default=None, ge=0, le=6)
    starts_at: time | None = None
    ends_at: time | None = None
    fulfilment_type: SlotFulfilment | None = None
    max_orders: int | None = Field(default=None, ge=1, le=200)
    is_active: bool | None = None


class SlotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    weekday: int
    starts_at: time
    ends_at: time
    fulfilment_type: SlotFulfilment
    max_orders: int
    is_active: bool


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("This field cannot be empty.")
    return value


class ZoneWrite(BaseModel):
    name: str = Field(max_length=80)
    fee: int = Field(ge=0, le=MAX_AMOUNT, description="Minor units")
    min_order_amount: int = Field(default=0, ge=0, le=MAX_AMOUNT)
    sort_order: int = 0
    is_active: bool = True

    _name = field_validator("name")(_name)


class ZoneUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    fee: int | None = Field(default=None, ge=0, le=MAX_AMOUNT)
    min_order_amount: int | None = Field(default=None, ge=0, le=MAX_AMOUNT)
    sort_order: int | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _n(cls, v: str | None):
        return _name(v) if v is not None else v


class ZoneAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    fee: int
    min_order_amount: int
    sort_order: int
    is_active: bool


class ZonePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    fee: int
    min_order_amount: int


class ProductAvailabilityWrite(BaseModel):
    available_weekdays: list[int] = Field(max_length=7)

    @field_validator("available_weekdays")
    @classmethod
    def _valid(cls, days: list[int]):
        if any(d < 0 or d > 6 for d in days) or len(set(days)) != len(days):
            raise ValueError("Weekdays must be unique numbers from 0 (Monday) to 6 (Sunday).")
        return sorted(days)


# ---- public availability ----
class DayRead(BaseModel):
    date: date
    available: bool
    reason: str | None
    message: str | None


class DatesResponse(BaseModel):
    earliest_date: date | None
    days: list[DayRead]


class SlotOptionRead(BaseModel):
    slot_id: int
    starts_at: time
    ends_at: time
    available: bool
    reason: str | None
    message: str | None
    remaining_orders: int


class SlotsResponse(BaseModel):
    date: date
    available: bool
    reason: str | None
    message: str | None
    slots: list[SlotOptionRead]
