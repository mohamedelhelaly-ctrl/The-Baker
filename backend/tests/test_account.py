from tests.test_checkout import API, order_body, place, shop, zone
from tests.test_schedule import MON, at

ME = f"{API}/me"
HOME = {
    "label": "Home",
    "zone_id": 1,
    "street": "12 Road 9",
    "building": "5",
    "floor": "3",
    "apartment": "7",
    "landmark": "Next to the mosque",
}


async def a_zone(client, owner, **kw):
    return (await zone(client, owner, **kw))["id"]


# ================================================================ profile
async def test_a_customer_edits_their_name_and_phone(client, make_headers):
    h = await make_headers("customer")
    r = await client.patch(
        ME, json={"full_name": "  Sara Ali ", "phone": "+20 100 123 4567"}, headers=h
    )
    assert r.status_code == 200
    me = (await client.get(f"{API}/auth/me", headers=h)).json()
    assert me["full_name"] == "Sara Ali" and me["phone"] == "+20 100 123 4567"
    blank = await client.patch(ME, json={"full_name": "Sara", "phone": "  "}, headers=h)
    assert blank.status_code == 200 and blank.json()["phone"] is None


async def test_profile_changes_are_checked_and_need_a_login(client, make_headers):
    h = await make_headers("customer")
    assert (await client.patch(ME, json={"full_name": "  "}, headers=h)).status_code == 422
    assert (
        await client.patch(ME, json={"full_name": "Sara", "phone": "call me"}, headers=h)
    ).status_code == 422
    assert (await client.patch(ME, json={"full_name": "Sara"})).status_code == 401
    r = await client.patch(
        ME, json={"full_name": "Sara", "email": "x@y.z", "role": "owner"}, headers=h
    )
    assert r.json()["role"] == "customer" and r.json()["email"] != "x@y.z"  # not editable here


# ================================================================ addresses
async def test_saved_addresses_can_be_created_listed_edited_and_deleted(
    client, owner, make_headers
):
    zid = await a_zone(client, owner)
    h = await make_headers("customer")
    made = await client.post(ME + "/addresses", json={**HOME, "zone_id": zid}, headers=h)
    assert made.status_code == 201, made.text
    a = made.json()
    assert a["zone_name"] == "Maadi" and a["is_default"] is True  # the first one is the default
    listing = (await client.get(ME + "/addresses", headers=h)).json()
    assert [x["label"] for x in listing] == ["Home"]
    edited = await client.patch(
        f"{ME}/addresses/{a['id']}",
        json={**HOME, "zone_id": zid, "street": "7 Nile", "label": "Work"},
        headers=h,
    )
    assert edited.status_code == 200 and edited.json()["street"] == "7 Nile"
    assert (await client.delete(f"{ME}/addresses/{a['id']}", headers=h)).status_code == 204
    assert (await client.get(ME + "/addresses", headers=h)).json() == []


async def test_only_one_address_is_the_default(client, owner, make_headers):
    zid = await a_zone(client, owner)
    h = await make_headers("customer")
    first = (await client.post(ME + "/addresses", json={**HOME, "zone_id": zid}, headers=h)).json()
    second = (
        await client.post(
            ME + "/addresses",
            json={**HOME, "zone_id": zid, "label": "Work", "is_default": True},
            headers=h,
        )
    ).json()
    listing = (await client.get(ME + "/addresses", headers=h)).json()
    assert [(x["label"], x["is_default"]) for x in listing] == [("Work", True), ("Home", False)]
    again = await client.patch(
        f"{ME}/addresses/{first['id']}",
        json={**HOME, "zone_id": zid, "is_default": True},
        headers=h,
    )
    assert again.json()["is_default"] is True
    listing = (await client.get(ME + "/addresses", headers=h)).json()
    assert [x["is_default"] for x in listing] == [True, False] and listing[0]["id"] == first["id"]
    assert second["id"] != first["id"]


async def test_addresses_belong_to_one_person_only(client, owner, make_headers):
    zid = await a_zone(client, owner)
    mine, other = await make_headers("customer"), await make_headers("customer")
    a = (await client.post(ME + "/addresses", json={**HOME, "zone_id": zid}, headers=mine)).json()
    assert (await client.get(ME + "/addresses", headers=other)).json() == []
    for call in (
        client.patch(f"{ME}/addresses/{a['id']}", json={**HOME, "zone_id": zid}, headers=other),
        client.delete(f"{ME}/addresses/{a['id']}", headers=other),
    ):
        assert (await call).status_code == 404
    assert (await client.get(ME + "/addresses")).status_code == 401
    assert len((await client.get(ME + "/addresses", headers=mine)).json()) == 1


async def test_address_input_is_checked(client, owner, make_headers):
    zid = await a_zone(client, owner)
    h = await make_headers("customer")
    bad = await client.post(
        ME + "/addresses", json={**HOME, "zone_id": zid, "street": " "}, headers=h
    )
    assert bad.status_code == 422 and "street" in bad.json()["error"]["fields"]
    nozone = await client.post(ME + "/addresses", json={**HOME, "zone_id": 99999}, headers=h)
    assert nozone.status_code == 422 and nozone.json()["error"]["code"] == "zone_unavailable"
    blank = await client.post(
        ME + "/addresses", json={**HOME, "zone_id": zid, "floor": " ", "landmark": ""}, headers=h
    )
    assert blank.json()["floor"] is None and blank.json()["landmark"] is None


async def test_there_is_a_limit_on_saved_addresses(client, owner, make_headers):
    zid = await a_zone(client, owner)
    h = await make_headers("customer")
    for n in range(10):
        r = await client.post(
            ME + "/addresses", json={**HOME, "zone_id": zid, "label": f"A{n}"}, headers=h
        )
        assert r.status_code == 201
    over = await client.post(
        ME + "/addresses", json={**HOME, "zone_id": zid, "label": "A11"}, headers=h
    )
    assert over.status_code == 422 and over.json()["error"]["code"] == "too_many_addresses"


# ================================================================ order history
async def test_order_history_lists_only_my_orders_newest_first(client, owner, make_headers):
    mine, other = await make_headers("customer"), await make_headers("customer")
    z, p, slots = await shop(client, owner)
    variant = p["variants"][0]["id"]
    codes = []
    with at(MON):
        # each time slot takes two orders
        for slot, who, qty in (
            (slots[0], mine, 1),
            (slots[0], other, 1),
            (slots[1], None, 1),
            (slots[1], mine, 3),
        ):
            r = await place(
                client, order_body(variant, slot, qty=qty, zone_id=z["id"]), headers=who
            )
            assert r.status_code == 201, r.text
            codes.append(r.json()["code"])
    history = (await client.get(ME + "/orders", headers=mine)).json()
    assert [o["code"] for o in history["items"]] == [codes[3], codes[0]]  # newest first
    first = history["items"][0]
    assert first["summary"] == "3 × Chocolate Cake" and first["status"] == "received"
    assert first["total"] == 3 * 65000 + 4000 and first["currency"] == "EGP"
    assert history["total"] == 2
    assert (await client.get(ME + "/orders", headers=other)).json()["total"] == 1
    assert (await client.get(ME + "/orders")).status_code == 401


async def test_order_history_is_paged(client, owner, make_headers):
    mine = await make_headers("customer")
    z, p, slots = await shop(client, owner)
    with at(MON):
        for slot in slots:
            await place(
                client, order_body(p["variants"][0]["id"], slot, zone_id=z["id"]), headers=mine
            )
    page = (await client.get(ME + "/orders", params={"page_size": 2}, headers=mine)).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["total_pages"] == 2
    second = (
        await client.get(ME + "/orders", params={"page_size": 2, "page": 2}, headers=mine)
    ).json()
    assert len(second["items"]) == 1


# ================================================================ saved cart
async def test_a_cart_is_saved_on_the_account_and_comes_back(client, make_headers):
    h = await make_headers("customer")
    assert (await client.get(ME + "/cart", headers=h)).json() == {"lines": []}
    lines = [
        {"variant_id": 10, "quantity": 2, "inscription": "Happy Birthday"},
        {"variant_id": 11, "quantity": 1, "inscription": None},
    ]
    saved = await client.put(ME + "/cart", json={"lines": lines}, headers=h)
    assert saved.status_code == 200 and saved.json()["lines"] == lines
    assert (await client.get(ME + "/cart", headers=h)).json()["lines"] == lines
    replaced = await client.put(ME + "/cart", json={"lines": lines[:1]}, headers=h)
    assert replaced.status_code == 200
    assert (await client.get(ME + "/cart", headers=h)).json()["lines"] == lines[:1]
    assert (await client.put(ME + "/cart", json={"lines": []}, headers=h)).status_code == 200
    assert (await client.get(ME + "/cart", headers=h)).json() == {"lines": []}


async def test_carts_are_private_to_each_account(client, make_headers):
    mine, other = await make_headers("customer"), await make_headers("customer")
    await client.put(
        ME + "/cart", json={"lines": [{"variant_id": 10, "quantity": 3}]}, headers=mine
    )
    assert (await client.get(ME + "/cart", headers=other)).json() == {"lines": []}
    assert (await client.get(ME + "/cart")).status_code == 401
    assert (await client.put(ME + "/cart", json={"lines": []})).status_code == 401


async def test_nonsense_carts_are_refused(client, make_headers):
    h = await make_headers("customer")
    for lines in (
        [{"variant_id": 10, "quantity": 0}],
        [{"variant_id": 10, "quantity": 101}],
        [{"variant_id": 0, "quantity": 1}],
        [{"variant_id": 10, "quantity": 1, "inscription": "x" * 81}],
        [{"variant_id": n, "quantity": 1} for n in range(1, 32)],  # more than 30 lines
    ):
        r = await client.put(ME + "/cart", json={"lines": lines}, headers=h)
        assert r.status_code == 422, lines


async def test_two_tabs_saving_at_once_keep_one_cart_row(client, make_headers):
    import asyncio

    from sqlalchemy import func, select

    from app.database import SessionLocal
    from app.models.cart import SavedCart

    h = await make_headers("customer")
    results = await asyncio.gather(
        *[
            client.put(ME + "/cart", json={"lines": [{"variant_id": 10, "quantity": n}]}, headers=h)
            for n in range(1, 6)
        ]
    )
    assert all(r.status_code == 200 for r in results)
    async with SessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(SavedCart))).scalar_one() == 1
