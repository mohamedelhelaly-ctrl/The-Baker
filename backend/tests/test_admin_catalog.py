import io

import pytest
from PIL import Image

A = "/api/v1/admin"


def png(size=(40, 30), color=(200, 100, 50), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format="PNG")
    return buf.getvalue()


async def make_category(client, owner, name="Cakes"):
    r = await client.post(f"{A}/categories", json={"name": name}, headers=owner)
    assert r.status_code == 201, r.text
    return r.json()


async def make_product(client, owner, category_id, name="Chocolate Cake", **extra):
    body = {
        "category_id": category_id,
        "name": name,
        "description": "Rich chocolate sponge",
        "ingredients": "Flour, cocoa, eggs",
        "variants": [{"name": "6-inch", "price": 45000}, {"name": "8-inch", "price": 70000}],
        **extra,
    }
    r = await client.post(f"{A}/products", json=body, headers=owner)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- access control ----------
@pytest.mark.parametrize("role", ["customer", "staff"])
async def test_only_owner_can_manage_catalog(client, make_headers, role):
    headers = await make_headers(role)
    for method, path in [("get", "/products"), ("get", "/categories"), ("post", "/categories")]:
        r = await getattr(client, method)(
            f"{A}{path}", headers=headers, **({"json": {"name": "x"}} if method == "post" else {})
        )
        assert r.status_code == 403, (method, path)


async def test_admin_requires_login(client):
    assert (await client.get(f"{A}/products")).status_code == 401
    assert (await client.post(f"{A}/categories", json={"name": "x"})).status_code == 401


# ---------- categories and occasions ----------
async def test_category_slug_is_unique_and_stable_on_rename(client, owner):
    a = await make_category(client, owner, "Celebration Cakes")
    b = await make_category(client, owner, "Celebration Cakes")
    assert a["slug"] == "celebration-cakes" and b["slug"] == "celebration-cakes-2"
    r = await client.patch(f"{A}/categories/{a['id']}", json={"name": "Party Cakes"}, headers=owner)
    assert r.json()["name"] == "Party Cakes" and r.json()["slug"] == "celebration-cakes"


async def test_category_validation(client, owner):
    r = await client.post(f"{A}/categories", json={"name": "   "}, headers=owner)
    assert r.status_code == 422 and "name" in r.json()["error"]["fields"]


async def test_archived_category_hides_its_products_publicly(client, owner):
    cat = await make_category(client, owner)
    await make_product(client, owner, cat["id"])
    assert (await client.get("/api/v1/products")).json()["total"] == 1
    await client.post(f"{A}/categories/{cat['id']}/archive", headers=owner)
    assert (await client.get("/api/v1/products")).json()["total"] == 0
    assert (await client.get("/api/v1/categories")).json() == []
    await client.post(f"{A}/categories/{cat['id']}/restore", headers=owner)
    assert (await client.get("/api/v1/products")).json()["total"] == 1


# ---------- products ----------
async def test_create_product_with_variants_and_occasions(client, owner):
    cat = await make_category(client, owner)
    occ = (await client.post(f"{A}/occasions", json={"name": "Birthday"}, headers=owner)).json()
    p = await make_product(
        client, owner, cat["id"], occasion_ids=[occ["id"]], lead_time_hours=48, daily_capacity=5
    )
    assert p["slug"] == "chocolate-cake"
    assert [v["price"] for v in p["variants"]] == [45000, 70000]
    assert p["occasions"][0]["slug"] == "birthday"
    assert p["lead_time_hours"] == 48 and p["daily_capacity"] == 5
    assert p["category"]["slug"] == "cakes"


async def test_product_needs_a_size_and_valid_references(client, owner):
    cat = await make_category(client, owner)
    base = {"category_id": cat["id"], "name": "Plain"}
    assert (
        await client.post(f"{A}/products", json={**base, "variants": []}, headers=owner)
    ).status_code == 422
    bad_price = {**base, "variants": [{"name": "S", "price": 0}]}
    assert (await client.post(f"{A}/products", json=bad_price, headers=owner)).status_code == 422
    ok_variant = [{"name": "S", "price": 100}]
    r = await client.post(
        f"{A}/products", json={**base, "category_id": 999, "variants": ok_variant}, headers=owner
    )
    assert r.json()["error"]["code"] == "invalid_category"
    r = await client.post(
        f"{A}/products", json={**base, "occasion_ids": [999], "variants": ok_variant}, headers=owner
    )
    assert r.json()["error"]["code"] == "invalid_occasion"


async def test_update_product_partially_and_replace_occasions(client, owner):
    cat = await make_category(client, owner)
    o1 = (await client.post(f"{A}/occasions", json={"name": "Wedding"}, headers=owner)).json()
    p = await make_product(client, owner, cat["id"], occasion_ids=[o1["id"]])
    r = await client.patch(
        f"{A}/products/{p['id']}",
        json={"name": "Dark Chocolate Cake", "occasion_ids": []},
        headers=owner,
    )
    body = r.json()
    assert body["name"] == "Dark Chocolate Cake" and body["slug"] == "chocolate-cake"
    assert body["occasions"] == [] and body["description"] == "Rich chocolate sponge"
    r = await client.patch(f"{A}/products/{p['id']}", json={"name": None}, headers=owner)
    assert r.status_code == 422


async def test_archive_hides_from_menu_but_keeps_in_admin(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    await client.post(f"{A}/products/{p['id']}/archive", headers=owner)
    assert (await client.get("/api/v1/products")).json()["total"] == 0
    assert (await client.get(f"/api/v1/products/{p['slug']}")).status_code == 404
    listed = (await client.get(f"{A}/products?archived=true", headers=owner)).json()
    assert listed["total"] == 1 and listed["items"][0]["is_archived"] is True
    assert (await client.get(f"{A}/products/{p['id']}", headers=owner)).status_code == 200


async def test_variants_can_be_added_changed_and_the_last_one_is_protected(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"], variants=[{"name": "Only", "price": 1000}])
    only = p["variants"][0]["id"]
    assert (
        await client.delete(f"{A}/products/{p['id']}/variants/{only}", headers=owner)
    ).status_code == 409
    added = await client.post(
        f"{A}/products/{p['id']}/variants", json={"name": "Big", "price": 2500}, headers=owner
    )
    assert added.status_code == 201
    r = await client.patch(
        f"{A}/products/{p['id']}/variants/{added.json()['id']}", json={"price": 3000}, headers=owner
    )
    assert r.json()["price"] == 3000
    assert (
        await client.delete(f"{A}/products/{p['id']}/variants/{added.json()['id']}", headers=owner)
    ).status_code == 204
    assert (
        await client.patch(
            f"{A}/products/{p['id']}/variants/99999", json={"price": 5}, headers=owner
        )
    ).status_code == 404


# ---------- images ----------
async def upload(client, owner, pid, data=None, alt="A chocolate cake on a plate", name="cake.png"):
    return await client.post(
        f"{A}/products/{pid}/images",
        files={"file": (name, data if data is not None else png(), "image/png")},
        data={"alt_text": alt},
        headers=owner,
    )


async def test_upload_converts_to_webp_and_serves_it(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    r = await upload(client, owner, p["id"])
    assert r.status_code == 201, r.text
    img = r.json()
    assert img["alt_text"] == "A chocolate cake on a plate"
    assert img["url"].startswith("http://api.test/media/products/") and img["url"].endswith(".webp")
    served = await client.get(img["url"].replace("http://api.test", ""))
    assert served.status_code == 200
    assert Image.open(io.BytesIO(served.content)).format == "WEBP"


async def test_upload_rejects_missing_alt_text_and_bad_files(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    assert (await upload(client, owner, p["id"], alt="   ")).json()["error"][
        "code"
    ] == "alt_required"
    r = await client.post(
        f"{A}/products/{p['id']}/images",
        files={"file": ("a.png", png(), "image/png")},
        headers=owner,
    )
    assert r.status_code == 422  # alt_text field missing
    not_image = await upload(
        client, owner, p["id"], data=b"<script>alert(1)</script>", name="evil.png"
    )
    assert not_image.status_code == 422 and not_image.json()["error"]["code"] == "invalid_image"
    gif = io.BytesIO()
    Image.new("RGB", (5, 5)).save(gif, format="GIF")
    assert (
        await upload(client, owner, p["id"], data=gif.getvalue(), name="a.png")
    ).status_code == 422
    assert (await client.get(f"{A}/products/{p['id']}", headers=owner)).json()["images"] == []


async def test_upload_size_limit(client, owner, monkeypatch):
    from app.config import get_settings

    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    assert (await upload(client, owner, p["id"], data=png((200, 200)))).status_code == 413


async def test_image_limit_edit_and_delete_removes_file(client, owner):
    import os

    from app.config import get_settings

    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    first = (await upload(client, owner, p["id"])).json()
    second = (await upload(client, owner, p["id"], alt="Second view")).json()
    assert second["sort_order"] == first["sort_order"] + 1
    r = await client.patch(
        f"{A}/products/{p['id']}/images/{second['id']}",
        json={"alt_text": "Cut slice", "sort_order": -1},
        headers=owner,
    )
    assert r.json()["alt_text"] == "Cut slice"
    detail = (await client.get(f"{A}/products/{p['id']}", headers=owner)).json()
    assert detail["images"][0]["id"] == second["id"]  # reordered first

    path = os.path.join(get_settings().upload_dir, "products", str(p["id"]))
    before = len(os.listdir(path))
    assert (
        await client.delete(f"{A}/products/{p['id']}/images/{first['id']}", headers=owner)
    ).status_code == 204
    assert len(os.listdir(path)) == before - 1

    for _ in range(7):
        await upload(client, owner, p["id"])
    assert (await upload(client, owner, p["id"])).json()["error"]["code"] == "too_many_images"


async def test_exif_is_stripped(client, owner):
    cat = await make_category(client, owner)
    p = await make_product(client, owner, cat["id"])
    im = Image.new("RGB", (30, 30), (10, 20, 30))
    exif = im.getexif()
    exif[0x010F] = "SecretCamera"
    buf = io.BytesIO()
    im.save(buf, format="JPEG", exif=exif)
    img = (await upload(client, owner, p["id"], data=buf.getvalue(), name="a.jpg")).json()
    out = Image.open(
        io.BytesIO((await client.get(img["url"].replace("http://api.test", ""))).content)
    )
    assert 0x010F not in out.getexif()
