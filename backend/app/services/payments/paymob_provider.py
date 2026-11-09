"""Paymob (Egypt). Cards through "Unified Checkout", confirmed by Paymob's signed callback.

Flow (from Paymob's Intention API documentation):
  1. POST {api}/v1/intention/ with the secret key creates a payment intention for the order and
     returns a client secret.
  2. The customer is sent to {checkout}/?publicKey=...&clientSecret=... to pay.
  3. Paymob POSTs a "Transaction Processed Callback" to our webhook. It carries an HMAC-SHA512
     signature (query parameter `hmac`) computed with the account's HMAC secret over a fixed list
     of fields. Only a callback with a valid signature is believed.
"""

import hashlib
import hmac
import json
import logging
import re
import uuid
from datetime import datetime
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.models.order import Order
from app.services.payments.base import (
    CheckoutSession,
    InvalidSignature,
    PaymentEvent,
    PaymentProviderError,
)

logger = logging.getLogger("baker.paymob")


def _accepted(response: httpx.Response) -> bool:
    """Did Paymob take the refund or void? A refund is often only *initiated* (reported as
    pending) and completes later, so a pending transaction counts as accepted, not as a failure."""
    if not 200 <= response.status_code < 300:  # Paymob answers a refund with 201 Created
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    return (
        isinstance(body, dict)
        and body.get("id") is not None
        and (body.get("success") is True or body.get("pending") is True)
    )


TIMEOUT = 20

# The exact fields, in the exact order, Paymob signs for a transaction callback (documented list).
# For the POST callback they live inside `obj`; dotted names are nested.
HMAC_FIELDS = (
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_parent_transaction",
    "id",
    "integration_id",
    "is_3d_secure",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order.id",
    "owner",
    "pending",
    "source_data.pan",
    "source_data.sub_type",
    "source_data.type",
    "success",
)

_REFERENCE = re.compile(r"^(?P<code>BK-[A-Z0-9]+)-[a-z0-9]+$")


def _lookup(obj: dict, path: str):
    current = obj
    for part in path.split("."):
        current = current.get(part) if isinstance(current, dict) else None
    return current


def _text(value) -> str:
    """Booleans are written lower case ("true"/"false"), as in Paymob's worked example."""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return "" if value is None else str(value)


def signing_string(obj: dict) -> str:
    return "".join(_text(_lookup(obj, field)) for field in HMAC_FIELDS)


def compute_hmac(obj: dict, secret: str) -> str:
    return hmac.new(secret.encode(), signing_string(obj).encode(), hashlib.sha512).hexdigest()


class PaymobProvider:
    name = "paymob"

    def __init__(self) -> None:
        s = get_settings()
        self.secret_key = s.paymob_secret_key
        self.public_key = s.paymob_public_key
        self.hmac_secret = s.paymob_hmac_secret
        self.integration_id = s.paymob_integration_id
        self.api = s.paymob_api_url.rstrip("/")
        self.checkout = s.paymob_checkout_url.rstrip("/")
        self.public_api_url = s.public_api_url.rstrip("/")

    # ---------------------------------------------------------------- http helpers
    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Token {self.secret_key}", "Content-Type": "application/json"}

    async def _post(self, path: str, body: dict) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                return await client.post(f"{self.api}{path}", headers=self._auth(), json=body)
        except httpx.HTTPError as exc:
            raise PaymentProviderError(f"Could not reach Paymob: {exc}") from exc

    # ---------------------------------------------------------------- checkout
    def _intention(self, order: Order, success_url: str) -> dict:
        first, _, last = order.contact_name.strip().partition(" ")
        address = order.delivery_address or {}
        items = [
            {
                # One entry per order line, quantity 1 and the full line amount, so the item amounts
                # add up exactly to the order total (Paymob requires that they match).
                "name": f"{i.quantity} x {i.product_name} ({i.variant_name})"[:50],
                "amount": i.line_total,
                "quantity": 1,
            }
            for i in order.items
        ]
        if order.delivery_fee:
            items.append(
                {
                    "name": f"Delivery ({order.zone_name or 'area'})"[:50],
                    "amount": order.delivery_fee,
                    "quantity": 1,
                }
            )
        body = {
            "amount": order.total,  # piastres, the same minor units we store
            "currency": order.currency,
            "payment_methods": [self.integration_id],
            "items": items,
            "billing_data": {
                "first_name": first or "Customer",
                "last_name": last.strip() or "NA",
                "email": order.contact_email,
                "phone_number": order.contact_phone,
                "street": address.get("street", "NA"),
                "building": address.get("building", "NA"),
                "floor": address.get("floor", "NA"),
                "apartment": address.get("apartment", "NA"),
                "city": order.zone_name or "Cairo",
                "country": "EG",
                "state": "Cairo",
            },
            # A fresh reference per attempt (an order can be paid via several payment pages).
            "special_reference": f"{order.code}-{uuid.uuid4().hex[:6]}",
            "redirection_url": success_url,
        }
        if "localhost" not in self.public_api_url and "127.0.0.1" not in self.public_api_url:
            body["notification_url"] = f"{self.public_api_url}/api/v1/payments/paymob/webhook"
        return body

    async def create_checkout(
        self, *, order: Order, success_url: str, cancel_url: str, expires_at: datetime
    ) -> CheckoutSession:
        response = await self._post("/v1/intention/", self._intention(order, success_url))
        if response.status_code != 201:
            raise PaymentProviderError(
                f"Paymob answered {response.status_code}: {response.text[:300]}"
            )
        data = response.json()
        client_secret, paymob_order_id = data.get("client_secret"), data.get("intention_order_id")
        if not client_secret or paymob_order_id is None:
            raise PaymentProviderError("Paymob returned no client secret")
        query = urlencode({"publicKey": self.public_key, "clientSecret": client_secret})
        return CheckoutSession(ref=str(paymob_order_id), url=f"{self.checkout}/?{query}")

    # ---------------------------------------------------------------- callback
    def parse_webhook(self, payload: bytes, signature: str | None) -> PaymentEvent:
        try:
            data = json.loads(payload)
        except ValueError as exc:
            raise InvalidSignature("The callback body is not JSON") from exc
        if not isinstance(data, dict):
            raise InvalidSignature("The callback body is not an object")
        if data.get("type") != "TRANSACTION":  # e.g. card-token callbacks: nothing for us to do
            return PaymentEvent("ignored", "ignored")
        obj = data.get("obj")
        if not isinstance(obj, dict):
            raise InvalidSignature("The callback has no transaction")

        expected = compute_hmac(obj, self.hmac_secret)
        if not signature or not hmac.compare_digest(expected, signature.strip().lower()):
            # The signing string holds no secrets, so it is safe to log and makes setup problems easy to spot.
            logger.warning(
                "Paymob callback signature mismatch (transaction %s). Signed string: %r",
                obj.get("id"),
                signing_string(obj),
            )
            raise InvalidSignature("The callback signature is not valid")

        transaction_id = str(obj.get("id"))
        order_info = obj.get("order") if isinstance(obj.get("order"), dict) else {}
        match = _REFERENCE.match(str(order_info.get("merchant_order_id") or ""))
        refund_or_void = (
            obj.get("is_refunded") or obj.get("is_voided") or obj.get("has_parent_transaction")
        )
        if refund_or_void or not (obj.get("success") is True and obj.get("pending") is False):
            # A declined attempt: the customer can try again on the same page, so nothing changes.
            # Refund and void callbacks are our own doing and are recorded when we make them.
            return PaymentEvent(f"paymob_txn_{transaction_id}_ignored", "ignored")
        return PaymentEvent(
            event_id=f"paymob_txn_{transaction_id}",
            kind="paid",
            order_code=match.group("code") if match else None,
            session_ref=str(order_info.get("id")) if order_info.get("id") is not None else None,
            payment_ref=transaction_id,
            amount=obj.get("amount_cents"),
        )

    # ---------------------------------------------------------------- housekeeping
    async def expire_checkout(self, ref: str) -> None:
        """Paymob has no way to close a payment page. A payment made after the order expired is
        refunded automatically instead (see apply_event)."""
        return None

    async def refund(
        self,
        *,
        session_ref: str | None,
        payment_ref: str | None,
        amount: int,
        can_void: bool = False,
    ) -> str:
        if not payment_ref or not payment_ref.isdigit():
            raise PaymentProviderError("No Paymob transaction id to refund")
        transaction_id = int(payment_ref)
        response = await self._post(
            "/api/acceptance/void_refund/refund",
            {"transaction_id": transaction_id, "amount_cents": amount},
        )
        logger.info("Paymob refund reply %s: %s", response.status_code, response.text[:300])
        if _accepted(response):
            return str(response.json().get("id"))
        if can_void:  # a full refund of a payment that has not settled yet is a void
            voided = await self._post(
                "/api/acceptance/void_refund/void", {"transaction_id": transaction_id}
            )
            logger.info("Paymob void reply %s: %s", voided.status_code, voided.text[:300])
            if _accepted(voided):
                return str(voided.json().get("id"))
            raise PaymentProviderError(
                f"Paymob refused the refund and the void: {voided.text[:300]}"
            )
        raise PaymentProviderError(f"Paymob refused the refund: {response.text[:300]}")
