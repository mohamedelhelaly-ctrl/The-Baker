from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.models.order import Order


class PaymentProviderError(Exception):
    """The provider could not do what we asked (network, bad credentials, rejected request)."""


class InvalidSignature(Exception):
    """A webhook did not carry a valid signature."""


@dataclass
class CheckoutSession:
    ref: str  # the provider's session id
    url: str  # where to send the customer to pay


@dataclass
class PaymentEvent:
    event_id: str
    kind: Literal["paid", "expired", "ignored"]
    order_code: str | None = None
    session_ref: str | None = None
    payment_ref: str | None = None  # the provider's transaction id, needed to refund
    amount: int | None = None  # minor units


class PaymentProvider(Protocol):
    name: str

    async def create_checkout(
        self, *, order: Order, success_url: str, cancel_url: str, expires_at: datetime
    ) -> CheckoutSession: ...

    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentEvent: ...

    async def expire_checkout(self, ref: str) -> None: ...

    async def refund(
        self,
        *,
        session_ref: str | None,
        payment_ref: str | None,
        amount: int,
        can_void: bool = False,
    ) -> str: ...
