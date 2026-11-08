"""A pretend payment page for development and demos. Never enabled in production.

The "hosted page" is a screen in our own frontend that calls /payments/fake/{code}/complete,
which feeds the same event handler the real provider callback uses, so the whole flow is exercised.
"""

import uuid
from datetime import datetime

from app.config import get_settings
from app.core.security import tracking_token
from app.models.order import Order
from app.services.payments.base import CheckoutSession, PaymentEvent


class FakeProvider:
    name = "fake"

    async def create_checkout(
        self, *, order: Order, success_url: str, cancel_url: str, expires_at: datetime
    ) -> CheckoutSession:
        base = get_settings().frontend_url.rstrip("/")
        return CheckoutSession(
            ref=f"fake_{order.code}_{uuid.uuid4().hex[:8]}",
            url=f"{base}/fake-pay/{order.code}?t={tracking_token(order.code)}",
        )

    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentEvent:
        raise NotImplementedError("The fake provider has no webhook")

    async def expire_checkout(self, ref: str) -> None:
        return None

    async def refund(
        self,
        *,
        session_ref: str | None,
        payment_ref: str | None,
        amount: int,
        can_void: bool = False,
    ) -> str:
        return f"fake_refund_{uuid.uuid4().hex[:8]}"
