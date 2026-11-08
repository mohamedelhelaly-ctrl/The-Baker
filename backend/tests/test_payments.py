from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.core.clock import utcnow
from app.core.security import tracking_token
from app.database import SessionLocal
from app.models.notification import Notification
from app.models.order import Order, OrderStatus, PaymentStatus
from app.models.payment import Payment, PaymentRecordStatus
from app.services.payments.base import PaymentEvent, PaymentProviderError
from app.services.payments.service import (
    ORDER_EXPIRY_MINUTES,
    apply_event,
    expire_unpaid_orders,
    refund_payment,
)
from tests.test_admin_catalog import A
from tests.test_checkout import API, order_body, order_count, place, shop, usage
from tests.test_schedule import MON, at


@pytest.fixture
def fake_pay(monkeypatch):
    monkeypatch.setattr(get_settings(), "payment_provider", "fake")


async def card_order(client, owner, *, key=None, qty=1, headers=None, **shop_extra):
    z, p, slots = await shop(client, owner, **shop_extra)
    body = order_body(
        p["variants"][0]["id"], slots[0], qty=qty, zone_id=z["id"], payment_method="card"
    )
    with at(MON):
        r = await place(client, body, idem=key, headers=headers)
    return r, p, slots, z


async def payment_rows(order_code):
    async with SessionLocal() as db:
        oid = (await db.execute(select(Order.id).where(Order.code == order_code))).scalar_one()
        return list(
            (
                await db.execute(
                    select(Payment).where(Payment.order_id == oid).order_by(Payment.id)
                )
            ).scalars()
        )


async def order_row(code) -> Order:
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        return await order_crud.get_by_code(db, code)


async def queued(template_key=None):
    async with SessionLocal() as db:
        q = select(Notification).order_by(Notification.id)
        if template_key:
            q = q.where(Notification.template_key == template_key)
        return list((await db.execute(q)).scalars())


# ================================================================== payment methods
async def test_store_lists_the_methods_checkout_can_offer(client, owner, monkeypatch):
    assert (await client.get(f"{API}/store")).json()["payment_methods"] == [
        "cod"
    ]  # no provider configured
    monkeypatch.setattr(get_settings(), "payment_provider", "fake")
    assert (await client.get(f"{API}/store")).json()["payment_methods"] == ["cod", "card"]
    await client.patch(f"{A}/payments", json={"card_enabled": False}, headers=owner)
    assert (await client.get(f"{API}/store")).json()["payment_methods"] == ["cod"]
    await client.patch(
        f"{A}/payments", json={"card_enabled": True, "cod_enabled": False}, headers=owner
    )
    assert (await client.get(f"{API}/store")).json()["payment_methods"] == ["card"]


async def test_at_least_one_method_stays_on_and_only_the_owner_changes_it(
    client, owner, make_headers
):
    both_off = await client.patch(
        f"{A}/payments", json={"card_enabled": False, "cod_enabled": False}, headers=owner
    )
    assert both_off.status_code == 422 and both_off.json()["error"]["code"] == "no_payment_method"
    assert (
        await client.patch(f"{A}/payments", json={"cod_enabled": None}, headers=owner)
    ).status_code == 422
    for role in ("staff", "customer"):
        h = await make_headers(role)
        assert (await client.get(f"{A}/payments", headers=h)).status_code == 403
        assert (
            await client.patch(f"{A}/payments", json={"card_enabled": False}, headers=h)
        ).status_code == 403
    assert (await client.get(f"{A}/payments")).status_code == 401


async def test_card_is_refused_when_not_set_up_or_switched_off(client, owner, monkeypatch):
    z, p, slots = await shop(client, owner)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card")
    with at(MON):
        not_set_up = await place(client, body)
        monkeypatch.setattr(get_settings(), "payment_provider", "fake")
        await client.patch(f"{A}/payments", json={"card_enabled": False}, headers=owner)
        switched_off = await place(client, body)
    assert (
        not_set_up.status_code == 422 and not_set_up.json()["error"]["code"] == "card_unavailable"
    )
    assert switched_off.json()["error"]["code"] == "card_unavailable" and await order_count() == 0


async def test_cash_is_refused_when_switched_off(client, owner, fake_pay):
    z, p, slots = await shop(client, owner)
    await client.patch(f"{A}/payments", json={"cod_enabled": False}, headers=owner)
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="cod"),
        )
    assert r.status_code == 422 and r.json()["error"]["code"] == "cod_unavailable"


# ============================================================ card flow (demo provider)
async def test_card_order_waits_for_payment_and_holds_the_slot(client, owner, fake_pay):
    r, p, slots, z = await card_order(client, owner, qty=2)
    o = r.json()
    assert r.status_code == 201, r.text
    assert (
        o["status"] == "pending_payment"
        and o["payment_status"] == "pending"
        and o["payment_method"] == "card"
    )
    assert o["payment_url"].endswith(f"/fake-pay/{o['code']}?t={tracking_token(o['code'])}")
    assert [(e["from_status"], e["to_status"]) for e in o["events"]] == [(None, "pending_payment")]
    assert await usage(p["id"]) == (2, 1)  # reserved immediately, so nobody else can take it
    rows = await payment_rows(o["code"])
    assert (
        len(rows) == 1
        and rows[0].status == PaymentRecordStatus.pending
        and rows[0].amount == o["total"] == 134000
    )
    assert await queued("order_confirmed") == []  # no confirmation until it is paid


async def test_retrying_a_card_checkout_returns_the_same_payment_page(client, owner, fake_pay):
    z, p, slots = await shop(client, owner)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card")
    with at(MON):
        first = await place(client, body, idem="card-retry-1234")
        again = await place(client, body, idem="card-retry-1234")
    assert (first.status_code, again.status_code) == (201, 200)
    assert (
        again.json()["payment_url"] == first.json()["payment_url"]
        and again.json()["code"] == first.json()["code"]
    )
    assert len(await payment_rows(first.json()["code"])) == 1 and await order_count() == 1


async def test_paying_confirms_the_order_and_sends_the_email(client, owner, fake_pay, emails):
    r, p, *_ = await card_order(client, owner)
    o = r.json()
    with at(MON):
        done = await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "paid"},
        )
    assert done.status_code == 200 and done.json()["outcome"] == "paid"
    after = (
        await client.get(f"{API}/orders/{o['code']}", params={"t": o["tracking_token"]})
    ).json()
    assert after["status"] == "received" and after["payment_status"] == "paid"
    assert [(e["from_status"], e["to_status"]) for e in after["events"]] == [
        (None, "pending_payment"),
        ("pending_payment", "received"),
    ]
    assert (await payment_rows(o["code"]))[0].status == PaymentRecordStatus.paid
    assert await emails.flush() == 1
    mail = emails.sent[0]
    assert mail["to"] == "sara@example.com" and o["code"] in mail["subject"]
    assert (
        "Paid by card" in mail["text"]
        and f"/track/{o['code']}?t=" in mail["text"]
        and "Chocolate Cake" in mail["text"]
    )
    again = await client.post(
        f"{API}/payments/fake/{o['code']}/complete",
        params={"t": o["tracking_token"]},
        json={"outcome": "paid"},
    )
    assert again.status_code == 409 and again.json()["error"]["code"] == "not_awaiting_payment"


async def test_an_abandoned_payment_releases_the_slot(client, owner, fake_pay, emails):
    r, p, *_ = await card_order(client, owner, daily_capacity=1)
    o = r.json()
    with at(MON):
        gone = await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "expired"},
        )
    assert gone.json()["outcome"] == "cancelled"
    after = (
        await client.get(f"{API}/orders/{o['code']}", params={"t": o["tracking_token"]})
    ).json()
    assert (
        after["status"] == "cancelled"
        and after["payment_status"] == "failed"
        and "not completed" in after["cancellation_reason"]
    )
    assert await usage(p["id"]) == (0, 0)  # the last cake is for sale again
    await emails.flush()
    assert (
        emails.sent[0]["subject"].startswith("Your order")
        and "cancelled" in emails.sent[0]["subject"]
    )


async def test_demo_payment_endpoint_is_locked_down(client, owner, fake_pay, monkeypatch):
    r, *_ = await card_order(client, owner)
    o = r.json()
    url = f"{API}/payments/fake/{o['code']}/complete"
    assert (
        await client.post(url, params={"t": "wrong"}, json={"outcome": "paid"})
    ).status_code == 404
    assert (await client.post(url, json={"outcome": "paid"})).status_code == 404
    assert (
        await client.post(url, params={"t": o["tracking_token"]}, json={"outcome": "refunded"})
    ).status_code == 422
    monkeypatch.setattr(get_settings(), "payment_provider", "none")
    assert (
        await client.post(url, params={"t": o["tracking_token"]}, json={"outcome": "paid"})
    ).status_code == 404


async def test_payment_link_reuses_the_open_page_and_refuses_what_cannot_be_paid(
    client, owner, fake_pay
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    link = f"{API}/orders/{o['code']}/payment-link"
    with at(MON):
        a = await client.post(link, params={"t": o["tracking_token"]})
        b = await client.post(link, params={"t": o["tracking_token"]})
    assert (
        a.status_code == 200
        and a.json()["payment_url"] == b.json()["payment_url"] == o["payment_url"]
    )
    assert (await client.post(link, params={"t": "nope"})).status_code == 404
    assert (await client.post(link)).status_code == 404
    with at(MON, 8, 36):  # the order was placed at 08:00 and the time to pay is 35 minutes
        expired = await client.post(link, params={"t": o["tracking_token"]})
    assert expired.status_code == 409 and expired.json()["error"]["code"] == "payment_expired"
    with at(MON):
        await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "paid"},
        )
        paid = await client.post(link, params={"t": o["tracking_token"]})
    assert paid.status_code == 409 and paid.json()["error"]["code"] == "not_awaiting_payment"


async def test_cash_orders_have_no_payment_link(client, owner, fake_pay):
    z, p, slots = await shop(client, owner)
    with at(MON):
        o = (
            await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
        ).json()
        r = await client.post(
            f"{API}/orders/{o['code']}/payment-link", params={"t": o["tracking_token"]}
        )
    assert r.status_code == 409 and o["payment_url"] is None


async def test_if_the_payment_page_cannot_be_opened_nothing_is_kept_and_a_retry_works(
    client, owner, fake_pay, monkeypatch
):
    from app.services.payments.fake_provider import FakeProvider

    z, p, slots = await shop(client, owner, daily_capacity=1)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card")
    real = FakeProvider.create_checkout
    calls = {"n": 0}

    async def flaky(self, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise PaymentProviderError("provider down")
        return await real(self, **kwargs)

    monkeypatch.setattr(FakeProvider, "create_checkout", flaky)
    with at(MON):
        failed = await place(client, body, idem="same-key-for-retry")
        assert failed.status_code == 502 and failed.json()["error"]["code"] == "payment_unavailable"
        assert await usage(p["id"]) == (0, 0)  # the slot and the last cake are free again
        retry = await place(
            client, body, idem="same-key-for-retry"
        )  # same key: must create a NEW order
    assert retry.status_code == 201 and retry.json()["payment_url"]
    async with SessionLocal() as db:
        statuses = sorted(s.value for s in (await db.execute(select(Order.status))).scalars())
    assert statuses == ["cancelled", "pending_payment"]


# ===================================================================== expiry and late money
async def test_unpaid_card_orders_expire_and_free_their_capacity(client, owner, fake_pay, emails):
    r, p, *_ = await card_order(client, owner, daily_capacity=1)
    o = r.json()
    placed = (await order_row(o["code"])).placed_at
    from app.services.payments import get_payment_provider

    async with SessionLocal() as db:
        early = await expire_unpaid_orders(
            db, get_payment_provider(), placed + timedelta(minutes=ORDER_EXPIRY_MINUTES - 1)
        )
    assert early == 0 and (await order_row(o["code"])).status == OrderStatus.pending_payment
    async with SessionLocal() as db:
        assert (
            await expire_unpaid_orders(
                db, get_payment_provider(), placed + timedelta(minutes=ORDER_EXPIRY_MINUTES + 1)
            )
            == 1
        )
    row = await order_row(o["code"])
    assert row.status == OrderStatus.cancelled and row.payment_status == PaymentStatus.failed
    assert (await payment_rows(o["code"]))[0].status == PaymentRecordStatus.failed
    assert await usage(p["id"]) == (0, 0)
    async with SessionLocal() as db:
        assert (
            await expire_unpaid_orders(db, get_payment_provider(), placed + timedelta(hours=2)) == 0
        )  # nothing left to do
    await emails.flush()
    assert len(emails.sent) == 1 and "cancelled" in emails.sent[0]["subject"]


async def test_expiry_leaves_paid_and_cash_orders_alone(client, owner, fake_pay):
    z, p, slots = await shop(client, owner)
    with at(MON):
        cash = (
            await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
        ).json()
        card = (
            await place(
                client,
                order_body(
                    p["variants"][0]["id"], slots[1], zone_id=z["id"], payment_method="card"
                ),
            )
        ).json()
        await client.post(
            f"{API}/payments/fake/{card['code']}/complete",
            params={"t": card["tracking_token"]},
            json={"outcome": "paid"},
        )
    from app.services.payments import get_payment_provider

    async with SessionLocal() as db:
        assert (
            await expire_unpaid_orders(db, get_payment_provider(), utcnow() + timedelta(days=400))
            == 0
        )
    assert (await order_row(cash["code"])).status == OrderStatus.received
    assert (await order_row(card["code"])).status == OrderStatus.received


async def test_money_arriving_after_expiry_is_refunded_not_kept(client, owner, fake_pay, emails):
    r, *_ = await card_order(client, owner)
    o = r.json()
    from app.services.payments import get_payment_provider

    provider = get_payment_provider()
    async with SessionLocal() as db:
        await expire_unpaid_orders(
            db, provider, (await order_row(o["code"])).placed_at + timedelta(hours=1)
        )
    pay = (await payment_rows(o["code"]))[0]
    async with SessionLocal() as db:
        outcome = await apply_event(
            db,
            provider,
            PaymentEvent("evt_late", "paid", o["code"], pay.provider_ref, "pi_late", o["total"]),
        )
    assert outcome == "refunded_late_payment"
    row = await order_row(o["code"])
    pay = (await payment_rows(o["code"]))[0]
    assert row.status == OrderStatus.cancelled and row.payment_status == PaymentStatus.refunded
    assert pay.status == PaymentRecordStatus.refunded and pay.refunded_amount == pay.amount
    await emails.flush()
    assert any("refunded" in m["text"] for m in emails.sent)


async def test_a_second_payment_for_an_already_paid_order_is_refunded(client, owner, fake_pay):
    r, *_ = await card_order(client, owner)
    o = r.json()
    with at(MON):
        await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "paid"},
        )
        second = await client.post(
            f"{API}/orders/{o['code']}/payment-link", params={"t": o["tracking_token"]}
        )
    assert second.status_code == 409  # cannot even open a second page for a paid order
    from app.services.payments import get_payment_provider

    # But if one was already open (two tabs), the duplicate payment is sent back.
    async with SessionLocal() as db:
        order = await db.scalar(select(Order).where(Order.code == o["code"]))
        db.add(
            Payment(
                order_id=order.id,
                provider="fake",
                provider_ref="fake_second",
                amount=order.total,
                status=PaymentRecordStatus.pending,
                created_at=utcnow(),
            )
        )
        await db.commit()
    async with SessionLocal() as db:
        outcome = await apply_event(
            db,
            get_payment_provider(),
            PaymentEvent("evt_dup_pay", "paid", o["code"], "fake_second", "pi_2", o["total"]),
        )
    assert outcome == "refunded_late_payment"
    row = await order_row(o["code"])
    assert (
        row.status == OrderStatus.received and row.payment_status == PaymentStatus.paid
    )  # still paid by the first


async def test_events_are_processed_once_and_unknown_ones_are_harmless(
    client, owner, fake_pay, emails
):
    r, *_ = await card_order(client, owner)
    o = r.json()
    from app.services.payments import get_payment_provider

    provider = get_payment_provider()
    ref = (await payment_rows(o["code"]))[0].provider_ref
    event = PaymentEvent("evt_same", "paid", o["code"], ref, "pi_1", o["total"])
    async with SessionLocal() as db:
        first = await apply_event(db, provider, event)
    async with SessionLocal() as db:
        second = await apply_event(db, provider, event)
        third = await apply_event(
            db, provider, PaymentEvent("evt_x", "paid", "BK-ZZZZZZ", "cs_unknown", None, 1)
        )
        ignored = await apply_event(db, provider, PaymentEvent("evt_i", "ignored"))
    assert (first, second, third, ignored) == ("paid", "duplicate", "unknown_payment", "ignored")
    await emails.flush()
    assert len(emails.sent) == 1  # one confirmation, not two


async def test_refund_records_partial_and_full_amounts(client, owner, fake_pay):
    r, *_ = await card_order(client, owner)
    o = r.json()
    with at(MON):
        await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "paid"},
        )
    from app.crud.order import order_crud
    from app.services.payments import get_payment_provider

    provider = get_payment_provider()
    async with SessionLocal() as db:
        order = await order_crud.get_by_code(db, o["code"])
        payment = (
            await db.execute(select(Payment).where(Payment.order_id == order.id))
        ).scalar_one()
        await refund_payment(db, provider, order, payment, 34000)
        assert (payment.refunded_amount, payment.status, order.payment_status) == (
            34000,
            PaymentRecordStatus.partially_refunded,
            PaymentStatus.partially_refunded,
        )
        await refund_payment(db, provider, order, payment)  # the rest
        assert (payment.refunded_amount, payment.status, order.payment_status) == (
            69000,
            PaymentRecordStatus.refunded,
            PaymentStatus.refunded,
        )
