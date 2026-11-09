import asyncio
import re
import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models.order import Order
from app.models.schedule import ProductDailyUsage, SlotDailyUsage
from tests.test_admin_catalog import A, make_category, make_product
from tests.test_schedule import FRI, MON, TUE, WED, at, standard_week

API = "/api/v1"
CONTACT = {"name": "Sara Ali", "email": "Sara@Example.com", "phone": "+20 100 123 4567"}
ADDRESS = {
    "street": "12 Road 9",
    "building": "5",
    "floor": "3",
    "apartment": "7",
    "landmark": "Next to the mosque",
}


def key() -> str:
    return uuid.uuid4().hex


async def zone(client, owner, name="Maadi", fee=4000, minimum=0, **extra):
    r = await client.post(
        f"{A}/delivery-zones",
        json={"name": name, "fee": fee, "min_order_amount": minimum, **extra},
        headers=owner,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def slot_ids(client, owner, weekday=1):
    return [
        s["id"]
        for s in (
            await client.get(f"{A}/time-slots", params={"weekday": weekday}, headers=owner)
        ).json()
    ]


async def shop(client, owner, **product_extra):
    """Open week with three slots a day, one zone (Maadi, 40 EGP, no minimum) and one cake (650 / 950 EGP)."""
    await standard_week(client, owner)
    z = await zone(client, owner)
    cat = await make_category(client, owner)
    p = await make_product(
        client,
        owner,
        cat["id"],
        "Chocolate Cake",
        lead_time_hours=0,
        variants=[{"name": "6-inch", "price": 65000}, {"name": "8-inch", "price": 95000}],
        **product_extra,
    )
    return z, p, await slot_ids(client, owner, 1)


def order_body(
    variant_id, slot_id, *, qty=1, day=TUE, zone_id=None, fulfilment="delivery", **extra
):
    body = {
        "items": [{"variant_id": variant_id, "quantity": qty}],
        "fulfilment_type": fulfilment,
        "date": str(day),
        "slot_id": slot_id,
        "contact": dict(CONTACT),  # a copy: tests change the body
        "payment_method": "cod",
    }
    if fulfilment == "delivery":
        body.update(zone_id=zone_id, address=ADDRESS)
    body.update(extra)
    return body


async def place(client, body, headers=None, idem=None):
    return await client.post(
        f"{API}/orders", json=body, headers={"Idempotency-Key": idem or key(), **(headers or {})}
    )


async def usage(product_id, day=TUE):
    async with SessionLocal() as db:
        p = (
            await db.execute(
                select(ProductDailyUsage.reserved_qty).where(
                    ProductDailyUsage.product_id == product_id, ProductDailyUsage.date == day
                )
            )
        ).scalar_one_or_none()
        s = (
            await db.execute(
                select(func.coalesce(func.sum(SlotDailyUsage.reserved_orders), 0)).where(
                    SlotDailyUsage.date == day
                )
            )
        ).scalar_one()
    return p or 0, s


async def order_count():
    async with SessionLocal() as db:
        return (await db.execute(select(func.count()).select_from(Order))).scalar_one()


async def quote(client, **body):
    r = await client.post(f"{API}/checkout/quote", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ======================================================================= quote
async def test_quote_prices_lines_and_delivery(client, owner):
    z, p, slots = await shop(client, owner)
    small, big = p["variants"][0]["id"], p["variants"][1]["id"]
    with at(MON):
        q = await quote(
            client,
            items=[{"variant_id": small, "quantity": 2}, {"variant_id": big, "quantity": 1}],
            fulfilment_type="delivery",
            zone_id=z["id"],
            date=str(TUE),
            slot_id=slots[0],
        )
    assert q["subtotal"] == 2 * 65000 + 95000 and q["delivery_fee"] == 4000
    assert (
        q["total"] == q["subtotal"] + 4000
        and q["currency"] == "EGP"
        and q["currency_exponent"] == 2
    )
    assert [line["line_total"] for line in q["lines"]] == [130000, 95000]
    assert q["problems"] == [] and q["ready"] is True
    assert (
        q["lines"][0]["product_name"] == "Chocolate Cake"
        and q["lines"][0]["variant_name"] == "6-inch"
    )


async def test_quote_pickup_has_no_fee_and_ignores_zone(client, owner):
    z, p, slots = await shop(client, owner)
    with at(MON):
        q = await quote(
            client,
            items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}],
            fulfilment_type="pickup",
            zone_id=z["id"],
            date=str(TUE),
            slot_id=slots[0],
        )
    assert q["delivery_fee"] == 0 and q["total"] == 65000 and q["ready"] is True


async def test_quote_ignores_prices_sent_by_the_client(client, owner):
    _, p, _ = await shop(client, owner)
    q = await quote(
        client,
        items=[
            {"variant_id": p["variants"][0]["id"], "quantity": 1, "unit_price": 1, "line_total": 1}
        ],
    )
    assert q["subtotal"] == 65000


async def test_quote_without_choices_is_not_ready_but_has_no_problems(client, owner):
    _, p, _ = await shop(client, owner)
    empty = await quote(client, items=[])
    cart_only = await quote(client, items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}])
    assert empty["ready"] is False and empty["problems"] == [] and empty["total"] == 0
    assert (
        cart_only["ready"] is False
        and cart_only["problems"] == []
        and cart_only["subtotal"] == 65000
    )
    partial = await quote(
        client,
        items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}],
        fulfilment_type="delivery",
    )
    assert partial["ready"] is False and partial["delivery_fee"] == 0


async def test_quote_same_variant_on_two_lines_with_different_messages(client, owner):
    _, p, _ = await shop(client, owner)
    v = p["variants"][0]["id"]
    q = await quote(
        client,
        items=[
            {"variant_id": v, "quantity": 1, "inscription": " Happy Birthday Sara "},
            {"variant_id": v, "quantity": 1},
        ],
    )
    assert (
        q["subtotal"] == 130000
        and q["lines"][0]["inscription"] == "Happy Birthday Sara"
        and q["lines"][1]["inscription"] is None
    )


async def test_quote_below_delivery_minimum_explains_how_much_more(client, owner):
    await standard_week(client, owner)
    z = await zone(client, owner, "New Cairo", fee=8000, minimum=100000)
    cat = await make_category(client, owner)
    p = await make_product(
        client,
        owner,
        cat["id"],
        "Cookies",
        lead_time_hours=0,
        variants=[{"name": "Box", "price": 28000}],
    )
    slots = await slot_ids(client, owner)
    body = dict(
        items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}],
        date=str(TUE),
        slot_id=slots[0],
    )
    with at(MON):
        delivery = await quote(client, fulfilment_type="delivery", zone_id=z["id"], **body)
        pickup = await quote(client, fulfilment_type="pickup", **body)
    problem = delivery["problems"][0]
    assert problem["field"] == "zone" and problem["code"] == "below_minimum"
    assert (
        "New Cairo" in problem["message"]
        and "720.00 EGP" in problem["message"]
        and "pickup" in problem["message"]
    )
    assert delivery["zone_minimum"] == 100000 and delivery["ready"] is False
    assert pickup["problems"] == [] and pickup["ready"] is True


async def test_quote_unknown_or_inactive_zone(client, owner):
    z, p, slots = await shop(client, owner)
    await client.patch(f"{A}/delivery-zones/{z['id']}", json={"is_active": False}, headers=owner)
    items = [{"variant_id": p["variants"][0]["id"], "quantity": 1}]
    for zid in (z["id"], 9999):
        q = await quote(client, items=items, fulfilment_type="delivery", zone_id=zid)
        assert (
            q["problems"][0]["field"] == "zone" and q["problems"][0]["code"] == "zone_unavailable"
        )


async def test_quote_flags_unavailable_lines_and_excludes_them_from_totals(client, owner):
    _, p, _ = await shop(client, owner)
    cat = await make_category(client, owner, "Breads")
    gone = await make_product(
        client, owner, cat["id"], "Old Loaf", variants=[{"name": "Loaf", "price": 9000}]
    )
    await client.post(f"{A}/products/{gone['id']}/archive", headers=owner)
    q = await quote(
        client,
        items=[
            {"variant_id": p["variants"][0]["id"], "quantity": 1},
            {"variant_id": gone["variants"][0]["id"], "quantity": 1},
            {"variant_id": 99999, "quantity": 1},
        ],
    )
    assert [line["available"] for line in q["lines"]] == [True, False, False]
    assert q["subtotal"] == 65000 and q["ready"] is False
    assert [p_["field"] for p_ in q["problems"]] == ["items", "items"]
    assert q["lines"][1]["message"] == "Old Loaf is no longer available."


async def test_quote_schedule_problems_are_tagged_with_their_step(client, owner):
    z, p, slots = await shop(client, owner)
    items = [{"variant_id": p["variants"][0]["id"], "quantity": 1}]
    base = dict(items=items, fulfilment_type="delivery", zone_id=z["id"])
    await client.put(
        f"{A}/opening-hours",
        json={
            "days": [
                {"weekday": d, "opens_at": "09:00", "closes_at": "21:00", "is_closed": d == 4}
                for d in range(7)
            ]
        },
        headers=owner,
    )
    fri_slot = {
        "id": (await slot_ids(client, owner, 4))[0]
    }  # standard_week already has Friday slots
    with at(MON, 8):
        closed = await quote(client, date=str(FRI), slot_id=fri_slot["id"], **base)
        past = await quote(client, date="2026-11-01", slot_id=slots[0], **base)
        far = await quote(client, date="2027-06-01", slot_id=slots[0], **base)
        wrong_day = await quote(
            client, date=str(TUE), slot_id=(await slot_ids(client, owner, 2))[0], **base
        )  # a Wednesday slot on a Tuesday
        missing = await quote(client, date=str(TUE), slot_id=99999, **base)
    assert closed["problems"][0]["field"] == "date" and closed["problems"][0]["code"] == "closed"
    assert (
        past["problems"][0]["code"] == "past_date" and far["problems"][0]["code"] == "too_far_ahead"
    )
    assert (
        wrong_day["problems"][0]["field"] == "slot"
        and wrong_day["problems"][0]["code"] == "slot_invalid"
    )
    assert missing["problems"][0]["code"] == "slot_invalid"


async def test_quote_slot_that_already_started_or_is_full(client, owner):
    z, p, slots = await shop(client, owner)
    base = dict(
        items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}],
        fulfilment_type="pickup",
        date=str(TUE),
    )
    async with SessionLocal() as db:
        db.add(SlotDailyUsage(time_slot_id=slots[1], date=TUE, reserved_orders=2))
        await db.commit()
    with at(TUE, 10, 30):
        started = await quote(client, slot_id=slots[0], **base)
        full = await quote(client, slot_id=slots[1], **base)
        fine = await quote(client, slot_id=slots[2], **base)
    assert started["problems"][0]["code"] == "lead_time"
    assert full["problems"][0]["code"] == "slot_full" and full["problems"][0]["field"] == "slot"
    assert fine["ready"] is True


async def test_quote_respects_product_lead_time(client, owner):
    await standard_week(client, owner)
    cat = await make_category(client, owner)
    p = await make_product(
        client,
        owner,
        cat["id"],
        "Wedding Cake",
        lead_time_hours=72,
        variants=[{"name": "Tall", "price": 300000}],
    )
    slots = await slot_ids(client, owner)
    with at(MON, 8):
        q = await quote(
            client,
            items=[{"variant_id": p["variants"][0]["id"], "quantity": 1}],
            fulfilment_type="pickup",
            date=str(TUE),
            slot_id=slots[0],
        )
    assert (
        q["problems"][0]["field"] == "date"
        and q["problems"][0]["code"] == "lead_time"
        and "3 days" in q["problems"][0]["message"]
    )


async def test_quote_input_limits(client):
    r = await client.post(
        f"{API}/checkout/quote", json={"items": [{"variant_id": 1, "quantity": 0}]}
    )
    assert r.status_code == 422
    r = await client.post(
        f"{API}/checkout/quote", json={"items": [{"variant_id": 1, "quantity": 101}]}
    )
    assert r.status_code == 422
    r = await client.post(
        f"{API}/checkout/quote", json={"items": [{"variant_id": 1, "quantity": 1}] * 31}
    )
    assert r.status_code == 422
    r = await client.post(
        f"{API}/checkout/quote",
        json={"items": [{"variant_id": 1, "quantity": 1, "inscription": "x" * 81}]},
    )
    assert r.status_code == 422


# ================================================================ placing orders
async def test_place_cod_delivery_order(client, owner):
    z, p, slots = await shop(client, owner)
    v = p["variants"][0]["id"]
    with at(MON, 9):
        r = await place(
            client,
            order_body(
                v,
                slots[0],
                qty=2,
                zone_id=z["id"],
                customer_notes="Ring twice",
                items=[{"variant_id": v, "quantity": 2, "inscription": "Happy Birthday"}],
            ),
        )
    assert r.status_code == 201, r.text
    o = r.json()
    assert re.fullmatch(r"BK-[A-HJKMNP-Z2-9]{6}", o["code"])
    assert (
        o["status"] == "received"
        and o["payment_method"] == "cod"
        and o["payment_status"] == "unpaid"
    )
    assert (o["subtotal"], o["delivery_fee"], o["total"], o["currency"]) == (
        130000,
        4000,
        134000,
        "EGP",
    )
    assert (
        o["fulfilment_type"] == "delivery"
        and o["fulfilment_date"] == "2026-11-10"
        and o["zone_name"] == "Maadi"
    )
    assert o["delivery_address"] == ADDRESS and o["contact_email"] == "sara@example.com"
    assert o["slot_starts_at"].startswith("2026-11-10T08:00:00")  # 10:00 in Cairo (UTC+2)
    assert o["slot_ends_at"].startswith("2026-11-10T10:00:00")
    assert o["items"] == [
        {
            "product_name": "Chocolate Cake",
            "variant_name": "6-inch",
            "unit_price": 65000,
            "quantity": 2,
            "line_total": 130000,
            "inscription": "Happy Birthday",
        }
    ]
    assert [(e["from_status"], e["to_status"]) for e in o["events"]] == [(None, "received")]
    assert o["customer_notes"] == "Ring twice" and o["tracking_token"] and o["is_delayed"] is False
    assert await usage(p["id"]) == (2, 1)  # two cakes and one slot reserved


async def test_place_pickup_order_needs_no_address_or_zone(client, owner):
    _, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(client, order_body(p["variants"][0]["id"], slots[1], fulfilment="pickup"))
    o = r.json()
    assert r.status_code == 201 and o["delivery_fee"] == 0 and o["total"] == 65000
    assert (
        o["zone_name"] is None
        and o["delivery_address"] is None
        and o["fulfilment_type"] == "pickup"
    )


async def test_order_keeps_a_snapshot_of_names_and_prices(client, owner):
    z, p, slots = await shop(client, owner)
    v = p["variants"][0]["id"]
    with at(MON):
        created = (await place(client, order_body(v, slots[0], zone_id=z["id"]))).json()
    await client.patch(
        f"{A}/products/{p['id']}/variants/{v}",
        json={"price": 99900, "name": "Renamed"},
        headers=owner,
    )
    await client.patch(f"{A}/products/{p['id']}", json={"name": "Different Cake"}, headers=owner)
    await client.patch(
        f"{A}/delivery-zones/{z['id']}", json={"fee": 9900, "name": "Elsewhere"}, headers=owner
    )
    again = (
        await client.get(f"{API}/orders/{created['code']}", params={"t": created["tracking_token"]})
    ).json()
    assert (
        again["items"][0]["unit_price"] == 65000
        and again["items"][0]["product_name"] == "Chocolate Cake"
    )
    assert (
        again["items"][0]["variant_name"] == "6-inch"
        and again["delivery_fee"] == 4000
        and again["zone_name"] == "Maadi"
    )
    assert again["total"] == created["total"]


async def test_order_is_validated(client, owner):
    z, p, slots = await shop(client, owner)
    v = p["variants"][0]["id"]
    good = order_body(v, slots[0], zone_id=z["id"])
    with at(MON):
        no_key = await client.post(f"{API}/orders", json=good)
        assert no_key.status_code == 422
        short_key = await place(client, good, idem="short")
        assert short_key.status_code == 422
        for name, change in {
            "no address": {"address": None},
            "no zone": {"zone_id": None},
            "empty cart": {"items": []},
            "bad qty": {"items": [{"variant_id": v, "quantity": 0}]},
            "bad email": {"contact": {**CONTACT, "email": "nope"}},
            "bad phone": {"contact": {**CONTACT, "phone": "call me"}},
            "blank name": {"contact": {**CONTACT, "name": "  "}},
            "blank street": {"address": {**ADDRESS, "street": " "}},
            "no building": {"address": {"street": "x"}},
            "long notes": {"customer_notes": "x" * 501},
            "bad type": {"fulfilment_type": "teleport"},
            "no slot": {"slot_id": None},
        }.items():
            r = await place(client, {**good, **change})
            assert r.status_code == 422, name
    assert await order_count() == 0


async def test_card_is_refused_when_no_provider_is_set_up(client, owner):
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], payment_method="card"),
        )
    assert r.status_code == 422 and r.json()["error"]["code"] == "card_unavailable"
    assert await order_count() == 0


async def test_order_below_delivery_minimum_is_rejected_with_the_step(client, owner):
    await standard_week(client, owner)
    z = await zone(client, owner, "Far", fee=9000, minimum=200000)
    cat = await make_category(client, owner)
    p = await make_product(
        client,
        owner,
        cat["id"],
        "Cookies",
        lead_time_hours=0,
        variants=[{"name": "Box", "price": 28000}],
    )
    slots = await slot_ids(client, owner)
    with at(MON):
        r = await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "checkout_invalid" and "zone" in err["fields"]
    assert await order_count() == 0 and await usage(p["id"]) == (0, 0)


@pytest.mark.parametrize(
    "change,field",
    [
        ({"day": date(2026, 11, 1)}, "date"),
        ({"day": FRI}, "date"),
        ({"slot_id": 99999}, "slot"),
    ],
)
async def test_order_with_unbookable_date_or_slot_is_rejected(client, owner, change, field):
    z, p, slots = await shop(client, owner)
    await client.put(
        f"{A}/opening-hours",
        json={
            "days": [
                {"weekday": d, "opens_at": "09:00", "closes_at": "21:00", "is_closed": d == 4}
                for d in range(7)
            ]
        },
        headers=owner,
    )
    kwargs = {"zone_id": z["id"], **change}
    slot_id = kwargs.pop("slot_id", slots[0])
    with at(MON):
        r = await place(client, order_body(p["variants"][0]["id"], slot_id, **kwargs))
    assert r.status_code == 422 and field in r.json()["error"]["fields"]
    assert await order_count() == 0


async def test_order_for_an_archived_product_is_rejected(client, owner):
    z, p, slots = await shop(client, owner)
    await client.post(f"{A}/products/{p['id']}/archive", headers=owner)
    with at(MON):
        r = await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
    assert (
        r.status_code == 422 and "items" in r.json()["error"]["fields"] and await order_count() == 0
    )


# ================================================================== idempotency
async def test_same_idempotency_key_returns_the_same_order_once(client, owner):
    z, p, slots = await shop(client, owner)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"])
    with at(MON):
        first = await place(client, body, idem="retry-key-12345")
        second = await place(client, body, idem="retry-key-12345")
        other = await place(client, body, idem="a-different-key-1")
    assert first.status_code == 201 and second.status_code == 200 and other.status_code == 201
    assert (
        second.json()["code"] == first.json()["code"]
        and second.json()["tracking_token"] == first.json()["tracking_token"]
    )
    assert other.json()["code"] != first.json()["code"]
    assert await order_count() == 2 and await usage(p["id"]) == (
        2,
        2,
    )  # the retry reserved nothing extra


async def test_concurrent_duplicate_submissions_create_one_order(client, owner):
    z, p, slots = await shop(client, owner)
    body = order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"])
    with at(MON):
        results = await asyncio.gather(
            *[place(client, body, idem="double-click-123") for _ in range(6)]
        )
    assert {r.status_code for r in results} <= {200, 201} and sum(
        r.status_code == 201 for r in results
    ) == 1
    assert len({r.json()["code"] for r in results}) == 1
    assert await order_count() == 1 and await usage(p["id"]) == (1, 1)


# ============================================================ no overselling
async def test_last_unit_goes_to_exactly_one_of_many_simultaneous_orders(client, owner):
    z, p, slots = await shop(client, owner, daily_capacity=1)
    v = p["variants"][0]["id"]
    with at(MON):
        results = await asyncio.gather(
            *[
                place(
                    client,
                    order_body(v, slots[i % 3], zone_id=z["id"]),
                    idem=f"race-product-{i:04d}",
                )
                for i in range(8)
            ]
        )
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1, codes
    assert all(c in (409, 422) for c in codes if c != 201), codes
    assert await order_count() == 1 and (await usage(p["id"]))[0] == 1


async def test_a_slot_never_takes_more_orders_than_its_limit(client, owner):
    z, p, slots = await shop(client, owner)  # every slot allows 2 orders
    v = p["variants"][0]["id"]
    with at(MON):
        results = await asyncio.gather(
            *[
                place(client, order_body(v, slots[0], zone_id=z["id"]), idem=f"race-slot-{i:04d}")
                for i in range(7)
            ]
        )
    codes = [r.status_code for r in results]
    assert codes.count(201) == 2, codes
    assert await order_count() == 2 and (await usage(p["id"]))[1] == 2
    full = await client.get(
        f"{API}/availability/slots", params={"date": str(TUE), "fulfilment": "delivery"}
    )
    assert next(s for s in full.json()["slots"] if s["slot_id"] == slots[0])["available"] is False


async def test_capacity_is_shared_across_sizes_and_checked_in_units(client, owner):
    z, p, slots = await shop(client, owner, daily_capacity=3)
    small, big = p["variants"][0]["id"], p["variants"][1]["id"]
    with at(MON):
        two = await place(client, order_body(small, slots[0], qty=2, zone_id=z["id"]))
        two_more = await place(
            client, order_body(big, slots[1], qty=2, zone_id=z["id"])
        )  # only 1 left
        last = await place(client, order_body(big, slots[1], qty=1, zone_id=z["id"]))
    assert two.status_code == 201 and two_more.status_code in (409, 422) and last.status_code == 201
    assert "only make 1 more" in two_more.json()["error"]["message"]
    assert (await usage(p["id"]))[0] == 3


async def test_capacity_is_per_day(client, owner):
    z, p, slots = await shop(client, owner, daily_capacity=1)
    v = p["variants"][0]["id"]
    wed_slots = await slot_ids(client, owner, 2)
    with at(MON):
        tue = await place(client, order_body(v, slots[0], zone_id=z["id"]))
        tue_again = await place(client, order_body(v, slots[1], zone_id=z["id"]))
        wed = await place(client, order_body(v, wed_slots[0], zone_id=z["id"], day=WED))
    assert (tue.status_code, wed.status_code) == (201, 201) and tue_again.status_code in (409, 422)


async def test_releasing_an_order_gives_the_capacity_back(client, owner):
    from app.crud.order import order_crud
    from app.services.orders import release_order_capacity

    z, p, slots = await shop(client, owner, daily_capacity=1)
    v = p["variants"][0]["id"]
    with at(MON):
        first = (await place(client, order_body(v, slots[0], zone_id=z["id"]))).json()
        blocked = await place(client, order_body(v, slots[0], zone_id=z["id"]))
        assert blocked.status_code in (409, 422)
        async with SessionLocal() as db:
            order = await order_crud.get_by_code(db, first["code"])
            await release_order_capacity(db, order)
            await db.commit()
        assert await usage(p["id"]) == (0, 0)
        again = await place(client, order_body(v, slots[0], zone_id=z["id"]))
    assert again.status_code == 201


# ====================================================================== reading
async def test_guest_reads_an_order_only_with_the_right_token(client, owner):
    z, p, slots = await shop(client, owner)
    with at(MON):
        o = (
            await place(client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]))
        ).json()
    code, token = o["code"], o["tracking_token"]
    ok = await client.get(f"{API}/orders/{code}", params={"t": token})
    assert ok.status_code == 200 and ok.json()["code"] == code
    assert (
        await client.get(f"{API}/orders/{code.lower()}", params={"t": token})
    ).status_code == 200
    for params in ({}, {"t": "x" * 40}, {"t": token[:-1] + ("0" if token[-1] != "0" else "1")}):
        r = await client.get(f"{API}/orders/{code}", params=params)
        assert r.status_code == 404 and r.json()["error"]["code"] == "order_not_found"
    assert (
        await client.get(f"{API}/orders/BK-ZZZZZZ", params={"t": token})
    ).status_code == 404  # same error as "not yours"


async def test_signed_in_customer_owns_their_orders_and_nobody_else_sees_them(
    client, owner, make_headers
):
    z, p, slots = await shop(client, owner)
    sara, other, staff = (
        await make_headers("customer"),
        await make_headers("customer"),
        await make_headers("staff"),
    )
    with at(MON):
        o = (
            await place(
                client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]), headers=sara
            )
        ).json()
    code = o["code"]
    assert (await client.get(f"{API}/orders/{code}", headers=sara)).status_code == 200
    assert (await client.get(f"{API}/orders/{code}", headers=other)).status_code == 404
    assert (await client.get(f"{API}/orders/{code}")).status_code == 404
    assert (await client.get(f"{API}/orders/{code}", headers=staff)).status_code == 200
    assert (await client.get(f"{API}/orders/{code}", headers=owner)).status_code == 200
    async with SessionLocal() as db:
        assert (
            await db.execute(select(Order.user_id).where(Order.code == code))
        ).scalar_one() is not None


async def test_an_expired_or_invalid_login_just_means_guest(client, owner):
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(
            client,
            order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"]),
            headers={"Authorization": "Bearer garbage"},
        )
    assert r.status_code == 201
    async with SessionLocal() as db:
        assert (await db.execute(select(Order.user_id))).scalar_one() is None


async def test_tracking_tokens_are_stable_per_order_and_different_between_orders():
    from app.core.security import tracking_token, verify_tracking_token

    assert tracking_token("BK-AAAAAA") == tracking_token("BK-AAAAAA") != tracking_token("BK-AAAAAB")
    assert verify_tracking_token("BK-AAAAAA", tracking_token("BK-AAAAAA"))
    assert not verify_tracking_token("BK-AAAAAB", tracking_token("BK-AAAAAA"))
    assert not verify_tracking_token("BK-AAAAAA", None) and not verify_tracking_token(
        "BK-AAAAAA", ""
    )
