# Import every model so SQLAlchemy mappers and Alembic autogenerate see them.
from app.models.category import Category  # noqa: F401
from app.models.occasion import Occasion  # noqa: F401
from app.models.password_reset_token import PasswordResetToken  # noqa: F401
from app.models.product import Product, ProductImage, ProductVariant, product_occasions  # noqa: F401
from app.models.schedule import (  # noqa: F401
    DeliveryZone,
    OpeningHours,
    ProductAvailability,
    ProductDailyUsage,
    SlotDailyUsage,
    SlotFulfilment,
    StoreClosure,
    TimeSlot,
)
from app.models.user import User, UserRole  # noqa: F401
