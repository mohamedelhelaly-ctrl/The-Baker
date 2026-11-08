# Import every model so SQLAlchemy mappers and Alembic autogenerate see them.
from app.models.password_reset_token import PasswordResetToken  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
