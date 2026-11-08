from pydantic import BaseModel, ConfigDict

from app.models.user import UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    phone: str | None
    role: UserRole


class ModuleAccess(BaseModel):
    read: bool
    write: bool


class MeRead(UserRead):
    """/auth/me: the user plus what they can open, so the UI can hide pages."""

    permissions: dict[str, ModuleAccess]
