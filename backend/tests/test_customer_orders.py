import asyncio
from datetime import datetime

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.core.clock import STORE_TZ
from app.database import SessionLocal
from app.models.order import Order
from app.services.payments.base import PaymentProviderError
from tests.test_admin_catalog import A
from tests.test_checkout import API, order_body, place, shop, slot_ids, usage, zone
from tests.test_payments import payment_rows, queued
from tests.test_schedule import MON, TUE, WED, at

ME = f"{API}/me"


# ============================================================ policy (owner)
async def test_the_owner_sets_the_window_and_the_refund_policy(client, owner, make_headers):
    default = (await client.get(f"{A}/policies", headers=owner)).json()
    assert default["cancellation_window_hours"] == 24 and default["refund_policy"] == "full"
    assert "24 hours before its time slot" in default["preview"]
    r = await client.put(
        f"{A}/policies",
        json={
            "cancellation_window_hours": 12,
            "refund_policy": "percentage",
            "refund_percentage": 80,
            "policy_note": "Custom cakes cannot be cancelled.",
        },
        headers=owner,
    )
    assert r.status_code == 200
    text = r.json()["preview"]
    assert (
        "12 hours" in text and "80%" in text and text.endswith("Custom cakes cannot be cancelled.")
    )
    store = (await client.get(f"{API}/store")).json()
    assert store["cancellation_window_hours"] == 12 and store["policy_text"] == text
    for role in ("staff", "customer"):
        h = await make_headers(role)
        assert (await client.get(f"{A}/policies", headers=h)).status_code == 403
        assert (
            await client.put(
                f"{A}/policies",
                json={"cancellation_window_hours": 1, "refund_policy": "none"},
                headers=h,
            )
        ).status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"cancellation_window_hours": -1, "refund_policy": "full"},
        {"cancellation_window_hours": 1000, "refund_policy": "full"},
        {"cancellation_window_hours": 24, "refund_policy": "percentage", "refund_percentage": 0},
        {"cancellation_window_hours": 24, "refund_policy": "percentage", "refund_percentage": 100},
        {"cancellation_window_hours": 24, "refund_policy": "sometimes"},
    ],
)
async def test_nonsense_policies_are_refused(client, owner, body):
    r = await client.put(f"{A}/policies", json=body, headers=owner)
    assert r.status_code == 422


# ============================================================ helpers
async def cash_order(client, owner, *, qty=1, headers=None, fulfilment="delivery"):
    z, p, slots = await shop(client, owner)
    body = order_body(
        p["variants"][0]["id"], slots[0], qty=qty, zone_id=z["id"], fulfilment=fulfilment
    )
    with at(MON):
        r = await place(client, body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json(), p, slots, z


def track(o):
    return {"t": o["tracking_token"]}


async def get(client, o, hour=8, **kw):
    with at(MON, hour):
        return (await client.get(f"{API}/orders/{o['code']}", **kw, params=track(o))).json()


async def cancel(client, o, hour=8, headers=None, **body):
    with at(MON, hour):
        return await client.post(
            f"{API}/orders/{o['code']}/cancel", params=track(o), json=body or None, headers=headers
        )


async def change(client, o, hour=8, headers=None, **body):
    with at(MON, hour):
        return await client.patch(
            f"{API}/orders/{o['code']}", params=track(o), json=body, headers=headers
        )


async def staff_act(client, headers, code, action, **body):
    async with SessionLocal() as db:
        oid = (await db.execute(select(Order.id).where(Order.code == code))).scalar_one()
    return await client.post(
        f"{API}/staff/orders/{oid}/{action}", json=body or None, headers=headers
    )


async def row(code) -> Order:
    from app.crud.order import order_crud

    async with SessionLocal() as db:
        return await order_crud.get_by_code(db, code)


# ============================================================ what the customer sees
async def test_the_order_says_until_when_it_can_be_changed(client, owner):
    o, *_ = await cash_order(client, owner)
    view = await get(client, o, hour=8)
    assert view["can_change"] is True and view["cancel_refund"] is None  # cash: nothing to refund
    deadline = view["can_modify_until"]
    # the slot starts Tuesday 10:00 Cairo time and the window is 24 hours, so Monday 10:00
    assert datetime.fromisoformat(deadline) == datetime(2026, 11, 9, 10, 0, tzinfo=STORE_TZ)
    late = await get(client, o, hour=11)  # after Monday 10:00, which is 24 h before the slot
    assert late["can_change"] is False and late["can_modify_until"] == deadline


# ============================================================ cancelling
async def test_a_guest_cancels_with_their_link_and_the_slot_is_freed(client, owner, emails):
    o, p, *_ = await cash_order(client, owner, qty=2)
    assert await usage(p["id"]) == (2, 1)
    r = await cancel(client, o, reason="Plans changed")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "cancelled" and "Plans changed" in d["cancellation_reason"]
    assert d["can_change"] is False
    assert await usage(p["id"]) == (0, 0)
    await emails.flush()
    mail = next(m for m in emails.sent if "was cancelled" in m["subject"])
    assert "You cancelled this order" in mail["text"] and mail["to"] == "sara@example.com"
    again = await cancel(client, o)
    assert again.status_code == 409 and again.json()["error"]["code"] == "cannot_change"


async def test_cancelling_is_refused_once_the_window_has_closed(client, owner):
    o, p, *_ = await cash_order(client, owner)
    r = await cancel(client, o, hour=11)
    assert r.status_code == 409 and r.json()["error"]["code"] == "window_closed"
    assert (await get(client, o))["status"] == "received" and await usage(p["id"]) == (1, 1)


async def test_the_owner_can_make_the_window_shorter(client, owner):
    o, *_ = await cash_order(client, owner)
    await client.put(
        f"{A}/policies",
        json={"cancellation_window_hours": 2, "refund_policy": "full"},
        headers=owner,
    )
    assert (await cancel(client, o, hour=11)).status_code == 200  # Monday 11:00 is 23 h before


async def test_an_accepted_order_can_still_be_cancelled_but_not_one_being_prepared(
    client, owner, make_headers
):
    staff = await make_headers("staff")
    o, *_ = await cash_order(client, owner)
    await staff_act(client, staff, o["code"], "accept")
    preparing = await staff_act(client, staff, o["code"], "transition", to="preparing")
    assert preparing.status_code == 200
    r = await cancel(client, o)
    assert r.status_code == 409 and r.json()["error"]["code"] == "cannot_change"
    assert (await get(client, o))["can_change"] is False


async def test_only_the_customer_can_cancel_their_order(client, owner, make_headers):
    mine = await make_headers("customer")
    other = await make_headers("customer")
    staff = await make_headers("staff")
    o, *_ = await cash_order(client, owner, headers=mine)
    with at(MON):
        wrong_token = await client.post(f"{API}/orders/{o['code']}/cancel", params={"t": "nope"})
        stranger = await client.post(f"{API}/orders/{o['code']}/cancel", headers=other)
        staff_try = await client.post(f"{API}/orders/{o['code']}/cancel", headers=staff)
        nobody = await client.post(f"{API}/orders/{o['code']}/cancel")
    assert [r.status_code for r in (wrong_token, stranger, staff_try, nobody)] == [404] * 4
    with at(MON):
        own = await client.post(f"{API}/orders/{o['code']}/cancel", headers=mine)
    assert own.status_code == 200 and own.json()["status"] == "cancelled"


async def test_two_cancel_requests_at_once_free_the_slot_only_once(client, owner):
    o, p, *_ = await cash_order(client, owner, qty=2)
    with at(MON):
        results = await asyncio.gather(
            *[client.post(f"{API}/orders/{o['code']}/cancel", params=track(o)) for _ in range(3)]
        )
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert await usage(p["id"]) == (0, 0)


# ============================================================ cancelling a paid card order
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
            params=track(o),
            json={"outcome": "paid"},
        )
    return o, p


async def set_policy(client, owner, **body):
    body.setdefault("cancellation_window_hours", 24)
    r = await client.put(f"{A}/policies", json=body, headers=owner)
    assert r.status_code == 200, r.text


async def test_a_full_refund_policy_returns_everything(client, owner, monkeypatch, emails):
    o, p = await paid_card_order(client, owner, monkeypatch)
    view = await get(client, o)
    assert view["cancel_refund"] == o["total"]  # the screen can say exactly how much comes back
    r = await cancel(client, o)
    assert r.status_code == 200 and r.json()["payment_status"] == "refunded"
    (payment,) = await payment_rows(o["code"])
    assert payment.refunded_amount == payment.amount
    await emails.flush()
    assert any("refunded in full" in m["text"] for m in emails.sent)
    assert await usage(p["id"]) == (0, 0)


async def test_a_percentage_policy_keeps_the_rest(client, owner, monkeypatch, emails):
    await set_policy(client, owner, refund_policy="percentage", refund_percentage=80)
    o, _ = await paid_card_order(client, owner, monkeypatch)
    assert (await get(client, o))["cancel_refund"] == o["total"] * 80 // 100
    r = await cancel(client, o)
    assert r.json()["payment_status"] == "partially_refunded"
    (payment,) = await payment_rows(o["code"])
    assert payment.refunded_amount == o["total"] * 80 // 100
    await emails.flush()
    assert any("Part of your card payment" in m["text"] for m in emails.sent)


async def test_a_no_refund_policy_cancels_without_touching_the_payment(
    client, owner, monkeypatch, emails
):
    await set_policy(client, owner, refund_policy="none")
    o, p = await paid_card_order(client, owner, monkeypatch)
    assert (await get(client, o))["cancel_refund"] == 0
    r = await cancel(client, o)
    assert r.status_code == 200 and r.json()["payment_status"] == "paid"
    (payment,) = await payment_rows(o["code"])
    assert payment.refunded_amount == 0
    assert await usage(p["id"]) == (0, 0)
    await emails.flush()
    assert any("not refunded" in m["text"] for m in emails.sent)


async def test_a_failed_refund_leaves_the_order_as_it_was(client, owner, monkeypatch):
    o, p = await paid_card_order(client, owner, monkeypatch)

    async def broken(self, **kwargs):
        raise PaymentProviderError("provider down")

    monkeypatch.setattr("app.services.payments.fake_provider.FakeProvider.refund", broken)
    r = await cancel(client, o)
    assert r.status_code == 502 and r.json()["error"]["code"] == "refund_failed"
    assert (await get(client, o))["status"] == "received"
    assert await usage(p["id"]) == (1, 1) and await queued("order_cancelled") == []


# ============================================================ changing an order
async def test_changing_the_time_slot_moves_the_reservation(client, owner, emails):
    o, p, slots, _ = await cash_order(client, owner)
    r = await change(client, o, slot_id=slots[1])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["slot_starts_at"] != o["slot_starts_at"] and d["status"] == "received"
    assert d["events"][-1]["reason"] == "The customer changed the order."
    assert await usage(p["id"]) == (1, 1)  # still one cake, still one slot, never counted twice
    async with SessionLocal() as db:
        from app.models.schedule import SlotDailyUsage

        used = {
            u.time_slot_id: u.reserved_orders
            for u in (await db.execute(select(SlotDailyUsage))).scalars()
        }
    assert used.get(slots[0], 0) == 0 and used[slots[1]] == 1
    await emails.flush()
    assert any("was updated" in m["subject"] for m in emails.sent)


async def test_changing_the_date_moves_the_reservation_to_that_day(client, owner):
    o, p, slots, _ = await cash_order(client, owner)
    wed_slots = await slot_ids(client, owner, weekday=2)
    r = await change(client, o, date=str(WED), slot_id=wed_slots[0])
    assert r.status_code == 200, r.text
    assert r.json()["fulfilment_date"] == str(WED)
    assert await usage(p["id"], TUE) == (0, 0) and await usage(p["id"], WED) == (1, 1)


async def test_a_full_slot_is_refused_and_nothing_changes(client, owner):
    o, p, slots, z = await cash_order(client, owner)
    with at(MON):  # fill the second slot (2 orders each)
        for _ in range(2):
            filled = await place(
                client, order_body(p["variants"][0]["id"], slots[1], zone_id=z["id"])
            )
            assert filled.status_code == 201
    r = await change(client, o, slot_id=slots[1])
    assert r.status_code == 409 and r.json()["error"]["code"] == "cannot_change_to_that"
    d = await get(client, o)
    assert d["slot_starts_at"] == o["slot_starts_at"]
    assert await usage(p["id"]) == (3, 3)  # the original reservation is intact


async def test_changing_only_the_address_or_notes_does_not_recheck_the_date(client, owner):
    o, p, slots, z = await cash_order(client, owner)
    new_address = {"street": "7 Nile Corniche", "building": "12", "floor": "2"}
    # late on Monday the lead time rules would reject a brand-new booking for Tuesday, but the
    # date is not being changed, so the order simply keeps its place
    r = await change(client, o, hour=9, address=new_address, customer_notes="Please ring twice")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["delivery_address"]["street"] == "7 Nile Corniche"
    assert d["customer_notes"] == "Please ring twice"
    assert await usage(p["id"]) == (1, 1)
    cleared = await change(client, o, customer_notes="  ")
    assert cleared.json()["customer_notes"] is None


async def test_a_cash_order_can_move_to_an_area_with_another_fee(client, owner):
    o, p, slots, z = await cash_order(client, owner)
    far = await zone(client, owner, name="New Cairo", fee=9000)
    r = await change(client, o, zone_id=far["id"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["zone_name"] == "New Cairo" and d["delivery_fee"] == 9000
    assert d["total"] == d["subtotal"] + 9000


async def test_a_paid_card_order_cannot_change_its_delivery_fee(client, owner, monkeypatch):
    o, _ = await paid_card_order(client, owner, monkeypatch)
    far = await zone(client, owner, name="New Cairo", fee=9000)
    same = await zone(client, owner, name="Zamalek", fee=4000)
    refused = await change(client, o, zone_id=far["id"])
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "fee_differs"
    allowed = await change(client, o, zone_id=same["id"])
    assert allowed.status_code == 200 and allowed.json()["total"] == o["total"]
    assert (await payment_rows(o["code"]))[0].amount == o["total"]  # the payment still matches


async def test_a_card_order_can_change_its_slot(client, owner, monkeypatch):
    o, p = await paid_card_order(client, owner, monkeypatch)
    slots = await slot_ids(client, owner, weekday=1)
    r = await change(client, o, slot_id=slots[2])
    assert r.status_code == 200 and r.json()["payment_status"] == "paid"
    assert await usage(p["id"]) == (1, 1)


async def test_other_changes_are_refused_with_a_clear_reason(client, owner):
    o, p, slots, z = await cash_order(client, owner)
    pickup, *_ = await cash_order_pickup(client, p, slots)
    nothing = await change(client, o)
    assert nothing.status_code == 422 and nothing.json()["error"]["code"] == "no_changes"
    same = await change(client, o, slot_id=slots[0])
    assert same.status_code == 422 and same.json()["error"]["code"] == "no_changes"
    bad_zone = await change(client, o, zone_id=99999)
    assert bad_zone.status_code == 422 and "zone" in bad_zone.json()["error"]["fields"]
    on_pickup = await change(client, pickup, address={"street": "x", "building": "1"})
    assert on_pickup.status_code == 422 and on_pickup.json()["error"]["code"] == "pickup_order"
    past = await change(client, o, date="2026-11-01", slot_id=slots[0])
    assert past.status_code == 409
    closed = await change(client, o, hour=11, customer_notes="too late")
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "window_closed"


async def cash_order_pickup(client, p, slots):
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[2], fulfilment="pickup"),
        )
    assert r.status_code == 201, r.text
    return r.json(), None


async def test_only_the_customer_can_change_their_order(client, owner, make_headers):
    mine = await make_headers("customer")
    other = await make_headers("customer")
    o, *_ = await cash_order(client, owner, headers=mine)
    with at(MON):
        stranger = await client.patch(
            f"{API}/orders/{o['code']}", json={"customer_notes": "x"}, headers=other
        )
        own = await client.patch(
            f"{API}/orders/{o['code']}", json={"customer_notes": "x"}, headers=mine
        )
    assert stranger.status_code == 404 and own.status_code == 200


async def test_a_change_and_a_staff_action_at_the_same_time_stay_consistent(
    client, owner, make_headers
):
    staff = await make_headers("staff")
    o, p, slots, _ = await cash_order(client, owner)
    with at(MON):
        results = await asyncio.gather(
            client.patch(f"{API}/orders/{o['code']}", params=track(o), json={"slot_id": slots[1]}),
            staff_act(client, staff, o["code"], "reject", reason="Closed that day"),
        )
    # whichever got the lock first wins; the capacity ends up released exactly once either way
    final = await row(o["code"])
    assert final.status.value in ("received", "rejected")
    if final.status.value == "rejected":
        assert await usage(p["id"]) == (0, 0)
    else:
        assert await usage(p["id"]) == (1, 1)
    assert results[1].status_code in (200, 409)
