from tests.test_admin_catalog import A, make_category, make_product

P = "/api/v1/products"


async def seed(client, owner):
    cakes = await make_category(client, owner, "Cakes")
    breads = await make_category(client, owner, "Breads")
    bday = (await client.post(f"{A}/occasions", json={"name": "Birthday"}, headers=owner)).json()
    eid = (await client.post(f"{A}/occasions", json={"name": "Eid"}, headers=owner)).json()
    choc = await make_product(
        client, owner, cakes["id"], "Chocolate Cake", occasion_ids=[bday["id"]], is_featured=True
    )
    await make_product(
        client,
        owner,
        cakes["id"],
        "Vanilla Cake",
        description="Light and fluffy",
        occasion_ids=[bday["id"], eid["id"]],
        variants=[{"name": "S", "price": 30000}],
    )
    await make_product(
        client,
        owner,
        breads["id"],
        "Sourdough",
        description="100% natural_starter",
        variants=[{"name": "Loaf", "price": 9000}],
    )
    return choc


async def test_public_menu_needs_no_login_and_hides_admin_fields(client, owner):
    await seed(client, owner)
    r = await client.get(P)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3 and body["page"] == 1 and body["total_pages"] == 1
    item = body["items"][0]
    assert set(item) == {"id", "slug", "name", "category", "price_from", "image", "is_featured"}
    assert item["name"] == "Chocolate Cake"  # featured first
    assert item["price_from"] == 45000


async def test_filter_by_category_and_occasion(client, owner):
    await seed(client, owner)
    cakes = (await client.get(f"{P}?category=cakes")).json()
    assert {i["name"] for i in cakes["items"]} == {"Chocolate Cake", "Vanilla Cake"}
    eid = (await client.get(f"{P}?occasion=eid")).json()
    assert [i["name"] for i in eid["items"]] == ["Vanilla Cake"]
    both = (await client.get(f"{P}?category=breads&occasion=eid")).json()
    assert both["total"] == 0


async def test_search_matches_name_and_description_case_insensitively(client, owner):
    await seed(client, owner)
    assert [i["name"] for i in (await client.get(f"{P}?q=SOURDOUGH")).json()["items"]] == [
        "Sourdough"
    ]
    assert [i["name"] for i in (await client.get(f"{P}?q=fluffy")).json()["items"]] == [
        "Vanilla Cake"
    ]
    assert (await client.get(f"{P}?q=nothing-like-this")).json()["total"] == 0


async def test_search_treats_wildcards_literally(client, owner):
    await seed(client, owner)
    assert (await client.get(f"{P}?q=%25")).json()["total"] == 1  # only the "100%" description
    assert (await client.get(f"{P}?q=_")).json()["total"] == 1  # only "natural_starter"


async def test_sorting(client, owner):
    await seed(client, owner)

    def names(r):
        return [i["name"] for i in r.json()["items"]]

    assert names(await client.get(f"{P}?sort=price_asc")) == [
        "Sourdough",
        "Vanilla Cake",
        "Chocolate Cake",
    ]
    assert names(await client.get(f"{P}?sort=price_desc")) == [
        "Chocolate Cake",
        "Vanilla Cake",
        "Sourdough",
    ]
    assert names(await client.get(f"{P}?sort=name")) == [
        "Chocolate Cake",
        "Sourdough",
        "Vanilla Cake",
    ]
    assert (await client.get(f"{P}?sort=bogus")).status_code == 422


async def test_pagination_is_bounded_and_consistent(client, owner):
    cat = await make_category(client, owner)
    for n in range(5):
        await make_product(client, owner, cat["id"], f"Cake {n}")
    p1 = (await client.get(f"{P}?page_size=2&sort=name")).json()
    p3 = (await client.get(f"{P}?page_size=2&page=3&sort=name")).json()
    assert p1["total"] == 5 and p1["total_pages"] == 3
    assert [i["name"] for i in p1["items"]] == ["Cake 0", "Cake 1"]
    assert [i["name"] for i in p3["items"]] == ["Cake 4"]
    assert (await client.get(f"{P}?page_size=101")).status_code == 422
    assert (await client.get(f"{P}?page=0")).status_code == 422
    assert (await client.get(f"{P}?page=99")).json()["items"] == []


async def test_unavailable_and_variantless_products_are_not_listed(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"], is_available=False)
    assert (await client.get(P)).json()["total"] == 0
    assert (await client.get(f"{P}/{p['slug']}")).status_code == 404
    await client.patch(f"{A}/products/{p['id']}", json={"is_available": True}, headers=owner)
    for v in p["variants"]:
        await client.patch(
            f"{A}/products/{p['id']}/variants/{v['id']}", json={"is_active": False}, headers=owner
        )
    assert (await client.get(P)).json()["total"] == 0  # nothing to buy


async def test_product_detail_shows_only_active_sizes(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    await client.patch(
        f"{A}/products/{p['id']}/variants/{p['variants'][1]['id']}",
        json={"is_active": False},
        headers=owner,
    )
    body = (await client.get(f"{P}/{p['slug']}")).json()
    assert [v["name"] for v in body["variants"]] == ["6-inch"]
    assert body["ingredients"] == "Flour, cocoa, eggs"
    assert "daily_capacity" not in body and "is_archived" not in body
    assert (await client.get(f"{P}/missing")).json()["error"]["code"] == "product_not_found"


async def test_lists_use_a_constant_number_of_queries(client, owner):
    from sqlalchemy import event

    from app.database import engine

    cat = await make_category(client, owner)
    for n in range(6):
        await make_product(client, owner, cat["id"], f"Cake {n}")
    count = 0

    def counter(*_):
        nonlocal count
        count += 1

    event.listen(engine.sync_engine, "before_cursor_execute", counter)
    try:
        await client.get(f"{P}?page_size=6")
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", counter)
    assert count <= 4  # count + page + images, regardless of the number of products


async def test_store_info_and_taxonomy_lists(client, owner):
    await seed(client, owner)
    assert (await client.get("/api/v1/store")).json() == {
        "name": "The Baker",
        "currency": "EGP",
        "currency_exponent": 2,
        "opening_hours": [],
        "payment_methods": ["cod"],
    }
    assert [c["slug"] for c in (await client.get("/api/v1/categories")).json()] == [
        "breads",
        "cakes",
    ]
    assert {o["slug"] for o in (await client.get("/api/v1/occasions")).json()} == {
        "birthday",
        "eid",
    }


async def test_demo_seed_is_idempotent_and_browsable(client):
    from app.database import SessionLocal
    from app.services.demo_seed import seed_demo_catalog

    async with SessionLocal() as db:
        assert await seed_demo_catalog(db) is True
    async with SessionLocal() as db:
        assert await seed_demo_catalog(db) is False
    body = (await client.get(f"{P}?page_size=100")).json()
    assert body["total"] >= 28
    assert all(i["image"] and i["image"]["alt_text"] for i in body["items"])
    assert (await client.get(f"{P}?category=breads")).json()["total"] == 5
    assert (await client.get(f"{P}?occasion=ramadan-eid")).json()["total"] >= 4
