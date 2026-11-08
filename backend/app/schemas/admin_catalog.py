from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.catalog import CategoryBrief, ImageRead, OccasionRead

MAX_PRICE = 100_000_000  # minor units; guards against typos like an extra zero


def _clean(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("This field cannot be empty.")
    return value


class CategoryWrite(BaseModel):
    name: str = Field(max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    sort_order: int = 0

    _name = field_validator("name")(_clean)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    sort_order: int | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else v


class CategoryAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    description: str | None
    sort_order: int
    is_archived: bool


class OccasionWrite(BaseModel):
    name: str = Field(max_length=80)
    sort_order: int = 0

    _name = field_validator("name")(_clean)


class OccasionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    sort_order: int | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else v


class OccasionAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    sort_order: int
    is_archived: bool


class VariantWrite(BaseModel):
    name: str = Field(max_length=80)
    price: int = Field(gt=0, le=MAX_PRICE, description="Minor units (piastres)")
    sort_order: int = 0
    is_active: bool = True

    _name = field_validator("name")(_clean)


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    price: int | None = Field(default=None, gt=0, le=MAX_PRICE)
    sort_order: int | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else v


class VariantAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    price: int
    sort_order: int
    is_active: bool


class ProductCreate(BaseModel):
    category_id: int
    name: str = Field(max_length=120)
    description: str = Field(default="", max_length=5000)
    ingredients: str = Field(default="", max_length=2000)
    lead_time_hours: int = Field(default=24, ge=0, le=720)
    daily_capacity: int | None = Field(default=None, ge=1, le=10_000)
    is_available: bool = True
    is_featured: bool = False
    occasion_ids: list[int] = []
    variants: list[VariantWrite] = Field(min_length=1, max_length=12)

    _name = field_validator("name")(_clean)


class ProductUpdate(BaseModel):
    category_id: int | None = None
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    ingredients: str | None = Field(default=None, max_length=2000)
    lead_time_hours: int | None = Field(default=None, ge=0, le=720)
    daily_capacity: int | None = Field(default=None, ge=1, le=10_000)
    is_available: bool | None = None
    is_featured: bool | None = None
    occasion_ids: list[int] | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else v


class ProductAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    name: str
    description: str
    ingredients: str
    lead_time_hours: int
    daily_capacity: int | None
    is_available: bool
    is_archived: bool
    is_featured: bool
    category: CategoryBrief
    occasions: list[OccasionRead]
    variants: list[VariantAdminRead]
    images: list[ImageRead]


class ProductAdminListItem(BaseModel):
    id: int
    slug: str
    name: str
    category_name: str
    is_available: bool
    is_archived: bool
    is_featured: bool
    price_from: int | None
    image: ImageRead | None


class ImageUpdate(BaseModel):
    alt_text: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None

    @field_validator("alt_text")
    @classmethod
    def _alt(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else v
