import pytest
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models.user import User
from app.services.demo_seed import seed_demo_accounts
from tests.test_admin_catalog import A
from tests.test_checkout import API, order_body, place, shop
from tests.test_schedule import MON, at

TEAM = f"{A}/team"
PASSWORD = "temporary-pass-1"


async def login(client, email, password=PASSWORD):
    return await client.post(f"{API}/auth/login", json={"email": email, "password": password})


async def add(client, owner, email="baker@example.com", **extra):
    body = {
        "email": email,
        "full_name": "Omar Baker",
        "role": "staff",
        "password": PASSWORD,
        **extra,
    }
    return await client.post(TEAM, json=body, headers=owner)


async def my_id(client, headers) -> int:
    return (await client.get(f"{API}/auth/me", headers=headers)).json()["id"]


# ================================================================ access
async def test_only_the_owner_manages_the_team(client, owner, make_headers):
    for role in ("staff", "customer"):
        h = await make_headers(role)
        assert (await client.get(TEAM, headers=h)).status_code == 403
        assert (await add(client, h)).status_code == 403
        assert (
            await client.patch(f"{TEAM}/1", json={"is_active": False}, headers=h)
        ).status_code == 403
        assert (await client.delete(f"{TEAM}/1", headers=h)).status_code == 403
    assert (await client.get(TEAM)).status_code == 401


async def test_the_list_has_staff_and_owners_but_no_customers(client, owner, make_headers):
    await make_headers("staff")
    await make_headers("customer")
    members = (await client.get(TEAM, headers=owner)).json()
    assert sorted(m["role"] for m in members) == ["owner", "staff"]
    assert all("password" not in m and "password_hash" not in m for m in members)


# ================================================================ adding
async def test_a_new_staff_member_can_sign_in_and_work_the_queue_but_not_manage(client, owner):
    r = await add(client, owner, email="Baker@Example.com")
    assert r.status_code == 201, r.text
    member = r.json()
    assert (
        member["email"] == "baker@example.com" and member["role"] == "staff" and member["is_active"]
    )
    assert "password" not in member
    signed_in = await login(client, "baker@example.com")
    assert signed_in.status_code == 200
    staff = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    assert (await client.get(f"{API}/staff/orders", headers=staff)).status_code == 200
    assert (await client.get(TEAM, headers=staff)).status_code == 403
    assert (await client.get(f"{A}/products", headers=staff)).status_code == 403


async def test_a_new_owner_can_manage_the_team(client, owner):
    await add(client, owner, role="owner")
    token = (await login(client, "baker@example.com")).json()["access_token"]
    assert (await client.get(TEAM, headers={"Authorization": f"Bearer {token}"})).status_code == 200


async def test_bad_accounts_are_refused(client, owner, make_headers):
    assert (await add(client, owner, password="short")).status_code == 422
    assert (await add(client, owner, role="customer")).status_code == 422
    assert (await add(client, owner, role="admin")).status_code == 422
    assert (await add(client, owner, email="not-an-email")).status_code == 422
    assert (await add(client, owner, full_name="  ")).status_code == 422
    assert (await add(client, owner)).status_code == 201
    duplicate = await add(client, owner)
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "email_taken"
    await make_headers("customer")  # an existing customer's email cannot be reused either
    async with SessionLocal() as db:
        email = (await db.execute(select(User.email).where(User.role == "customer"))).scalar_one()
    assert (await add(client, owner, email=email)).status_code == 409


# ================================================================ removing and changing
async def test_removing_a_member_switches_the_account_off_and_ends_their_session(client, owner):
    member = (await add(client, owner)).json()
    token = (await login(client, "baker@example.com")).json()["access_token"]
    staff = {"Authorization": f"Bearer {token}"}
    assert (await client.get(f"{API}/staff/orders", headers=staff)).status_code == 200
    removed = await client.delete(f"{TEAM}/{member['id']}", headers=owner)
    assert removed.status_code == 200 and removed.json()["is_active"] is False
    assert (
        await client.get(f"{API}/staff/orders", headers=staff)
    ).status_code == 401  # session over
    assert (await login(client, "baker@example.com")).status_code == 401
    listed = [m for m in (await client.get(TEAM, headers=owner)).json() if m["id"] == member["id"]]
    assert listed and listed[0]["is_active"] is False  # kept, not erased
    back = await client.patch(f"{TEAM}/{member['id']}", json={"is_active": True}, headers=owner)
    assert (
        back.json()["is_active"] is True
        and (await login(client, "baker@example.com")).status_code == 200
    )


async def test_a_role_can_be_changed(client, owner):
    member = (await add(client, owner)).json()
    r = await client.patch(f"{TEAM}/{member['id']}", json={"role": "owner"}, headers=owner)
    assert r.status_code == 200 and r.json()["role"] == "owner"
    token = (await login(client, "baker@example.com")).json()["access_token"]
    assert (await client.get(TEAM, headers={"Authorization": f"Bearer {token}"})).status_code == 200


async def test_nobody_can_lock_themselves_or_the_shop_out(client, owner):
    me = await my_id(client, owner)
    for call in (
        client.patch(f"{TEAM}/{me}", json={"role": "staff"}, headers=owner),
        client.patch(f"{TEAM}/{me}", json={"is_active": False}, headers=owner),
        client.delete(f"{TEAM}/{me}", headers=owner),
    ):
        r = await call
        assert r.status_code == 409 and r.json()["error"]["code"] == "own_account"
    # a second owner may be demoted or removed by the first, but the last active owner may not
    second = (await add(client, owner, role="owner")).json()
    assert (
        await client.patch(f"{TEAM}/{second['id']}", json={"role": "staff"}, headers=owner)
    ).status_code == 200
    await client.patch(f"{TEAM}/{second['id']}", json={"role": "owner"}, headers=owner)
    assert (await client.delete(f"{TEAM}/{second['id']}", headers=owner)).status_code == 200


async def test_two_owners_cannot_remove_each_other_at_the_same_moment(client, owner):
    import asyncio

    second = (await add(client, owner, role="owner")).json()
    token = (await login(client, "baker@example.com")).json()["access_token"]
    second_headers = {"Authorization": f"Bearer {token}"}
    first_id = await my_id(client, owner)
    results = await asyncio.gather(
        client.delete(f"{TEAM}/{second['id']}", headers=owner),
        client.delete(f"{TEAM}/{first_id}", headers=second_headers),
    )
    # one removal wins; the other is stopped (its owner was removed first, or the last-owner rule applies)
    assert sorted(r.status_code for r in results)[0] == 200 and any(
        r.status_code in (401, 409) for r in results
    )
    async with SessionLocal() as db:
        active = (
            (await db.execute(select(User).where(User.role == "owner", User.is_active.is_(True))))
            .scalars()
            .all()
        )
    assert len(active) == 1  # somebody can still run the shop


async def test_the_last_owner_rule_itself(client, owner):
    from app.core.errors import ApiError
    from app.routers.admin_team import _keep_an_owner

    async with SessionLocal() as db:
        only = (await db.execute(select(User).where(User.role == "owner"))).scalar_one()
        with pytest.raises(ApiError) as caught:
            await _keep_an_owner(db, only, will_stay_owner=False)
        assert caught.value.code == "last_owner"
        await _keep_an_owner(db, only, will_stay_owner=True)  # staying an owner is always fine
    await add(client, owner, role="owner")
    async with SessionLocal() as db:
        only = (
            await db.execute(select(User).where(User.email == "baker@example.com"))
        ).scalar_one()
        await _keep_an_owner(db, only, will_stay_owner=False)  # with two active owners, one may go


async def test_unknown_and_customer_ids_are_not_found(client, owner, make_headers):
    await make_headers("customer")
    async with SessionLocal() as db:
        customer_id = (
            await db.execute(select(User.id).where(User.role == "customer"))
        ).scalar_one()
    for member_id in (99999, customer_id):
        assert (
            await client.patch(f"{TEAM}/{member_id}", json={"is_active": False}, headers=owner)
        ).status_code == 404
        assert (await client.delete(f"{TEAM}/{member_id}", headers=owner)).status_code == 404


# ================================================================ change password
async def test_changing_a_password(client, owner):
    await add(client, owner)
    token = (await login(client, "baker@example.com")).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    url = f"{API}/auth/change-password"
    wrong = await client.post(
        url,
        json={"current_password": "nope-nope-nope", "new_password": "brand-new-pass-1"},
        headers=h,
    )
    assert wrong.status_code == 422 and "current_password" in wrong.json()["error"]["fields"]
    same = await client.post(
        url, json={"current_password": PASSWORD, "new_password": PASSWORD}, headers=h
    )
    assert same.status_code == 422 and "new_password" in same.json()["error"]["fields"]
    weak = await client.post(
        url, json={"current_password": PASSWORD, "new_password": "short"}, headers=h
    )
    assert weak.status_code == 422
    assert (
        await client.post(
            url, json={"current_password": PASSWORD, "new_password": "brand-new-pass-1"}
        )
    ).status_code == 401
    ok = await client.post(
        url, json={"current_password": PASSWORD, "new_password": "brand-new-pass-1"}, headers=h
    )
    assert ok.status_code == 200
    assert (await login(client, "baker@example.com", PASSWORD)).status_code == 401
    assert (await login(client, "baker@example.com", "brand-new-pass-1")).status_code == 200


# ================================================================ shop details
DETAILS = {
    "business_name": "Cairo Crumbs",
    "phone": "+20 2 2345 6789",
    "whatsapp": "+20 100 123 4567",
    "email": "hello@cairocrumbs.example",
    "address": "12 Road 9, Maadi, Cairo",
    "pickup_location": "Side door on Road 9",
    "pickup_instructions": "Ring the bell and give your order code.",
}


async def test_the_owner_edits_the_shop_details_and_customers_see_them(client, owner):
    empty = (await client.get(f"{A}/settings", headers=owner)).json()
    assert all(v is None for v in empty.values())
    base = (await client.get(f"{API}/store")).json()
    assert (
        base["name"] == "The Baker" and base["phone"] is None
    )  # falls back to the configured name
    r = await client.put(f"{A}/settings", json=DETAILS, headers=owner)
    assert r.status_code == 200 and r.json() == DETAILS
    store = (await client.get(f"{API}/store")).json()
    assert store["name"] == "Cairo Crumbs" and store["phone"] == DETAILS["phone"]
    assert (
        store["pickup_location"] == DETAILS["pickup_location"]
        and store["address"] == DETAILS["address"]
    )
    cleared = await client.put(
        f"{A}/settings", json={**DETAILS, "business_name": "  ", "phone": ""}, headers=owner
    )
    assert cleared.json()["business_name"] is None and cleared.json()["phone"] is None
    assert (await client.get(f"{API}/store")).json()["name"] == "The Baker"


@pytest.mark.parametrize(
    "bad",
    [
        {"phone": "call us"},
        {"whatsapp": "abc"},
        {"email": "nope"},
        {"address": "x" * 301},
        {"business_name": "x" * 81},
    ],
)
async def test_nonsense_shop_details_are_refused(client, owner, bad):
    assert (await client.put(f"{A}/settings", json=bad, headers=owner)).status_code == 422


async def test_only_the_owner_changes_the_shop_details(client, make_headers):
    for role in ("staff", "customer"):
        h = await make_headers(role)
        assert (await client.get(f"{A}/settings", headers=h)).status_code == 403
        assert (await client.put(f"{A}/settings", json=DETAILS, headers=h)).status_code == 403


async def test_emails_use_the_shop_name_and_pickup_details(client, owner, emails):
    await client.put(f"{A}/settings", json=DETAILS, headers=owner)
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(client, order_body(p["variants"][0]["id"], slots[0], fulfilment="pickup"))
    assert r.status_code == 201
    await emails.flush()
    text = emails.sent[0]["text"]
    assert "Cairo Crumbs" in text and "Collect from: Side door on Road 9. Ring the bell" in text
    assert "The Baker" not in text


# ================================================================ demo accounts
async def test_demo_accounts_exist_only_when_a_password_is_set(client, monkeypatch):
    async with SessionLocal() as db:
        assert await seed_demo_accounts(db) == []
    monkeypatch.setattr(get_settings(), "demo_password", "demo-password-1")
    async with SessionLocal() as db:
        assert await seed_demo_accounts(db) == ["customer@demo.thebaker", "staff@demo.thebaker"]
    async with SessionLocal() as db:
        assert await seed_demo_accounts(db) == []  # nothing more the second time
    staff = await login(client, "staff@demo.thebaker", "demo-password-1")
    customer = await login(client, "customer@demo.thebaker", "demo-password-1")
    assert staff.json()["user"]["role"] == "staff" and customer.json()["user"]["role"] == "customer"
    token = {"Authorization": f"Bearer {staff.json()['access_token']}"}
    assert (await client.get(f"{API}/staff/orders", headers=token)).status_code == 200
