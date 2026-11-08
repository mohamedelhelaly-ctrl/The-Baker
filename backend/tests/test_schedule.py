from datetime import date, datetime

import pytest
import time_machine

from app.core.clock import STORE_TZ
from tests.test_admin_catalog import A, make_category, make_product

API = "/api/v1"
MON, TUE, WED, FRI = date(2026, 11, 9), date(2026, 11, 10), date(2026, 11, 11), date(2026, 11, 13)


def at(day: date, hh: int = 8, mm: int = 0, ss: int = 0):
    """Freeze the clock at a store-local time."""
    return time_machine.travel(
        datetime(day.year, day.month, day.day, hh, mm, ss, tzinfo=STORE_TZ), tick=False
    )


async def open_week(client, owner, opens="09:00", closes="21:00", closed=()):
    days = [
        {"weekday": d, "opens_at": opens, "closes_at": closes, "is_closed": d in closed}
        for d in range(7)
    ]
    r = await client.put(f"{A}/opening-hours", json={"days": days}, headers=owner)
    assert r.status_code == 200, r.text


async def add_slot(client, owner, weekday, start, end, type_="both", max_orders=2):
    r = await client.post(
        f"{A}/time-slots",
        json={
            "weekday": weekday,
            "starts_at": start,
            "ends_at": end,
            "fulfilment_type": type_,
            "max_orders": max_orders,
        },
        headers=owner,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def standard_week(client, owner):
    """Open 09:00-21:00 every day; slots 10-12, 12-14, 14-16 (2 orders each) every day."""
    await open_week(client, owner)
    for d in range(7):
        for s, e in [("10:00", "12:00"), ("12:00", "14:00"), ("14:00", "16:00")]:
            await add_slot(client, owner, d, s, e)


async def slots(client, day, fulfilment="delivery", items=""):
    r = await client.get(
        f"{API}/availability/slots",
        params={"date": str(day), "fulfilment": fulfilment, "items": items},
    )
    assert r.status_code == 200, r.text
    return r.json()


def by_start(body):
    return {s["starts_at"][:5]: s for s in body["slots"]}


async def cake(client, owner, **extra):
    cat = await make_category(client, owner)
    return await make_product(client, owner, cat["id"], **extra)


# ---------- permissions ----------
async def test_schedule_is_readable_by_staff_but_only_owner_can_change_it(client, make_headers):
    staff, customer = await make_headers("staff"), await make_headers("customer")
    assert (await client.get(f"{A}/opening-hours", headers=staff)).status_code == 200
    assert (await client.get(f"{A}/time-slots", headers=staff)).status_code == 200
    assert (await client.get(f"{A}/delivery-zones", headers=staff)).status_code == 200
    body = {"weekday": 1, "starts_at": "10:00", "ends_at": "12:00"}
    assert (await client.post(f"{A}/time-slots", json=body, headers=staff)).status_code == 403
    assert (
        await client.post(f"{A}/delivery-zones", json={"name": "X", "fee": 1}, headers=staff)
    ).status_code == 403
    assert (
        await client.post(f"{A}/closures", json={"date": "2030-01-01"}, headers=staff)
    ).status_code == 403
    for path in ("opening-hours", "time-slots", "closures", "delivery-zones"):
        assert (await client.get(f"{A}/{path}", headers=customer)).status_code == 403
        assert (await client.get(f"{A}/{path}")).status_code == 401


# ---------- opening hours ----------
async def test_opening_hours_validation_and_idempotent_replace(client, owner):
    good = [{"weekday": d, "opens_at": "09:00", "closes_at": "21:00"} for d in range(7)]
    assert (
        await client.put(f"{A}/opening-hours", json={"days": good[:6]}, headers=owner)
    ).status_code == 422
    dup = good[:6] + [good[0]]
    assert (
        await client.put(f"{A}/opening-hours", json={"days": dup}, headers=owner)
    ).status_code == 422
    backwards = [dict(d) for d in good]
    backwards[2].update(opens_at="22:00", closes_at="09:00")
    assert (
        await client.put(f"{A}/opening-hours", json={"days": backwards}, headers=owner)
    ).status_code == 422
    closed_ok = [dict(d) for d in good]
    closed_ok[4].update(
        opens_at="00:00", closes_at="00:00", is_closed=True
    )  # times ignored when closed
    assert (
        await client.put(f"{A}/opening-hours", json={"days": closed_ok}, headers=owner)
    ).status_code == 200
    again = await client.put(f"{A}/opening-hours", json={"days": good}, headers=owner)
    assert len(again.json()) == 7 and again.json()[4]["is_closed"] is False
    assert [
        h["weekday"] for h in (await client.get(f"{A}/opening-hours", headers=owner)).json()
    ] == list(range(7))


async def test_store_info_includes_opening_hours(client, owner):
    await open_week(client, owner, closed=(4,))
    hours = (await client.get(f"{API}/store")).json()["opening_hours"]
    assert (
        len(hours) == 7
        and hours[4]["is_closed"] is True
        and hours[0]["opens_at"].startswith("09:00")
    )


# ---------- time slots ----------
async def test_slot_overlap_rules(client, owner):
    first = await add_slot(client, owner, 1, "10:00", "12:00", "both")
    adjacent = await add_slot(client, owner, 1, "12:00", "14:00", "both")  # touching is fine
    clash = await client.post(
        f"{A}/time-slots",
        json={"weekday": 1, "starts_at": "11:00", "ends_at": "13:00"},
        headers=owner,
    )
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "slot_overlap"
    assert "10:00" in clash.json()["error"]["message"]
    other_day = await client.post(
        f"{A}/time-slots",
        json={"weekday": 2, "starts_at": "11:00", "ends_at": "13:00"},
        headers=owner,
    )
    assert other_day.status_code == 201
    # delivery-only and pickup-only slots may share a time, but "both" clashes with either
    await add_slot(client, owner, 3, "10:00", "12:00", "delivery")
    await add_slot(client, owner, 3, "10:00", "12:00", "pickup")
    both = await client.post(
        f"{A}/time-slots",
        json={"weekday": 3, "starts_at": "10:00", "ends_at": "12:00", "fulfilment_type": "both"},
        headers=owner,
    )
    assert both.status_code == 409
    moved = await client.patch(
        f"{A}/time-slots/{adjacent['id']}", json={"starts_at": "11:00"}, headers=owner
    )
    assert moved.status_code == 409
    fine = await client.patch(
        f"{A}/time-slots/{first['id']}", json={"max_orders": 9, "is_active": False}, headers=owner
    )
    assert fine.json()["max_orders"] == 9 and fine.json()["is_active"] is False


async def test_slot_validation_and_delete(client, owner):
    bad = await client.post(
        f"{A}/time-slots",
        json={"weekday": 1, "starts_at": "12:00", "ends_at": "10:00"},
        headers=owner,
    )
    assert bad.status_code == 422
    assert (
        await client.post(
            f"{A}/time-slots",
            json={"weekday": 7, "starts_at": "10:00", "ends_at": "12:00"},
            headers=owner,
        )
    ).status_code == 422
    assert (
        await client.post(
            f"{A}/time-slots",
            json={"weekday": 1, "starts_at": "10:00", "ends_at": "12:00", "max_orders": 0},
            headers=owner,
        )
    ).status_code == 422
    slot = await add_slot(client, owner, 1, "10:00", "12:00")
    inverted = await client.patch(
        f"{A}/time-slots/{slot['id']}", json={"ends_at": "09:00"}, headers=owner
    )
    assert inverted.status_code == 422
    assert (await client.delete(f"{A}/time-slots/{slot['id']}", headers=owner)).status_code == 204
    assert (await client.delete(f"{A}/time-slots/{slot['id']}", headers=owner)).status_code == 404
    assert (
        await client.patch(f"{A}/time-slots/999", json={"max_orders": 3}, headers=owner)
    ).status_code == 404


# ---------- closures ----------
async def test_closures(client, owner):
    with at(MON):
        ok = await client.post(
            f"{A}/closures", json={"date": "2026-12-25", "reason": "Holiday"}, headers=owner
        )
        assert ok.status_code == 201
        dup = await client.post(f"{A}/closures", json={"date": "2026-12-25"}, headers=owner)
        assert dup.status_code == 409 and dup.json()["error"]["code"] == "closure_exists"
        past = await client.post(f"{A}/closures", json={"date": "2026-11-01"}, headers=owner)
        assert past.status_code == 422 and past.json()["error"]["code"] == "past_date"
        assert (
            await client.post(f"{A}/closures", json={"date": "2026-11-09"}, headers=owner)
        ).status_code == 201  # today is allowed
        assert [c["date"] for c in (await client.get(f"{A}/closures", headers=owner)).json()] == [
            "2026-11-09",
            "2026-12-25",
        ]
        assert (
            await client.delete(f"{A}/closures/{ok.json()['id']}", headers=owner)
        ).status_code == 204
        assert (
            await client.delete(f"{A}/closures/{ok.json()['id']}", headers=owner)
        ).status_code == 404


# ---------- delivery zones ----------
async def test_delivery_zones(client, owner):
    a = await client.post(
        f"{A}/delivery-zones",
        json={"name": "Maadi", "fee": 4000, "min_order_amount": 30000},
        headers=owner,
    )
    assert a.status_code == 201
    dup = await client.post(
        f"{A}/delivery-zones", json={"name": " maadi ", "fee": 1}, headers=owner
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "zone_exists"
    assert (
        await client.post(f"{A}/delivery-zones", json={"name": "Free", "fee": -1}, headers=owner)
    ).status_code == 422
    assert (
        await client.post(f"{A}/delivery-zones", json={"name": "  ", "fee": 1}, headers=owner)
    ).status_code == 422
    b = (
        await client.post(
            f"{A}/delivery-zones",
            json={"name": "Zamalek", "fee": 5500, "sort_order": 1},
            headers=owner,
        )
    ).json()
    clash = await client.patch(
        f"{A}/delivery-zones/{b['id']}", json={"name": "MAADI"}, headers=owner
    )
    assert clash.status_code == 409
    assert (
        await client.patch(
            f"{A}/delivery-zones/{b['id']}", json={"name": "Zamalek Island"}, headers=owner
        )
    ).json()["name"] == "Zamalek Island"
    await client.patch(f"{A}/delivery-zones/{b['id']}", json={"is_active": False}, headers=owner)
    public = (await client.get(f"{API}/delivery-zones")).json()
    assert [z["name"] for z in public] == ["Maadi"]  # inactive zones are hidden
    assert set(public[0]) == {"id", "name", "fee", "min_order_amount"}
    assert len((await client.get(f"{A}/delivery-zones", headers=owner)).json()) == 2
    assert (
        await client.patch(f"{A}/delivery-zones/999", json={"fee": 1}, headers=owner)
    ).status_code == 404


# ---------- availability: slots ----------
async def test_slots_with_no_cart_only_need_the_store_to_be_open(client, owner):
    await standard_week(client, owner)
    with at(MON, 8):
        body = await slots(client, MON)
    assert body["available"] is True
    assert [s["available"] for s in body["slots"]] == [True, True, True]
    assert [s["starts_at"][:5] for s in body["slots"]] == ["10:00", "12:00", "14:00"]
    assert all(s["remaining_orders"] == 2 for s in body["slots"])


async def test_slots_that_already_started_are_unavailable(client, owner):
    await standard_week(client, owner)
    with at(MON, 12, 30):
        got = by_start(await slots(client, MON))
    assert got["10:00"]["available"] is False and got["10:00"]["reason"] == "lead_time"
    assert got["12:00"]["available"] is False  # started 12:00, it is 12:30
    assert got["14:00"]["available"] is True


async def test_lead_time_boundary_is_inclusive(client, owner):
    await standard_week(client, owner)
    p = await cake(client, owner, lead_time_hours=24)
    item = f"{p['variants'][0]['id']}"
    with at(MON, 10, 0, 0):  # exactly 24h before Tuesday 10:00
        assert by_start(await slots(client, TUE, items=item))["10:00"]["available"] is True
    with at(MON, 10, 0, 1):  # one second too late
        got = by_start(await slots(client, TUE, items=item))
        assert got["10:00"]["available"] is False and got["10:00"]["reason"] == "lead_time"
        assert "1 day" in got["10:00"]["message"]
        assert got["12:00"]["available"] is True


async def test_longest_lead_time_in_the_cart_wins(client, owner):
    await standard_week(client, owner)
    cat = await make_category(client, owner)
    quick = await make_product(client, owner, cat["id"], "Cookie", lead_time_hours=2)
    slow = await make_product(client, owner, cat["id"], "Wedding Cake", lead_time_hours=72)
    items = f"{quick['variants'][0]['id']},{slow['variants'][0]['id']}"
    with at(MON, 8):
        tue = await slots(client, TUE, items=items)
        thu = await slots(client, date(2026, 11, 12), items=items)
    assert tue["available"] is False and tue["reason"] == "lead_time" and "3 days" in tue["message"]
    assert thu["available"] is True


async def test_closed_weekday_and_closure_dates(client, owner):
    await open_week(client, owner, closed=(4,))
    await add_slot(client, owner, 4, "10:00", "12:00")
    await add_slot(client, owner, 1, "10:00", "12:00")
    with at(MON):
        fri = await slots(client, FRI)
        assert fri["available"] is False and fri["reason"] == "closed" and fri["slots"] == []
        await client.post(
            f"{A}/closures", json={"date": str(TUE), "reason": "Eid holiday"}, headers=owner
        )
        tue = await slots(client, TUE)
    assert tue["reason"] == "closure" and "Eid holiday" in tue["message"]


async def test_no_opening_hours_configured_means_closed(client, owner):
    with at(MON):
        assert (await slots(client, TUE))["reason"] == "closed"


async def test_slots_outside_opening_hours_are_unavailable(client, owner):
    await open_week(client, owner, opens="11:00", closes="15:00")
    await add_slot(client, owner, 1, "10:00", "12:00")  # starts before opening
    await add_slot(client, owner, 1, "12:00", "14:00")
    await add_slot(client, owner, 1, "14:00", "16:00")  # ends after closing
    with at(MON):
        got = by_start(await slots(client, TUE))
    assert got["10:00"]["reason"] == "outside_hours" and got["14:00"]["reason"] == "outside_hours"
    assert got["12:00"]["available"] is True


async def test_pickup_and_delivery_see_their_own_slots(client, owner):
    await open_week(client, owner)
    await add_slot(client, owner, 1, "10:00", "12:00", "delivery")
    await add_slot(client, owner, 1, "12:00", "14:00", "pickup")
    await add_slot(client, owner, 1, "14:00", "16:00", "both")
    with at(MON):
        delivery = by_start(await slots(client, TUE, "delivery"))
        pickup = by_start(await slots(client, TUE, "pickup"))
    assert set(delivery) == {"10:00", "14:00"} and set(pickup) == {"12:00", "14:00"}


async def test_inactive_slots_are_hidden(client, owner):
    await open_week(client, owner)
    slot = await add_slot(client, owner, 1, "10:00", "12:00")
    await client.patch(f"{A}/time-slots/{slot['id']}", json={"is_active": False}, headers=owner)
    with at(MON):
        body = await slots(client, TUE)
    assert body["available"] is False and body["reason"] == "no_slots"


async def test_full_slot_is_marked_and_others_stay_open(client, owner):
    from app.database import SessionLocal
    from app.models.schedule import SlotDailyUsage

    await open_week(client, owner)
    full = await add_slot(client, owner, 1, "10:00", "12:00", max_orders=2)
    await add_slot(client, owner, 1, "12:00", "14:00", max_orders=2)
    async with SessionLocal() as db:
        db.add(SlotDailyUsage(time_slot_id=full["id"], date=TUE, reserved_orders=2))
        await db.commit()
    with at(MON):
        got = by_start(await slots(client, TUE))
        other_day = by_start(
            await slots(client, date(2026, 11, 17))
        )  # next Tuesday: counters are per date
    assert got["10:00"] == {
        **got["10:00"],
        "available": False,
        "reason": "slot_full",
        "remaining_orders": 0,
    }
    assert got["12:00"]["available"] is True
    assert other_day["10:00"]["available"] is True


async def test_all_slots_full_explains_why(client, owner):
    from app.database import SessionLocal
    from app.models.schedule import SlotDailyUsage

    await open_week(client, owner)
    only = await add_slot(client, owner, 1, "10:00", "12:00", max_orders=1)
    async with SessionLocal() as db:
        db.add(SlotDailyUsage(time_slot_id=only["id"], date=TUE, reserved_orders=1))
        await db.commit()
    with at(MON):
        body = await slots(client, TUE)
    assert (
        body["available"] is False
        and body["reason"] == "slot_full"
        and body["message"] == "Fully booked."
    )


# ---------- availability: products ----------
async def test_product_weekday_rule(client, owner):
    await standard_week(client, owner)
    p = await cake(client, owner, name="Tuesday Special")
    item = str(p["variants"][0]["id"])
    r = await client.put(
        f"{A}/products/{p['id']}/availability",
        json={"available_weekdays": [0, 2, 3, 4, 5, 6]},
        headers=owner,
    )
    assert r.status_code == 200 and r.json()["available_weekdays"] == [0, 2, 3, 4, 5, 6]
    with at(MON):
        tue = await slots(client, TUE, items=item)
        wed = await slots(client, WED, items=item)
        no_cart = await slots(client, TUE)
    assert tue["available"] is False and tue["reason"] == "product_unavailable_day"
    assert "Tuesday Special" in tue["message"]
    assert wed["available"] is True and no_cart["available"] is True
    restored = await client.put(
        f"{A}/products/{p['id']}/availability",
        json={"available_weekdays": list(range(7))},
        headers=owner,
    )
    assert restored.json()["available_weekdays"] == list(range(7))
    with at(MON):
        assert (await slots(client, TUE, items=item))["available"] is True


async def test_product_availability_validation_and_defaults(client, owner):
    p = await cake(client, owner)
    assert p["available_weekdays"] == list(range(7))
    for bad in ([7], [-1], [1, 1], list(range(8))):
        r = await client.put(
            f"{A}/products/{p['id']}/availability", json={"available_weekdays": bad}, headers=owner
        )
        assert r.status_code == 422, bad
    assert (
        await client.put(
            f"{A}/products/999/availability", json={"available_weekdays": [1]}, headers=owner
        )
    ).status_code == 404
    twice = None
    for _ in range(2):  # repeating the same change must not violate the unique constraint
        twice = await client.put(
            f"{A}/products/{p['id']}/availability",
            json={"available_weekdays": [1, 2]},
            headers=owner,
        )
        assert twice.status_code == 200
    assert twice.json()["available_weekdays"] == [1, 2]
    none = await client.put(
        f"{A}/products/{p['id']}/availability", json={"available_weekdays": []}, headers=owner
    )
    assert none.json()["available_weekdays"] == []


async def test_product_daily_capacity(client, owner):
    from app.database import SessionLocal
    from app.models.schedule import ProductDailyUsage

    await standard_week(client, owner)
    p = await cake(client, owner, daily_capacity=5)
    vid = p["variants"][0]["id"]
    async with SessionLocal() as db:
        db.add(ProductDailyUsage(product_id=p["id"], date=TUE, reserved_qty=4))
        await db.commit()
    with at(MON):
        one = await slots(client, TUE, items=f"{vid}:1")
        two = await slots(client, TUE, items=f"{vid}:2")
        split = await slots(
            client, TUE, items=f"{vid}:1,{p['variants'][1]['id']}:1"
        )  # sizes share the product limit
        other_day = await slots(client, WED, items=f"{vid}:5")
    assert one["available"] is True
    assert two["available"] is False and two["reason"] == "product_capacity"
    assert "only make 1 more" in two["message"]
    assert split["available"] is False  # 1 + 1 units of the same product, only 1 left
    assert split["reason"] == "product_capacity"
    assert other_day["available"] is True  # another day has its own counter


async def test_fully_booked_product_message(client, owner):
    from app.database import SessionLocal
    from app.models.schedule import ProductDailyUsage

    await standard_week(client, owner)
    p = await cake(client, owner, daily_capacity=3, name="Eclairs")
    async with SessionLocal() as db:
        db.add(ProductDailyUsage(product_id=p["id"], date=TUE, reserved_qty=3))
        await db.commit()
    with at(MON):
        body = await slots(client, TUE, items=str(p["variants"][0]["id"]))
    assert body["message"] == "Eclairs is fully booked on this day."


# ---------- availability: dates ----------
async def test_dates_overview(client, owner):
    await open_week(client, owner, closed=(4,))  # Friday closed
    for d in range(7):
        await add_slot(client, owner, d, "10:00", "12:00")
        await add_slot(client, owner, d, "14:00", "16:00")
    with at(MON, 13, 0):
        await client.post(
            f"{A}/closures", json={"date": str(WED), "reason": "Holiday"}, headers=owner
        )
        r = await client.get(f"{API}/availability/dates", params={"fulfilment": "delivery"})
    body = r.json()
    days = {d["date"]: d for d in body["days"]}
    assert len(body["days"]) == 30 and body["days"][0]["date"] == "2026-11-09"
    assert days["2026-11-09"]["available"] is True  # today: the 14:00 slot is still ahead
    assert days["2026-11-11"]["reason"] == "closure"
    assert days["2026-11-13"]["reason"] == "closed"
    assert body["earliest_date"] == "2026-11-09"


async def test_earliest_date_respects_lead_time_and_cart(client, owner):
    await standard_week(client, owner)
    p = await cake(client, owner, lead_time_hours=72)
    with at(MON, 11):
        r = await client.get(
            f"{API}/availability/dates",
            params={"fulfilment": "pickup", "items": str(p["variants"][0]["id"]), "days": 7},
        )
    body = r.json()
    assert len(body["days"]) == 7
    assert (
        body["earliest_date"] == "2026-11-12"
    )  # Thu 12:00 is the first slot at least 72h after Mon 11:00
    assert body["days"][3]["available"] is True  # Thu 12:00/14:00 slots are after Thu 11:00
    assert body["days"][0]["reason"] == "lead_time"


async def test_dates_when_nothing_is_configured(client):
    with at(MON):
        body = (
            await client.get(
                f"{API}/availability/dates", params={"fulfilment": "delivery", "days": 3}
            )
        ).json()
    assert body["earliest_date"] is None and all(d["reason"] == "closed" for d in body["days"])


async def test_dates_use_a_fixed_number_of_queries(client, owner):
    from sqlalchemy import event

    from app.database import engine

    await standard_week(client, owner)
    p = await cake(client, owner)
    count = 0

    def counter(*_):
        nonlocal count
        count += 1

    with at(MON):
        event.listen(engine.sync_engine, "before_cursor_execute", counter)
        try:
            r = await client.get(
                f"{API}/availability/dates",
                params={
                    "fulfilment": "delivery",
                    "days": 60,
                    "items": f"{p['variants'][0]['id']}:2",
                },
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", counter)
    assert r.status_code == 200 and len(r.json()["days"]) == 60
    assert count <= 10  # a few loads for the whole range, not per day


# ---------- availability: input validation ----------
@pytest.mark.parametrize("items", ["abc", "1:0", "1:101", "0", "-3", "1:x", ","])
async def test_bad_items_are_rejected(client, items):
    with at(MON):
        r = await client.get(
            f"{API}/availability/slots",
            params={"date": str(TUE), "fulfilment": "delivery", "items": items},
        )
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_items"


async def test_unknown_or_unbuyable_items_are_rejected(client, owner):
    p = await cake(client, owner)
    vid = p["variants"][0]["id"]
    with at(MON):
        unknown = await client.get(
            f"{API}/availability/slots",
            params={"date": str(TUE), "fulfilment": "delivery", "items": "99999"},
        )
        assert unknown.json()["error"]["code"] == "item_unavailable"
        await client.post(f"{A}/products/{p['id']}/archive", headers=owner)
        archived = await client.get(
            f"{API}/availability/slots",
            params={"date": str(TUE), "fulfilment": "delivery", "items": str(vid)},
        )
    assert (
        archived.status_code == 422 and "no longer available" in archived.json()["error"]["message"]
    )


async def test_date_and_fulfilment_validation(client):
    with at(MON):
        past = await client.get(
            f"{API}/availability/slots", params={"date": "2026-11-08", "fulfilment": "delivery"}
        )
        far = await client.get(
            f"{API}/availability/slots", params={"date": "2027-03-01", "fulfilment": "delivery"}
        )
        bad = await client.get(
            f"{API}/availability/slots", params={"date": str(TUE), "fulfilment": "teleport"}
        )
        no_type = await client.get(f"{API}/availability/dates")
        too_many = await client.get(
            f"{API}/availability/dates", params={"fulfilment": "delivery", "days": 61}
        )
    assert past.json()["error"]["code"] == "past_date"
    assert far.json()["error"]["code"] == "too_far_ahead"
    assert bad.status_code == no_type.status_code == too_many.status_code == 422


async def test_availability_is_public(client):
    with at(MON):
        assert (
            await client.get(f"{API}/availability/dates", params={"fulfilment": "pickup"})
        ).status_code == 200


async def test_demo_schedule_seed_is_idempotent_and_bookable(client):
    from app.database import SessionLocal
    from app.services.demo_seed import seed_demo_schedule

    async with SessionLocal() as db:
        assert await seed_demo_schedule(db) is True
    async with SessionLocal() as db:
        assert await seed_demo_schedule(db) is False
    hours = (await client.get(f"{API}/store")).json()["opening_hours"]
    assert hours[4]["opens_at"].startswith("13:00") and hours[0]["opens_at"].startswith("09:00")
    zones = (await client.get(f"{API}/delivery-zones")).json()
    assert [z["name"] for z in zones][:2] == ["Maadi", "Zamalek"] and zones[0]["fee"] == 4000
    with at(MON, 8):
        mon = by_start(await slots(client, MON))
        fri = by_start(await slots(client, FRI))
    assert list(mon) == ["10:00", "12:00", "14:00", "16:00", "18:00"] and all(
        s["available"] for s in mon.values()
    )
    assert list(fri) == ["14:00", "16:00", "18:00"]  # Friday starts later
