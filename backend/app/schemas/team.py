import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.user import UserRole
from app.schemas.auth import _check_password

TeamRole = Literal["staff", "owner"]


class TeamMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    phone: str | None
    role: UserRole
    is_active: bool
    last_login_at: dt.datetime | None
    created_at: dt.datetime


class TeamMemberCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: TeamRole = "staff"
    password: str  # a temporary one; they change it under My account

    _password = field_validator("password")(_check_password)

    @field_validator("full_name")
    @classmethod
    def _not_blank(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty.")
        return v


class TeamMemberUpdate(BaseModel):
    role: TeamRole | None = None
    is_active: bool | None = None
