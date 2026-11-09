"""Owner-only: payment switches, email wording, and the email log (module: settings)."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.clock import utcnow
from app.core.errors import ApiError
from app.crud.store_settings import store_settings_crud
from app.database import get_db
from app.deps import require_module
from app.models.notification import Notification, NotificationStatus, NotificationTemplate
from app.models.order import Order
from app.models.store_settings import RefundPolicy
from app.models.user import User
from app.schemas.common import Page
from app.services.email import email_provider_name, get_email_sender
from app.services.notifications import (
    TEMPLATES,
    TemplateRenderError,
    notifier,
    preview,
    validate_template,
)
from app.services.payment_options import available_methods
from app.services.policies import policy_text

WRITE = [Depends(require_module("settings", write=True))]
router = APIRouter(prefix="/admin", tags=["admin: settings"])


# ------------------------------------------------------------------- shop details
PHONE_PATTERN = r"^[0-9+()\-\s]{7,30}$"


class ShopDetails(BaseModel):
    business_name: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    whatsapp: str | None = Field(default=None, pattern=PHONE_PATTERN)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=300)
    pickup_location: str | None = Field(default=None, max_length=200)
    pickup_instructions: str | None = Field(default=None, max_length=500)

    @field_validator("*", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


def _details_read(row) -> ShopDetails:
    return ShopDetails(
        business_name=row.business_name,
        phone=row.phone,
        whatsapp=row.whatsapp,
        email=row.contact_email,
        address=row.address,
        pickup_location=row.pickup_location,
        pickup_instructions=row.pickup_instructions,
    )


@router.get("/settings", response_model=ShopDetails)
async def get_shop_details(db: AsyncSession = Depends(get_db)):
    return _details_read(await store_settings_crud.get(db))


@router.put("/settings", response_model=ShopDetails, dependencies=WRITE)
async def put_shop_details(body: ShopDetails, db: AsyncSession = Depends(get_db)):
    row = await store_settings_crud.get(db)
    row = await store_settings_crud.update(
        db,
        row,
        business_name=body.business_name,
        phone=body.phone,
        whatsapp=body.whatsapp,
        contact_email=str(body.email) if body.email else None,
        address=body.address,
        pickup_location=body.pickup_location,
        pickup_instructions=body.pickup_instructions,
    )
    return _details_read(row)


# ------------------------------------------------------------------------ policies
class PolicyRead(BaseModel):
    cancellation_window_hours: int
    refund_policy: RefundPolicy
    refund_percentage: int
    policy_note: str | None
    preview: str  # exactly what customers read


class PolicyWrite(BaseModel):
    cancellation_window_hours: int = Field(ge=0, le=720)
    refund_policy: RefundPolicy
    refund_percentage: int = Field(default=100, ge=0, le=100)
    policy_note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _percentage_makes_sense(self):
        if self.refund_policy == RefundPolicy.percentage and not 1 <= self.refund_percentage <= 99:
            raise ValueError("Enter a percentage between 1 and 99, or choose full or no refund.")
        return self


def _policy_read(row) -> PolicyRead:
    return PolicyRead(
        cancellation_window_hours=row.cancellation_window_hours,
        refund_policy=row.refund_policy,
        refund_percentage=row.refund_percentage,
        policy_note=row.policy_note,
        preview=policy_text(row),
    )


@router.get("/policies", response_model=PolicyRead)
async def get_policies(db: AsyncSession = Depends(get_db)):
    return _policy_read(await store_settings_crud.get(db))


@router.put("/policies", response_model=PolicyRead, dependencies=WRITE)
async def put_policies(body: PolicyWrite, db: AsyncSession = Depends(get_db)):
    row = await store_settings_crud.get(db)
    note = (body.policy_note or "").strip() or None
    row = await store_settings_crud.update(
        db,
        row,
        cancellation_window_hours=body.cancellation_window_hours,
        refund_policy=body.refund_policy,
        refund_percentage=body.refund_percentage,
        policy_note=note,
    )
    return _policy_read(row)


# ------------------------------------------------------------------------ payments
class PaymentSettingsRead(BaseModel):
    card_enabled: bool
    cod_enabled: bool
    provider: str  # paymob | fake | none
    mode: str | None  # test | live (Paymob only)
    card_available: bool  # switched on AND provider configured
    webhook_path: str
    email_provider: str  # brevo | log
    email_from: str


class PaymentSettingsUpdate(BaseModel):
    card_enabled: bool | None = None
    cod_enabled: bool | None = None


async def _payment_settings(db: AsyncSession) -> PaymentSettingsRead:
    row = await store_settings_crud.get(db)
    s = get_settings()
    key = s.paymob_secret_key or ""
    mode = None
    if s.payment_provider == "paymob":
        mode = "test" if "_test_" in key else "live"
    return PaymentSettingsRead(
        card_enabled=row.card_enabled,
        cod_enabled=row.cod_enabled,
        provider=s.payment_provider,
        mode=mode,
        card_available="card" in await available_methods(db),
        webhook_path="/api/v1/payments/paymob/webhook",
        email_provider=email_provider_name(),
        email_from=s.email_from,
    )


@router.get("/payments", response_model=PaymentSettingsRead)
async def get_payment_settings(db: AsyncSession = Depends(get_db)):
    return await _payment_settings(db)


@router.patch("/payments", response_model=PaymentSettingsRead, dependencies=WRITE)
async def update_payment_settings(body: PaymentSettingsUpdate, db: AsyncSession = Depends(get_db)):
    row = await store_settings_crud.get(db)
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise ApiError(422, "invalid_field", "Fields cannot be empty.")
    card = data.get("card_enabled", row.card_enabled)
    cod = data.get("cod_enabled", row.cod_enabled)
    if not card and not cod:
        raise ApiError(422, "no_payment_method", "Keep at least one payment method switched on.")
    await store_settings_crud.update(db, row, **data)
    return await _payment_settings(db)


class EmailTestResult(BaseModel):
    sent: bool
    to: str
    error: str | None = None


@router.post("/email-test", response_model=EmailTestResult)
async def send_test_email(user: User = Depends(require_module("settings", write=True))):
    """Send a real email to the signed-in owner, so a new email setup can be checked."""
    try:
        await get_email_sender().send(
            user.email,
            "Test email from your bakery site",
            "If you can read this, your email setup works. Customers will receive their order emails.",
        )
    except Exception as exc:
        return EmailTestResult(sent=False, to=user.email, error=str(exc)[:300])
    return EmailTestResult(sent=True, to=user.email)


# ------------------------------------------------------------------ email templates
class TemplateRead(BaseModel):
    key: str
    title: str
    description: str
    subject: str
    body: str
    is_active: bool
    is_customised: bool
    variables: list[str]


class TemplateUpdate(BaseModel):
    subject: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    is_active: bool | None = None


class PreviewRequest(BaseModel):
    subject: str = Field(max_length=200)
    body: str = Field(max_length=5000)


class PreviewResult(BaseModel):
    subject: str
    body: str


def _read(key: str, row: NotificationTemplate | None) -> TemplateRead:
    d = TEMPLATES[key]
    return TemplateRead(
        key=key,
        title=d.title,
        description=d.description,
        subject=row.subject if row else d.subject,
        body=row.body if row else d.body,
        is_active=row.is_active if row else True,
        is_customised=row is not None,
        variables=list(d.variables),
    )


async def _row(db: AsyncSession, key: str) -> NotificationTemplate | None:
    if key not in TEMPLATES:
        raise ApiError(404, "template_not_found", "That email template does not exist.")
    return (
        await db.execute(select(NotificationTemplate).where(NotificationTemplate.key == key))
    ).scalar_one_or_none()


@router.get("/notification-templates", response_model=list[TemplateRead])
async def list_templates(db: AsyncSession = Depends(get_db)):
    rows = {r.key: r for r in (await db.execute(select(NotificationTemplate))).scalars()}
    return [_read(key, rows.get(key)) for key in TEMPLATES]


@router.patch("/notification-templates/{key}", response_model=TemplateRead, dependencies=WRITE)
async def update_template(key: str, body: TemplateUpdate, db: AsyncSession = Depends(get_db)):
    row = await _row(db, key)
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise ApiError(422, "invalid_field", "Fields cannot be empty.")
    current = _read(key, row)
    subject, text = data.get("subject", current.subject), data.get("body", current.body)
    try:
        validate_template(key, subject, text)
    except TemplateRenderError as exc:
        raise ApiError(422, "invalid_template", f"This wording cannot be used: {exc}") from None
    if row is None:
        row = NotificationTemplate(key=key, subject=subject, body=text)
        db.add(row)
    row.subject, row.body = subject, text
    if "is_active" in data:
        row.is_active = data["is_active"]
    await db.commit()
    return _read(key, row)


@router.post("/notification-templates/{key}/preview", response_model=PreviewResult)
async def preview_template(key: str, body: PreviewRequest, db: AsyncSession = Depends(get_db)):
    await _row(db, key)
    try:
        subject, text = preview(key, body.subject, body.body)
    except TemplateRenderError as exc:
        raise ApiError(422, "invalid_template", f"This wording cannot be used: {exc}") from None
    return PreviewResult(subject=subject, body=text)


@router.post("/notification-templates/{key}/reset", response_model=TemplateRead, dependencies=WRITE)
async def reset_template(key: str, db: AsyncSession = Depends(get_db)):
    row = await _row(db, key)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return _read(key, None)


# -------------------------------------------------------------------------- email log
class NotificationRead(BaseModel):
    id: int
    order_code: str | None
    template_key: str
    to_email: str
    subject: str
    status: NotificationStatus
    attempts: int
    last_error: str | None
    created_at: str
    sent_at: str | None


@router.get("/notifications", response_model=Page[NotificationRead])
async def list_notifications(
    status: NotificationStatus | None = None,
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    conds = [Notification.status == status] if status else []
    total = (
        await db.execute(select(func.count()).select_from(Notification).where(*conds))
    ).scalar_one()
    rows = (
        await db.execute(
            select(Notification, Order.code)
            .outerjoin(Order, Notification.order_id == Order.id)
            .where(*conds)
            .order_by(Notification.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = [
        NotificationRead(
            id=n.id,
            order_code=code,
            template_key=n.template_key,
            to_email=n.to_email,
            subject=n.subject,
            status=n.status,
            attempts=n.attempts,
            last_error=n.last_error,
            created_at=n.created_at.isoformat(),
            sent_at=n.sent_at.isoformat() if n.sent_at else None,
        )
        for n, code in rows
    ]
    return Page.build(items, total, page, page_size)


@router.post(
    "/notifications/{notification_id}/retry", response_model=NotificationRead, dependencies=WRITE
)
async def retry_notification(notification_id: int, db: AsyncSession = Depends(get_db)):
    n = await db.get(Notification, notification_id)
    if n is None:
        raise ApiError(404, "notification_not_found", "That email does not exist.")
    if n.status != NotificationStatus.failed:
        raise ApiError(409, "not_failed", "Only failed emails can be retried.")
    n.status, n.attempts, n.last_error, n.next_attempt_at = (
        NotificationStatus.pending,
        0,
        None,
        utcnow(),
    )
    await db.commit()
    notifier.wake()
    code = (
        (await db.execute(select(Order.code).where(Order.id == n.order_id))).scalar_one_or_none()
        if n.order_id
        else None
    )
    return NotificationRead(
        id=n.id,
        order_code=code,
        template_key=n.template_key,
        to_email=n.to_email,
        subject=n.subject,
        status=n.status,
        attempts=n.attempts,
        last_error=n.last_error,
        created_at=n.created_at.isoformat(),
        sent_at=None,
    )
