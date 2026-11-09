import asyncio
import hashlib
import hmac as hmac_lib
import json
import re
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.core.security import tracking_token
from app.database import SessionLocal
from app.models.order import OrderStatus, PaymentStatus
from app.models.payment import Payment, PaymentRecordStatus
from app.services.payments.base import PaymentProviderError
from app.services.payments.paymob_provider import (
    HMAC_FIELDS,
    PaymobProvider,
    compute_hmac,
    signing_string,
)
from app.services.payments.service import expire_unpaid_orders, refund_payment
from tests.test_admin_catalog import A
from tests.test_checkout import API, order_body, place, shop, usage
from tests.test_payments import card_order, order_row, payment_rows
from tests.test_schedule import MON, at

HMAC_SECRET = "paymob_hmac_secret_for_tests"
SECRET_KEY, PUBLIC_KEY = "egy_sk_test_abc123", "egy_pk_test_xyz789"
INTEGRATION_ID = 4345907
_REAL_CLIENT = httpx.AsyncClient

# The documented list of signed fields, written out independently of the implementation.
DOCUMENTED_ORDER = [
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
]


class PaymobRecorder:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.intention_status = 201
        self.refund_replies: list[httpx.Response] = []
        self.void_reply = httpx.Response(200, json={"id": 9001, "success": True})

    def calls(self, path: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path == path]

    def body(self, path: str, index: int = -1) -> dict:
        return json.loads(self.calls(path)[index].content)


@pytest.fixture
def paymob_pay(monkeypatch):
    """Paymob configured with test keys; every network call goes to a recorder instead."""
    s = get_settings()
    monkeypatch.setattr(s, "payment_provider", "paymob")
    monkeypatch.setattr(s, "paymob_secret_key", SECRET_KEY)
    monkeypatch.setattr(s, "paymob_public_key", PUBLIC_KEY)
    monkeypatch.setattr(s, "paymob_hmac_secret", HMAC_SECRET)
    monkeypatch.setattr(s, "paymob_integration_id", INTEGRATION_ID)
    monkeypatch.setattr(s, "public_api_url", "https://api.example.com")
    rec = PaymobRecorder()

    def handler(request: httpx.Request) -> httpx.Response:
        rec.requests.append(request)
        if request.url.path == "/v1/intention/":
            if rec.intention_status != 201:
                return httpx.Response(rec.intention_status, json={"detail": "nope"})
            n = len(rec.calls("/v1/intention/"))
            return httpx.Response(
                201,
                json={
                    "id": f"pi_test_{n}",
                    "client_secret": f"egy_csk_test_{n}",
                    "intention_order_id": 500 + n,
                    "status": "intended",
                },
            )
        if request.url.path == "/api/acceptance/void_refund/refund":
            return (
                rec.refund_replies.pop(0)
                if rec.refund_replies
                else httpx.Response(200, json={"id": 8001, "success": True})
            )
        if request.url.path == "/api/acceptance/void_refund/void":
            return rec.void_reply
        return httpx.Response(404)

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: _REAL_CLIENT(transport=httpx.MockTransport(handler), **kw),
    )
    return rec


def sign(obj: dict, secret: str = HMAC_SECRET) -> str:
    """Paymob's documented algorithm, written separately from the implementation under test."""

    def get(path):
        cur = obj
        for part in path.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        return cur

    def text(v):
        return "true" if v is True else "false" if v is False else "" if v is None else str(v)

    return hmac_lib.new(
        secret.encode(), "".join(text(get(f)) for f in DOCUMENTED_ORDER).encode(), hashlib.sha512
    ).hexdigest()


def transaction(rec: PaymobRecorder, txn_id=777, **over) -> dict:
    """What Paymob sends for a card payment on the intention the recorder saw."""
    intention = rec.body("/v1/intention/")
    n = len(rec.calls("/v1/intention/"))
    obj = {
        "id": txn_id,
        "pending": False,
        "amount_cents": intention["amount"],
        "success": True,
        "is_auth": False,
        "is_capture": False,
        "is_standalone_payment": True,
        "is_voided": False,
        "is_refunded": False,
        "is_3d_secure": True,
        "integration_id": INTEGRATION_ID,
        "profile_id": 1,
        "has_parent_transaction": False,
        "created_at": "2030-12-04T10:15:00.123456",
        "currency": "EGP",
        "error_occured": False,
        "owner": 4242,
        "order": {"id": 500 + n, "merchant_order_id": intention["special_reference"]},
        "source_data": {"pan": "2346", "sub_type": "MasterCard", "type": "card"},
    }
    obj.update(over)
    return obj


async def callback(
    client,
    obj: dict,
    *,
    signature=None,
    type_="TRANSACTION",
    raw: bytes | None = None,
    secret=HMAC_SECRET,
):
    sig = sign(obj, secret) if signature is None else signature
    params = {"hmac": sig} if sig else {}
    content = raw if raw is not None else json.dumps({"type": type_, "obj": obj}).encode()
    return await client.post(
        f"{API}/payments/paymob/webhook",
        params=params,
        content=content,
        headers={"Content-Type": "application/json"},
    )


# ======================================================== the documented signature algorithm
def test_the_signature_follows_the_documented_field_order():
    assert list(HMAC_FIELDS) == DOCUMENTED_ORDER
    obj = {
        "amount_cents": 100000,
        "created_at": "2024-06-13T11:33:44.592345",
        "currency": "EGP",
        "error_occured": False,
        "has_parent_transaction": False,
        "id": 12345,
        "integration_id": 99,
        "is_3d_secure": True,
        "is_auth": False,
        "is_capture": False,
        "is_refunded": False,
        "is_standalone_payment": True,
        "is_voided": False,
        "order": {"id": 7},
        "owner": 3,
        "pending": False,
        "source_data": {"pan": "2346", "sub_type": "MasterCard", "type": "card"},
        "success": True,
    }
    expected = (
        "100000"
        "2024-06-13T11:33:44.592345"
        "EGP"
        "false"
        "false"
        "12345"
        "99"
        "true"
        "false"
        "false"
        "false"
        "true"
        "false"
        "7"
        "3"
        "false"
        "2346"
        "MasterCard"
        "card"
        "true"
    )
    assert signing_string(obj) == expected
    assert (
        compute_hmac(obj, "secret")
        == hmac_lib.new(b"secret", expected.encode(), hashlib.sha512).hexdigest()
    )
    assert compute_hmac(obj, "secret") == sign(obj, "secret")


def test_missing_fields_count_as_empty_text_and_extra_fields_are_not_signed():
    base = {"id": 1, "success": True}
    assert signing_string(base) == "1true"
    assert signing_string({**base, "something_new": "x"}) == signing_string(
        base
    )  # only the listed fields count


# ============================================================================= configuration
async def test_payment_status_screen_reports_paymob_without_secrets(client, owner, paymob_pay):
    body = (await client.get(f"{A}/payments", headers=owner)).json()
    assert (
        body["provider"] == "paymob" and body["mode"] == "test" and body["card_available"] is True
    )
    assert body["webhook_path"] == "/api/v1/payments/paymob/webhook"
    dumped = json.dumps(body)
    for secret in (SECRET_KEY, HMAC_SECRET, PUBLIC_KEY):
        assert secret not in dumped


async def test_live_keys_are_reported_as_live_mode(client, owner, paymob_pay, monkeypatch):
    monkeypatch.setattr(get_settings(), "paymob_secret_key", "egy_sk_live_abc")
    assert (await client.get(f"{A}/payments", headers=owner)).json()["mode"] == "live"


def test_paymob_configuration_is_validated():
    from app.config import Settings

    with pytest.raises(
        ValueError, match="PAYMOB_SECRET_KEY.*PAYMOB_HMAC_SECRET|PAYMOB_HMAC_SECRET.*"
    ):
        Settings(payment_provider="paymob", paymob_public_key="pk", paymob_integration_id=1)
    with pytest.raises(ValueError, match="PAYMOB_INTEGRATION_ID"):
        Settings(
            payment_provider="paymob",
            paymob_secret_key="sk",
            paymob_public_key="pk",
            paymob_hmac_secret="h",
        )
    with pytest.raises(ValueError, match="paymob, fake or none"):
        Settings(payment_provider="stripe")
    with pytest.raises(ValueError, match="development only"):
        Settings(
            payment_provider="fake",
            env="production",
            jwt_secret="x" * 40,
            storage_backend="r2",
            r2_account_id="a",
            r2_access_key_id="k",
            r2_secret_access_key="s",
            r2_bucket="b",
            r2_public_url="https://x",
        )
    ok = Settings(
        payment_provider="paymob",
        paymob_secret_key="sk",
        paymob_public_key="pk",
        paymob_hmac_secret="h",
        paymob_integration_id=7,
    )
    assert ok.payment_provider == "paymob" and ok.paymob_api_url == "https://accept.paymob.com"
    assert ok.paymob_checkout_url == "https://eg.checkout.paymob.com"


# ================================================================== opening the payment page
async def test_the_payment_intention_is_built_from_the_order(client, owner, paymob_pay):
    r, p, *_ = await card_order(client, owner, qty=2)
    o = r.json()
    assert r.status_code == 201, r.text
    request = paymob_pay.calls("/v1/intention/")[0]
    assert (
        str(request.url) == "https://accept.paymob.com/v1/intention/" and request.method == "POST"
    )
    assert request.headers["authorization"] == f"Token {SECRET_KEY}"
    body = paymob_pay.body("/v1/intention/")
    assert (body["amount"], body["currency"], body["payment_methods"]) == (
        134000,
        "EGP",
        [INTEGRATION_ID],
    )
    assert body["items"] == [
        {"name": "2 x Chocolate Cake (6-inch)", "amount": 130000, "quantity": 1},
        {"name": "Delivery (Maadi)", "amount": 4000, "quantity": 1},
    ]
    assert (
        sum(i["amount"] for i in body["items"]) == body["amount"]
    )  # Paymob requires the items to add up
    bd = body["billing_data"]
    assert (bd["first_name"], bd["last_name"], bd["email"], bd["phone_number"]) == (
        "Sara",
        "Ali",
        "sara@example.com",
        "+20 100 123 4567",
    )
    assert bd["street"] == "12 Road 9" and bd["building"] == "5" and bd["country"] == "EG"
    assert re.fullmatch(rf"{o['code']}-[0-9a-f]{{6}}", body["special_reference"])
    assert (
        body["redirection_url"]
        == f"http://frontend.test/track/{o['code']}?t={tracking_token(o['code'])}&paid=1"
    )
    assert body["notification_url"] == "https://api.example.com/api/v1/payments/paymob/webhook"
    assert (
        o["payment_url"]
        == f"https://eg.checkout.paymob.com/?publicKey={PUBLIC_KEY}&clientSecret=egy_csk_test_1"
    )
    (payment,) = await payment_rows(o["code"])
    assert (
        payment.provider == "paymob"
        and payment.provider_ref == "501"
        and payment.status == PaymentRecordStatus.pending
    )


async def test_pickup_orders_have_no_delivery_item_and_long_names_are_trimmed(
    client, owner, paymob_pay
):
    z, p, slots = await shop(client, owner)
    await client.patch(
        f"{A}/products/{p['id']}",
        json={"name": "An Extremely Long Celebration Cake Name That Goes On"},
        headers=owner,
    )
    with at(MON):
        r = await place(
            client,
            order_body(
                p["variants"][0]["id"], slots[0], fulfilment="pickup", payment_method="card"
            ),
        )
    assert r.status_code == 201
    items = paymob_pay.body("/v1/intention/")["items"]
    assert (
        len(items) == 1
        and all(len(i["name"]) <= 50 for i in items)
        and "Delivery" not in items[0]["name"]
    )
    assert (
        paymob_pay.body("/v1/intention/")["billing_data"]["street"] == "NA"
    )  # no address for pickup


async def test_a_single_word_name_still_fills_the_required_last_name(client, owner, paymob_pay):
    z, p, slots = await shop(client, owner)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card")
    body["contact"]["name"] = "Madonna"
    with at(MON):
        assert (await place(client, body)).status_code == 201
    bd = paymob_pay.body("/v1/intention/")["billing_data"]
    assert (bd["first_name"], bd["last_name"]) == ("Madonna", "NA")


async def test_a_callback_address_is_only_sent_when_the_api_is_publicly_reachable(
    client, owner, paymob_pay, monkeypatch
):
    monkeypatch.setattr(get_settings(), "public_api_url", "http://localhost:8000")
    r, *_ = await card_order(client, owner)
    assert r.status_code == 201 and "notification_url" not in paymob_pay.body("/v1/intention/")


@pytest.mark.parametrize("status", [400, 401, 404, 500])
async def test_if_paymob_refuses_the_order_is_cancelled_and_the_slot_freed(
    client, owner, paymob_pay, status
):
    paymob_pay.intention_status = status
    r, p, *_ = await card_order(client, owner, daily_capacity=1)
    assert r.status_code == 502 and r.json()["error"]["code"] == "payment_unavailable"
    assert await usage(p["id"]) == (0, 0)


async def test_if_paymob_cannot_be_reached_the_order_is_cancelled(client, owner, monkeypatch):
    s = get_settings()
    for name, value in dict(
        payment_provider="paymob",
        paymob_secret_key="k",
        paymob_public_key="p",
        paymob_hmac_secret="h",
        paymob_integration_id=1,
    ).items():
        monkeypatch.setattr(s, name, value)

    def down(request):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=httpx.MockTransport(down), **kw)
    )
    r, p, *_ = await card_order(client, owner, daily_capacity=1)
    assert r.status_code == 502 and await usage(p["id"]) == (0, 0)


# ====================================================================== the signed callback
async def test_a_valid_callback_marks_the_order_paid(client, owner, paymob_pay, emails):
    r, p, *_ = await card_order(client, owner)
    o = r.json()
    res = await callback(client, transaction(paymob_pay))
    assert res.status_code == 200 and res.json() == {"received": True, "outcome": "paid"}
    after = (
        await client.get(f"{API}/orders/{o['code']}", params={"t": o["tracking_token"]})
    ).json()
    assert after["status"] == "received" and after["payment_status"] == "paid"
    (payment,) = await payment_rows(o["code"])
    assert payment.status == PaymentRecordStatus.paid and payment.provider_payment_id == "777"
    await emails.flush()
    assert len(emails.sent) == 1 and "Paid by card" in emails.sent[0]["text"]


async def test_the_callback_works_with_an_uppercase_signature(client, owner, paymob_pay):
    r, *_ = await card_order(client, owner)
    obj = transaction(paymob_pay)
    assert (await callback(client, obj, signature=sign(obj).upper())).json()["outcome"] == "paid"


async def test_the_same_callback_delivered_many_times_is_applied_once(
    client, owner, paymob_pay, emails
):
    r, *_ = await card_order(client, owner)
    obj = transaction(paymob_pay)
    results = await asyncio.gather(*[callback(client, obj) for _ in range(5)])
    assert sorted(x.json()["outcome"] for x in results) == ["duplicate"] * 4 + ["paid"]
    await emails.flush()
    assert len(emails.sent) == 1


@pytest.mark.parametrize(
    "tamper", ["wrong_secret", "changed_amount", "missing", "garbage", "empty", "other_transaction"]
)
async def test_callbacks_that_do_not_carry_a_valid_signature_are_rejected(
    client, owner, paymob_pay, tamper
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    obj = transaction(paymob_pay)
    if tamper == "wrong_secret":
        res = await callback(client, obj, signature=sign(obj, "someone_elses_secret"))
    elif tamper == "changed_amount":  # an attacker lowers the amount but keeps the old signature
        res = await callback(client, {**obj, "amount_cents": 1}, signature=sign(obj))
    elif tamper == "missing":
        res = await callback(client, obj, signature="")
    elif tamper == "garbage":
        res = await callback(client, obj, signature="not-a-real-signature")
    elif tamper == "empty":
        res = await callback(client, obj, raw=b"")
    else:
        res = await callback(client, {**obj, "id": 778}, signature=sign(obj))
    assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_signature"
    assert (
        await order_row(o["code"])
    ).status == OrderStatus.pending_payment  # nothing was believed


async def test_a_forged_success_for_someone_elses_order_cannot_pay_this_one(
    client, owner, paymob_pay
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    forged = transaction(paymob_pay, order={"id": 999, "merchant_order_id": "BK-ZZZZZZ-abcdef"})
    res = await callback(
        client, forged
    )  # validly signed (say, a different shop's payment), but matches no payment of ours
    assert res.json()["outcome"] == "unknown_payment"
    assert (await order_row(o["code"])).status == OrderStatus.pending_payment


async def test_callbacks_we_do_not_act_on_still_get_a_200(client, owner, paymob_pay):
    r, *_ = await card_order(client, owner)
    o = r.json()
    declined = transaction(paymob_pay, id=779, success=False)
    pending = transaction(paymob_pay, id=780, pending=True, success=False)
    refund = transaction(paymob_pay, id=781, is_refunded=True)
    void = transaction(paymob_pay, id=782, is_voided=True)
    child = transaction(paymob_pay, id=783, has_parent_transaction=True)
    for obj in (declined, pending, refund, void, child):
        res = await callback(client, obj)
        assert res.status_code == 200 and res.json()["outcome"] == "ignored", obj["id"]
    token_callback = await callback(client, {"token": "abc"}, type_="TOKEN", signature="whatever")
    assert token_callback.status_code == 200 and token_callback.json()["outcome"] == "ignored"
    assert (
        await order_row(o["code"])
    ).status == OrderStatus.pending_payment  # a decline never cancels: the customer can retry
    retry = await callback(client, transaction(paymob_pay, id=784))
    assert retry.json()["outcome"] == "paid"  # and a later success still works


async def test_the_callback_address_is_hidden_unless_paymob_is_the_provider(
    client, owner, monkeypatch
):
    monkeypatch.setattr(get_settings(), "payment_provider", "fake")
    res = await client.post(f"{API}/payments/paymob/webhook", params={"hmac": "x"}, content=b"{}")
    assert res.status_code == 404
    monkeypatch.setattr(get_settings(), "payment_provider", "none")
    assert (await client.post(f"{API}/payments/paymob/webhook", content=b"{}")).status_code == 404


async def test_the_old_stripe_address_no_longer_exists(client):
    assert (await client.post(f"{API}/payments/stripe/webhook", content=b"{}")).status_code in (
        404,
        405,
    )


async def test_a_signature_problem_is_logged_with_the_signed_text_to_help_setup(
    client, owner, paymob_pay, caplog
):
    await card_order(client, owner)
    obj = transaction(paymob_pay)
    with caplog.at_level("WARNING", logger="baker.paymob"):
        await callback(client, obj, signature="bad")
    assert (
        "signature mismatch" in caplog.text
        and "Signed string" in caplog.text
        and HMAC_SECRET not in caplog.text
    )


# ================================================================ late money and refunds
async def test_money_that_arrives_after_the_order_expired_is_refunded(
    client, owner, paymob_pay, emails
):
    r, p, *_ = await card_order(client, owner, daily_capacity=1)
    o = r.json()
    placed = (await order_row(o["code"])).placed_at
    async with SessionLocal() as db:
        assert await expire_unpaid_orders(db, PaymobProvider(), placed + timedelta(hours=1)) == 1
    assert await usage(p["id"]) == (0, 0)
    res = await callback(client, transaction(paymob_pay, id=900))
    assert res.json()["outcome"] == "refunded_late_payment"
    refund = paymob_pay.body("/api/acceptance/void_refund/refund")
    assert refund == {"transaction_id": 900, "amount_cents": 69000}
    row = await order_row(o["code"])
    assert row.status == OrderStatus.cancelled and row.payment_status == PaymentStatus.refunded
    await emails.flush()
    assert any("refunded" in m["text"] for m in emails.sent)


async def test_refund_requests_use_the_secret_key_and_the_paid_transaction(
    client, owner, paymob_pay
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    await callback(client, transaction(paymob_pay, id=555))
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        order = await order_crud.get_by_code(db, o["code"])
        payment = (
            await db.execute(select(Payment).where(Payment.order_id == order.id))
        ).scalar_one()
        await refund_payment(db, PaymobProvider(), order, payment, 5000)
        await refund_payment(db, PaymobProvider(), order, payment)  # the rest
        assert (payment.refunded_amount, payment.status, order.payment_status) == (
            69000,
            PaymentRecordStatus.refunded,
            PaymentStatus.refunded,
        )
    first, second = paymob_pay.calls("/api/acceptance/void_refund/refund")
    assert (
        first.headers["authorization"] == f"Token {SECRET_KEY}"
        and first.url.host == "accept.paymob.com"
    )
    assert json.loads(first.content) == {"transaction_id": 555, "amount_cents": 5000}
    assert json.loads(second.content) == {"transaction_id": 555, "amount_cents": 64000}
    assert (
        paymob_pay.calls("/api/acceptance/void_refund/void") == []
    )  # partial refunds are never voided


async def test_a_full_refund_falls_back_to_a_void_when_paymob_has_not_settled_it(
    client, owner, paymob_pay
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    await callback(client, transaction(paymob_pay, id=556))
    paymob_pay.refund_replies.append(
        httpx.Response(400, json={"message": "Transaction not settled yet"})
    )
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        order = await order_crud.get_by_code(db, o["code"])
        payment = (
            await db.execute(select(Payment).where(Payment.order_id == order.id))
        ).scalar_one()
        await refund_payment(db, PaymobProvider(), order, payment)
        assert payment.status == PaymentRecordStatus.refunded
    assert paymob_pay.body("/api/acceptance/void_refund/void") == {"transaction_id": 556}


async def test_a_refund_paymob_has_only_initiated_counts_as_accepted(client, owner, paymob_pay):
    """Paymob reports a refund it has started but not finished as pending. That is not a failure."""
    r, *_ = await card_order(client, owner)
    o = r.json()
    await callback(client, transaction(paymob_pay, id=558))
    paymob_pay.refund_replies.append(
        httpx.Response(200, json={"id": 8002, "success": False, "pending": True})
    )
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        order = await order_crud.get_by_code(db, o["code"])
        payment = (
            await db.execute(select(Payment).where(Payment.order_id == order.id))
        ).scalar_one()
        await refund_payment(db, PaymobProvider(), order, payment)
        assert payment.status == PaymentRecordStatus.refunded
        assert order.payment_status == PaymentStatus.refunded
    assert paymob_pay.calls("/api/acceptance/void_refund/void") == []  # no second attempt


async def test_a_refund_paymob_refuses_is_reported_not_recorded(client, owner, paymob_pay):
    r, *_ = await card_order(client, owner)
    o = r.json()
    await callback(client, transaction(paymob_pay, id=557))
    paymob_pay.refund_replies.append(
        httpx.Response(
            400,
            json={
                "message": "Requested Refund Amount is greater than the maximum refund amount permissible."
            },
        )
    )
    paymob_pay.void_reply = httpx.Response(400, json={"message": "cannot void"})
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        order = await order_crud.get_by_code(db, o["code"])
        payment = (
            await db.execute(select(Payment).where(Payment.order_id == order.id))
        ).scalar_one()
        with pytest.raises(PaymentProviderError, match="refused"):
            await refund_payment(db, PaymobProvider(), order, payment)
        await db.rollback()
    assert (await payment_rows(o["code"]))[0].refunded_amount == 0


async def test_a_refund_without_a_transaction_id_is_refused_up_front(client, owner, paymob_pay):
    with pytest.raises(PaymentProviderError, match="transaction id"):
        await PaymobProvider().refund(session_ref="501", payment_ref=None, amount=100)
    with pytest.raises(PaymentProviderError, match="transaction id"):
        await PaymobProvider().refund(session_ref="501", payment_ref="pi_not_a_number", amount=100)
    assert paymob_pay.requests == []


async def test_expiring_an_order_does_not_need_paymob(client, owner, paymob_pay):
    r, p, *_ = await card_order(client, owner)
    o = r.json()
    calls_before = len(paymob_pay.requests)
    async with SessionLocal() as db:
        await expire_unpaid_orders(
            db, PaymobProvider(), (await order_row(o["code"])).placed_at + timedelta(hours=1)
        )
    assert (
        len(paymob_pay.requests) == calls_before
    )  # Paymob has no way to close a page; late payments are refunded instead
    assert (await order_row(o["code"])).status == OrderStatus.cancelled
