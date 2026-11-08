from datetime import time

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.media import media_url


class CategoryBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str


class CategoryRead(CategoryBrief):
    description: str | None


class OccasionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str


class ImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    alt_text: str
    sort_order: int
    storage_key: str = Field(exclude=True)

    @computed_field
    @property
    def url(self) -> str:
        return media_url(self.storage_key)


class VariantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    price: int  # minor units
    sort_order: int


class ProductListItem(BaseModel):
    id: int
    slug: str
    name: str
    category: CategoryBrief
    price_from: int
    image: ImageRead | None
    is_featured: bool


class ProductDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    name: str
    description: str
    ingredients: str
    lead_time_hours: int
    category: CategoryBrief
    occasions: list[OccasionRead]
    variants: list[VariantRead]
    images: list[ImageRead]


class HoursRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    weekday: int
    opens_at: time
    closes_at: time
    is_closed: bool


class StoreRead(BaseModel):
    name: str
    currency: str
    currency_exponent: int
    opening_hours: list[HoursRead] = []
