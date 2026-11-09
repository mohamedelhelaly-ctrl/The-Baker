# Import every model so SQLAlchemy mappers and Alembic autogenerate see them.
from app.models.address import SavedAddress  # noqa: F401
from app.models.category import Category  # noqa: F401
from app.models.notification import (  # noqa: F401
    Notification,
    NotificationStatus,
    NotificationTemplate,
)
from app.models.occasion import Occasion  # noqa: F401
from app.models.order import (  # noqa: F401
    FulfilmentType,
    Order,
    OrderItem,
    OrderMessage,
    OrderStatus,
    OrderStatusEvent,
    PaymentMethod,
    PaymentStatus,
)
from app.models.password_reset_token import PasswordResetToken  # noqa: F401
from app.models.payment import Payment, PaymentRecordStatus, ProcessedWebhookEvent  # noqa: F401
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
from app.models.store_settings import RefundPolicy, StoreSettings  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
