from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.permissions import allowed_modules
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    generate_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.crud.password_reset_token import password_reset_token_crud
from app.crud.user import user_crud
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.schemas.user import MeRead
from app.services.email import EmailSender, get_email_sender

router = APIRouter(prefix="/auth", tags=["auth"])

# Same wording whether the email exists or not, so accounts cannot be enumerated.
FORGOT_MESSAGE = "If an account exists for that email, a reset link is on its way."


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("10/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if await user_crud.get_by_email(db, body.email):
        raise ApiError(409, "email_taken", "An account with this email already exists.")
    try:
        user = await user_crud.create(
            db,
            email=body.email,
            password_hash=await hash_password(body.password),
            full_name=body.full_name,
            phone=body.phone,
        )
    except IntegrityError:  # two registrations racing on the same email
        await db.rollback()
        raise ApiError(409, "email_taken", "An account with this email already exists.") from None
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await user_crud.get_by_email(db, body.email)
    # Always run a password check so timing does not reveal whether the email exists.
    valid = await verify_password(
        body.password, user.password_hash if user else "$2b$12$" + "x" * 53
    )
    if not user or not valid or not user.is_active:
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    await user_crud.touch_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.get("/me", response_model=MeRead)
async def me(user: User = Depends(get_current_user)):
    return MeRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        role=user.role,
        permissions=allowed_modules(user.role),
    )


@router.post("/forgot-password", response_model=MessageResponse, status_code=202)
@limiter.limit("5/minute")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
    email: EmailSender = Depends(get_email_sender),
):
    settings = get_settings()
    user = await user_crud.get_by_email(db, body.email)
    if user and user.is_active:
        token = generate_token()
        await password_reset_token_crud.create(
            db,
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(minutes=settings.password_reset_minutes),
        )
        link = f"{settings.frontend_url}/reset-password?token={token}"
        await email.send(
            user.email,
            "Reset your password",
            f"Hi {user.full_name},\n\nUse this link to choose a new password "
            f"(valid for {settings.password_reset_minutes} minutes):\n{link}\n\n"
            "If you did not ask for this, you can ignore this email.",
        )
    return MessageResponse(message=FORGOT_MESSAGE)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("10/minute")
async def reset_password(
    request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)
):
    now = utcnow()
    token = await password_reset_token_crud.get_valid(db, hash_token(body.token), now)
    user = await user_crud.get(db, token.user_id) if token else None
    if not token or not user or not user.is_active:
        raise ApiError(400, "invalid_reset_token", "This reset link is invalid or has expired.")
    await user_crud.set_password(db, user, await hash_password(body.new_password))
    await password_reset_token_crud.mark_used(db, token, now)
    return MessageResponse(message="Your password has been updated. You can sign in now.")
