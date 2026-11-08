from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.category import Category
from app.models.occasion import Occasion
from app.models.schedule import ProductAvailability

product_occasions = Table(
    "product_occasions",
    Base.metadata,
    Column("product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "occasion_id", ForeignKey("occasions.id", ondelete="CASCADE"), primary_key=True, index=True
    ),
)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    ingredients: Mapped[str] = mapped_column(Text, default="", server_default="")
    lead_time_hours: Mapped[int] = mapped_column(Integer, default=24, server_default="24")
    daily_capacity: Mapped[int | None] = mapped_column(Integer)  # null = unlimited
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # lazy="raise": every query states what it loads, which avoids N+1 and accidental IO.
    category: Mapped[Category] = relationship(lazy="raise")
    occasions: Mapped[list[Occasion]] = relationship(
        secondary=product_occasions, lazy="raise", order_by="Occasion.sort_order, Occasion.name"
    )
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product",
        lazy="raise",
        cascade="all, delete-orphan",
        order_by="ProductVariant.sort_order, ProductVariant.id",
    )
    availability: Mapped[list["ProductAvailability"]] = relationship(
        lazy="raise", cascade="all, delete-orphan"
    )
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product",
        lazy="raise",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order, ProductImage.id",
    )

    __table_args__ = (
        Index("ix_products_browse", "category_id", "is_archived", "is_available"),
        # Trigram GIN indexes make ILIKE '%text%' search fast (DESIGN.md §5.4).
        Index(
            "ix_products_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
        Index(
            "ix_products_description_trgm",
            "description",
            postgresql_using="gin",
            postgresql_ops={"description": "gin_trgm_ops"},
        ),
    )


class ProductVariant(Base):
    __tablename__ = "product_variants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))  # e.g. "6-inch, serves 8"
    price: Mapped[int] = mapped_column(Integer)  # minor units
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[Product] = relationship(back_populates="variants", lazy="raise")


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    alt_text: Mapped[str] = mapped_column(String(200))  # required: WCAG 1.1.1
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[Product] = relationship(back_populates="images", lazy="raise")
