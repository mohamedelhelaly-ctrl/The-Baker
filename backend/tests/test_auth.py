import re

from app.core.clock import utcnow
from app.core.security import create_access_token
from app.database import SessionLocal
from app.services.bootstrap import ensure_first_owner

API = "/api/v1/auth"
USER = {"email": "Sara@Example.com", "password": "correct-horse-1", "full_name": "Sara Ali"}


async def register(client, **overrides):
    return await client.post(f"{API}/register", json={**USER, **overrides})


async def test_register_returns_token_and_lowercases_email(client):
    r = await register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "sara@example.com"
    assert body["user"]["role"] == "customer"
    assert body["access_token"]


async def test_register_duplicate_email_is_409_even_with_different_case(client):
    await register(client)
    r = await register(client, email="SARA@example.com")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


async def test_register_validates_password_and_email(client):
    r = await register(client, password="short", email="not-an-email")
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert set(err["fields"]) == {"password", "email"}


async def test_register_rejects_password_over_bcrypt_limit(client):
    r = await register(client, password="a" * 73)
    assert r.status_code == 422


async def test_login_success_and_me(client):
    await register(client)
    r = await client.post(
        f"{API}/login", json={"email": "sara@example.com", "password": USER["password"]}
    )
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = await client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    body = me.json()
    assert body["full_name"] == "Sara Ali"
    assert body["permissions"]["orders_queue"] == {"read": False, "write": False}
    assert body["permissions"]["account"] == {"read": True, "write": True}


async def test_login_wrong_password_and_unknown_email_look_identical(client):
    await register(client)
    wrong = await client.post(
        f"{API}/login", json={"email": "sara@example.com", "password": "nope-nope-nope"}
    )
    unknown = await client.post(
        f"{API}/login", json={"email": "who@example.com", "password": "nope-nope-nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_me_requires_valid_token(client):
    assert (await client.get(f"{API}/me")).status_code == 401
    r = await client.get(f"{API}/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


async def test_disabled_user_is_rejected(client, sync_engine):
    reg = await register(client)
    token = reg.json()["access_token"]
    from sqlalchemy import text

    with sync_engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active = false"))
    assert (
        await client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"})
    ).status_code == 401
    r = await client.post(
        f"{API}/login", json={"email": "sara@example.com", "password": USER["password"]}
    )
    assert r.status_code == 401


async def test_token_for_deleted_user_is_rejected(client):
    r = await client.get(
        f"{API}/me", headers={"Authorization": f"Bearer {create_access_token(9999)}"}
    )
    assert r.status_code == 401


async def test_forgot_password_same_response_for_known_and_unknown(client, emails):
    await register(client)
    known = await client.post(f"{API}/forgot-password", json={"email": "sara@example.com"})
    unknown = await client.post(f"{API}/forgot-password", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(emails.sent) == 1 and emails.sent[0]["to"] == "sara@example.com"


def _token_from(emails) -> str:
    match = re.search(
        r"http://frontend\.test/reset-password\?token=([\w-]+)", emails.sent[-1]["text"]
    )
    assert match
    return match.group(1)


async def test_reset_password_flow_and_single_use(client, emails):
    await register(client)
    await client.post(f"{API}/forgot-password", json={"email": "sara@example.com"})
    token = _token_from(emails)

    r = await client.post(
        f"{API}/reset-password", json={"token": token, "new_password": "brand-new-pass-9"}
    )
    assert r.status_code == 200

    old = await client.post(
        f"{API}/login", json={"email": "sara@example.com", "password": USER["password"]}
    )
    new = await client.post(
        f"{API}/login", json={"email": "sara@example.com", "password": "brand-new-pass-9"}
    )
    assert old.status_code == 401 and new.status_code == 200

    again = await client.post(
        f"{API}/reset-password", json={"token": token, "new_password": "another-pass-12"}
    )
    assert again.status_code == 400
    assert again.json()["error"]["code"] == "invalid_reset_token"


async def test_reset_password_rejects_expired_and_bogus_tokens(client, emails, sync_engine):
    from sqlalchemy import text

    await register(client)
    await client.post(f"{API}/forgot-password", json={"email": "sara@example.com"})
    token = _token_from(emails)
    with sync_engine.begin() as conn:
        conn.execute(
            text("UPDATE password_reset_tokens SET expires_at = :t"),
            {"t": utcnow().replace(year=2020)},
        )
    expired = await client.post(
        f"{API}/reset-password", json={"token": token, "new_password": "brand-new-pass-9"}
    )
    bogus = await client.post(
        f"{API}/reset-password", json={"token": "x" * 40, "new_password": "brand-new-pass-9"}
    )
    assert expired.status_code == bogus.status_code == 400


async def test_first_owner_is_created_once(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "first_owner_email", "Owner@Demo.TheBaker")
    monkeypatch.setattr(get_settings(), "first_owner_password", "owner-password-1")
    async with SessionLocal() as db:
        assert await ensure_first_owner(db) is True
    async with SessionLocal() as db:
        assert await ensure_first_owner(db) is False
    r = await client.post(
        f"{API}/login", json={"email": "owner@demo.thebaker", "password": "owner-password-1"}
    )
    assert r.json()["user"]["role"] == "owner"


async def test_guards_follow_permission_map(client):
    from fastapi import APIRouter, Depends

    from app.deps import require_module
    from app.main import app

    probe = APIRouter()

    @probe.get("/_probe/queue", dependencies=[Depends(require_module("orders_queue"))])
    async def queue():
        return {"ok": True}

    app.include_router(probe)
    token = (await register(client)).json()["access_token"]
    r = await client.get("/_probe/queue", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


async def test_healthz(client):
    assert (await client.get("/healthz")).json() == {"status": "ok"}
