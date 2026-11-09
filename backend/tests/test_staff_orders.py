import asyncio

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models.order import Order, OrderMessage
from app.models.payment import Payment
from app.services.payments.base import PaymentProviderError
from tests.test_checkout import API, order_body, place, shop, usage
from tests.test_payments import payment_rows, queued
from tests.test_schedule import MON, TUE, at

S = f"{API}/staff"


@pytest.fixture
async def staff(make_headers):
    return await make_headers("staff")


async def cash_order(client, owner, *, qty=1, fulfilment="delivery", **extra):
    z, p, slots = await shop(client, owner)
    body = order_body(
        p["variants"][0]["id"], slots[0], qty=qty, zone_id=z["id"], fulfilment=fulfilment, **extra
    )
    with at(MON):
        r = await place(client, body)
    assert r.status_code == 201, r.text
    return r.json(), p, slots, z


async def order_id(code) -> int:
    async with SessionLocal() as db:
        return (await db.execute(select(Order.id).where(Order.code == code))).scalar_one()


async def act(client, headers, oid, action, **body):
    return await client.post(f"{S}/orders/{oid}/{action}", json=body or None, headers=headers)


async def go(client, headers, oid, to):
    return await client.post(f"{S}/orders/{oid}/transition", json={"to": to}, headers=headers)


# ================================================================ access
async def test_only_staff_and_owner_reach_the_queue(client, owner, staff, make_headers):
    customer = await make_headers("customer")
    assert (await client.get(f"{S}/orders")).status_code == 401
    assert (await client.get(f"{S}/orders", headers=customer)).status_code == 403
    assert (await client.get(f"{S}/orders/summary", headers=customer)).status_code == 403
    assert (await client.get(f"{S}/prep-sheet", headers=customer)).status_code == 403
    assert (await act(client, customer, 1, "accept")).status_code == 403
    assert (await client.get(f"{S}/orders", headers=staff)).status_code == 200
    assert (await client.get(f"{S}/orders", headers=owner)).status_code == 200


# ================================================================ the queue
async def test_the_queue_lists_orders_and_filters_them(client, owner, staff):
    o, p, slots, z = await cash_order(client, owner, qty=2)
    with at(MON):
        pickup = await place(
            client, order_body(p["variants"][0]["id"], slots[1], fulfilment="pickup", day=TUE)
        )
    assert pickup.status_code == 201
    listing = (await client.get(f"{S}/orders", headers=staff)).json()
    assert listing["total"] == 2
    row = next(r for r in listing["items"] if r["code"] == o["code"])
    assert row["status"] == "received" and row["item_count"] == 2 and row["zone_name"] == "Maadi"
    assert row["contact_name"] == "Sara Ali" and row["total"] == 2 * 65000 + 4000

    async def codes(**params):
        r = await client.get(f"{S}/orders", params=params, headers=staff)
        assert r.status_code == 200, r.text
        return [i["code"] for i in r.json()["items"]]

    assert len(await codes(date=str(TUE))) == 2
    assert await codes(date=str(MON)) == []
    assert await codes(fulfilment="pickup") == [pickup.json()["code"]]
    assert await codes(status="received") != [] and await codes(status="accepted") == []
    assert len(await codes(status="active")) == 2 and await codes(status="finished") == []
    assert await codes(q=o["code"].lower()) == [o["code"]]
    assert await codes(q="sara") != [] and await codes(q="nobody") == []
    assert await codes(q="%") == []  # a typed % is text, not a wildcard
    assert (
        await client.get(f"{S}/orders", params={"status": "bogus"}, headers=staff)
    ).status_code == 422


async def test_unpaid_card_orders_stay_out_of_the_queue(client, owner, staff, monkeypatch):
    monkeypatch.setattr(get_settings(), "payment_provider", "fake")
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card"),
        )
    assert r.json()["status"] == "pending_payment"
    assert (await client.get(f"{S}/orders", headers=staff)).json()["total"] == 0
    oid = await order_id(r.json()["code"])
    assert (await client.get(f"{S}/orders/{oid}", headers=staff)).status_code == 404
    assert (await act(client, staff, oid, "accept")).status_code == 404


async def test_summary_counts_by_status(client, owner, staff):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    s = (await client.get(f"{S}/orders/summary", params={"date": str(TUE)}, headers=staff)).json()
    assert s["counts"]["received"] == 1 and s["counts"]["accepted"] == 0 and s["total"] == 1
    assert "pending_payment" not in s["counts"] and s["delayed"] == 0
    await act(client, staff, oid, "accept")
    await act(client, staff, oid, "delay", note="Oven broke")
    s = (await client.get(f"{S}/orders/summary", headers=staff)).json()
    assert s["counts"]["accepted"] == 1 and s["counts"]["received"] == 0 and s["delayed"] == 1


async def test_the_detail_lists_the_allowed_next_steps(client, owner, staff):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    d = (await client.get(f"{S}/orders/{oid}", headers=staff)).json()
    assert d["id"] == oid and d["contact_email"] == "sara@example.com"
    assert sorted((a["to"], a["needs_reason"]) for a in d["actions"]) == [
        ("accepted", False),
        ("cancelled", True),
        ("rejected", True),
    ]
    assert d["can_mark_paid"] is True and d["can_delay"] is True
    assert (await client.get(f"{S}/orders/99999", headers=staff)).status_code == 404


# ================================================================ lifecycle
async def test_a_delivery_order_goes_through_every_stage(client, owner, staff, emails):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    assert (await act(client, staff, oid, "accept")).json()["status"] == "accepted"
    for to in ("preparing", "ready", "out_for_delivery", "delivered"):
        r = await go(client, staff, oid, to)
        assert r.status_code == 200 and r.json()["status"] == to, r.text
    final = r.json()
    assert final["actions"] == [] and final["can_delay"] is False
    assert [e["to_status"] for e in final["events"]] == [
        "received",
        "accepted",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
    ]
    await emails.flush()
    subjects = [m["subject"] for m in emails.sent]
    assert any("is accepted" in s for s in subjects)
    assert any("Out for delivery" in s for s in subjects) and any(
        "Delivered" in s for s in subjects
    )
    assert all(m["to"] == "sara@example.com" for m in emails.sent)


async def test_a_pickup_order_is_collected_not_delivered(client, owner, staff):
    o, *_ = await cash_order(client, owner, fulfilment="pickup")
    oid = await order_id(o["code"])
    for to in ("accepted", "preparing", "ready"):
        assert (await go(client, staff, oid, to)).status_code == 200
    out = await go(client, staff, oid, "out_for_delivery")
    assert out.status_code == 409 and out.json()["error"]["code"] == "invalid_transition"
    assert (await go(client, staff, oid, "picked_up")).json()["status"] == "picked_up"


async def test_stages_cannot_be_skipped_or_repeated(client, owner, staff):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    for to in ("ready", "delivered", "preparing", "received"):
        r = await go(client, staff, oid, to)
        assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition", to
    await act(client, staff, oid, "accept")
    assert (await act(client, staff, oid, "accept")).status_code == 409
    done = (await act(client, staff, oid, "cancel", reason="Oven broke")).json()
    assert done["status"] == "cancelled"
    assert (await go(client, staff, oid, "preparing")).status_code == 409


async def test_the_owner_can_work_the_queue_too(client, owner):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    assert (await act(client, owner, oid, "accept")).json()["status"] == "accepted"


# ================================================================ reject and cancel
async def test_rejecting_gives_back_the_slot_and_tells_the_customer(client, owner, staff, emails):
    o, p, *_ = await cash_order(client, owner, qty=3)
    oid = await order_id(o["code"])
    assert await usage(p["id"]) == (3, 1)
    missing = await act(client, staff, oid, "reject")
    assert missing.status_code == 422
    blank = await act(client, staff, oid, "reject", reason="   ")
    assert blank.status_code == 422 and await usage(p["id"]) == (3, 1)
    r = await act(client, staff, oid, "reject", reason="We are fully booked that day.")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "rejected" and d["rejection_reason"] == "We are fully booked that day."
    assert d["events"][-1]["reason"] == "We are fully booked that day."
    assert await usage(p["id"]) == (0, 0)  # the units and the slot are free again
    await emails.flush()
    mail = next(m for m in emails.sent if "could not take" in m["subject"])
    assert "fully booked" in mail["text"]
    # the customer sees it on the tracking page
    tracked = await client.get(f"{API}/orders/{o['code']}", params={"t": o["tracking_token"]})
    assert tracked.json()["status"] == "rejected"


async def test_cancelling_an_accepted_order_needs_a_reason_and_frees_capacity(
    client, owner, staff, emails
):
    o, p, *_ = await cash_order(client, owner, qty=2)
    oid = await order_id(o["code"])
    await go(client, staff, oid, "accepted")
    await go(client, staff, oid, "preparing")
    assert (await act(client, staff, oid, "cancel")).status_code == 422
    r = await act(client, staff, oid, "cancel", reason="Our oven broke.")
    assert (
        r.json()["status"] == "cancelled" and r.json()["cancellation_reason"] == "Our oven broke."
    )
    assert await usage(p["id"]) == (0, 0)
    await emails.flush()
    assert any("was cancelled" in m["subject"] and "oven broke" in m["text"] for m in emails.sent)


async def test_the_freed_slot_can_be_booked_again(client, owner, staff):
    o, p, slots, z = await cash_order(client, owner, qty=1)
    oid = await order_id(o["code"])
    await act(client, staff, oid, "reject", reason="Closed")
    with at(MON):
        again = await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
    assert again.status_code == 201 and await usage(p["id"]) == (1, 1)


async def test_two_staff_rejecting_at_once_release_the_capacity_once(client, owner, staff):
    o, p, *_ = await cash_order(client, owner, qty=2)
    oid = await order_id(o["code"])
    results = await asyncio.gather(
        act(client, staff, oid, "reject", reason="A"),
        act(client, owner, oid, "reject", reason="B"),
        act(client, staff, oid, "cancel", reason="C"),
    )
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert await usage(p["id"]) == (0, 0)  # never negative: it was released exactly once


# ================================================================ card refunds
async def paid_card_order(client, owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "payment_provider", "fake")
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card"),
        )
        o = r.json()
        await client.post(
            f"{API}/payments/fake/{o['code']}/complete",
            params={"t": o["tracking_token"]},
            json={"outcome": "paid"},
        )
    return o, p


async def test_rejecting_a_paid_card_order_refunds_it(client, owner, staff, monkeypatch, emails):
    o, p = await paid_card_order(client, owner, monkeypatch)
    oid = await order_id(o["code"])
    r = await act(client, staff, oid, "reject", reason="Too busy")
    assert r.status_code == 200 and r.json()["payment_status"] == "refunded"
    (payment,) = await payment_rows(o["code"])
    assert payment.refunded_amount == payment.amount and payment.status.value == "refunded"
    assert await usage(p["id"]) == (0, 0)
    await emails.flush()
    mail = next(m for m in emails.sent if "could not take" in m["subject"])
    assert "refunded" in mail["text"]


async def test_a_failed_refund_changes_nothing(client, owner, staff, monkeypatch):
    o, p = await paid_card_order(client, owner, monkeypatch)
    oid = await order_id(o["code"])

    async def broken(self, **kwargs):
        raise PaymentProviderError("provider down")

    monkeypatch.setattr("app.services.payments.fake_provider.FakeProvider.refund", broken)
    r = await act(client, staff, oid, "cancel", reason="Oven broke")
    assert r.status_code == 502 and r.json()["error"]["code"] == "refund_failed"
    detail = (await client.get(f"{S}/orders/{oid}", headers=staff)).json()
    assert detail["status"] == "received" and detail["payment_status"] == "paid"
    assert await usage(p["id"]) == (1, 1)  # still held: the order is still live
    assert await queued("order_cancelled") == []


async def test_a_cash_order_needs_no_refund(client, owner, staff):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    r = await act(client, staff, oid, "reject", reason="No")
    assert r.json()["payment_status"] == "unpaid"
    async with SessionLocal() as db:
        assert (await db.execute(select(Payment))).first() is None


# ================================================================ delay, messages, cash
async def test_marking_late_tells_the_customer_and_can_be_cleared(client, owner, staff, emails):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    assert (await act(client, staff, oid, "delay")).status_code == 422
    r = await act(client, staff, oid, "delay", note="Running about 30 minutes late.")
    assert r.json()["is_delayed"] is True and "30 minutes" in r.json()["delay_note"]
    tracked = await client.get(f"{API}/orders/{o['code']}", params={"t": o["tracking_token"]})
    assert tracked.json()["is_delayed"] is True
    await emails.flush()
    assert any("running late" in m["subject"] and "30 minutes" in m["text"] for m in emails.sent)
    cleared = await act(client, staff, oid, "clear-delay")
    assert cleared.json()["is_delayed"] is False and cleared.json()["delay_note"] is None


async def test_a_finished_order_cannot_be_marked_late_and_loses_its_flag(client, owner, staff):
    o, *_ = await cash_order(client, owner, fulfilment="pickup")
    oid = await order_id(o["code"])
    await act(client, staff, oid, "delay", note="Late")
    for to in ("accepted", "preparing", "ready", "picked_up"):
        await go(client, staff, oid, to)
    final = (await client.get(f"{S}/orders/{oid}", headers=staff)).json()
    assert final["status"] == "picked_up" and final["is_delayed"] is False
    late = await act(client, staff, oid, "delay", note="Late")
    assert late.status_code == 409 and late.json()["error"]["code"] == "not_active"


async def test_staff_can_message_the_customer(client, owner, staff, emails):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    assert (await act(client, staff, oid, "messages", body="  ")).status_code == 422
    r = await act(client, staff, oid, "messages", body="Could you confirm the floor number?")
    assert r.status_code == 201 and [m["body"] for m in r.json()["messages"]] == [
        "Could you confirm the floor number?"
    ]
    await emails.flush()
    mail = next(m for m in emails.sent if "A message about" in m["subject"])
    assert mail["to"] == "sara@example.com" and "confirm the floor" in mail["text"]
    async with SessionLocal() as db:
        saved = (await db.execute(select(OrderMessage))).scalar_one()
    assert saved.author_user_id is not None
    again = (await client.get(f"{S}/orders/{oid}", headers=staff)).json()
    assert len(again["messages"]) == 1


async def test_cash_collected_is_recorded_once(client, owner, staff):
    o, *_ = await cash_order(client, owner)
    oid = await order_id(o["code"])
    r = await act(client, staff, oid, "mark-paid")
    assert r.status_code == 200 and r.json()["payment_status"] == "paid"
    assert r.json()["can_mark_paid"] is False
    again = await act(client, staff, oid, "mark-paid")
    assert again.status_code == 409 and again.json()["error"]["code"] == "cannot_mark_paid"


async def test_cash_cannot_be_recorded_on_a_card_order(client, owner, staff, monkeypatch):
    card, _ = await paid_card_order(client, owner, monkeypatch)
    assert (await act(client, staff, await order_id(card["code"]), "mark-paid")).status_code == 409


async def test_cash_cannot_be_recorded_on_a_rejected_order(client, owner, staff):
    cash, *_ = await cash_order(client, owner)
    oid = await order_id(cash["code"])
    await act(client, staff, oid, "reject", reason="No")
    assert (await act(client, staff, oid, "mark-paid")).status_code == 409


# ================================================================ prep sheet
async def test_the_prep_sheet_adds_up_a_day(client, owner, staff):
    z, p, slots = await shop(client, owner)
    small, big = p["variants"][0]["id"], p["variants"][1]["id"]

    def body(variant, qty, slot, inscription=None):
        b = order_body(variant, slot, qty=qty, zone_id=z["id"])
        b["items"][0]["inscription"] = inscription
        return b

    with at(MON):
        a = await place(client, body(small, 2, slots[0], "Happy Birthday Sara"))
        await place(client, body(small, 1, slots[1]))
        await place(client, body(big, 1, slots[1]))
        dead = await place(client, body(small, 4, slots[2], "Cancelled cake"))
    await act(client, staff, await order_id(dead.json()["code"]), "reject", reason="No")
    assert a.status_code == 201

    sheet = (await client.get(f"{S}/prep-sheet", params={"date": str(TUE)}, headers=staff)).json()
    assert sheet["order_count"] == 3 and sheet["total_units"] == 4
    lines = {ln["variant_name"]: (ln["quantity"], ln["orders"]) for ln in sheet["lines"]}
    assert lines == {"6-inch": (3, 2), "8-inch": (1, 1)}
    assert [(m["order_code"], m["text"]) for m in sheet["messages"]] == [
        (a.json()["code"], "Happy Birthday Sara")
    ]
    empty = (await client.get(f"{S}/prep-sheet", params={"date": str(MON)}, headers=staff)).json()
    assert empty["lines"] == [] and empty["total_units"] == 0
