import asyncio
import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.clock import utcnow
from app.database import SessionLocal
from app.models.notification import Notification, NotificationStatus
from app.services.email import EmailError, ResendEmailSender
from app.services.notifications import (
    MAX_ATTEMPTS,
    SAMPLE,
    TEMPLATES,
    TemplateRenderError,
    enqueue,
    render,
    validate_template,
)
from tests.test_admin_catalog import A
from tests.test_checkout import order_body, order_count, place, shop
from tests.test_schedule import MON, at


async def rows(**where):
    async with SessionLocal() as db:
        q = select(Notification).order_by(Notification.id)
        for k, v in where.items():
            q = q.where(getattr(Notification, k) == v)
        return list((await db.execute(q)).scalars())


async def cash_order(client, owner, **extra):
    z, p, slots = await shop(client, owner)
    with at(MON):
        r = await place(
            client, order_body(p["variants"][0]["id"], slots[0], zone_id=z["id"], **extra)
        )
    assert r.status_code == 201, r.text
    return r.json(), p


# ============================================================= order confirmation email
async def test_a_cash_order_queues_its_confirmation_in_the_same_transaction(client, owner, emails):
    o, _ = await cash_order(client, owner)
    queued = await rows(template_key="order_confirmed")
    assert len(queued) == 1 and queued[0].status == NotificationStatus.pending
    assert queued[0].to_email == "sara@example.com" and queued[0].order_id is not None
    assert await emails.flush() == 1
    sent = emails.sent[0]
    assert sent["subject"] == f"We received your order {o['code']}"
    for expected in (
        "Hi Sara Ali",
        o["code"],
        "1 × Chocolate Cake (6-inch)",
        "650.00 EGP",
        "Total: 690.00 EGP",
        "Delivery: Tuesday 10 November 2026, 10:00 AM to 12:00 PM",
        "12 Road 9, building 5, floor 3, apartment 7, Maadi",
        "Payment: Cash on delivery or pickup",
        f"http://frontend.test/track/{o['code']}?t={o['tracking_token']}",
    ):
        assert expected in sent["text"], expected
    done = (await rows())[0]
    assert (
        done.status == NotificationStatus.sent and done.sent_at is not None and done.attempts == 1
    )


async def test_the_cake_message_and_pickup_details_appear_in_the_email(client, owner, emails):
    z, p, slots = await shop(client, owner)
    from tests.test_checkout import order_body as body

    with at(MON):
        r = await place(
            client,
            body(
                p["variants"][0]["id"],
                slots[0],
                fulfilment="pickup",
                items=[
                    {
                        "variant_id": p["variants"][0]["id"],
                        "quantity": 1,
                        "inscription": "Happy Birthday Sara",
                    }
                ],
            ),
        )
    assert r.status_code == 201
    await emails.flush()
    text = emails.sent[0]["text"]
    assert (
        "Message: Happy Birthday Sara" in text
        and "Pickup:" in text
        and "Collect from the bakery" in text
    )


async def test_a_mail_outage_never_loses_or_blocks_an_order(client, owner, emails):
    emails.fail = True
    o, _ = await cash_order(client, owner)
    assert await order_count() == 1  # the order exists even though mail is down
    assert await emails.flush() == 0
    (n,) = await rows()
    assert (
        n.status == NotificationStatus.pending
        and n.attempts == 1
        and "mail server down" in n.last_error
    )
    emails.fail = False
    assert await emails.flush() == 0  # backing off: not due yet
    assert await emails.flush(now=utcnow() + timedelta(minutes=10)) == 1  # due later: delivered
    assert (await rows())[0].status == NotificationStatus.sent


async def test_failed_emails_back_off_then_stay_visible_and_can_be_retried(client, owner, emails):
    emails.fail = True
    await cash_order(client, owner)
    now = utcnow()
    waits = []
    for _ in range(MAX_ATTEMPTS):
        now += timedelta(hours=1)
        await emails.flush(now=now)
        (n,) = await rows()
        waits.append(n.attempts)
    (n,) = await rows()
    assert waits == [1, 2, 3, 4, 5] and n.status == NotificationStatus.failed
    assert await emails.flush(now=now + timedelta(days=1)) == 0  # gives up
    listed = (
        await client.get(f"{A}/notifications", params={"status": "failed"}, headers=owner)
    ).json()
    assert (
        listed["total"] == 1
        and listed["items"][0]["last_error"]
        and listed["items"][0]["order_code"].startswith("BK-")
    )
    emails.fail = False
    retried = await client.post(f"{A}/notifications/{n.id}/retry", headers=owner)
    assert retried.status_code == 200 and retried.json()["status"] == "pending"
    assert await emails.flush(now=now + timedelta(days=1)) == 1
    assert (
        await client.post(f"{A}/notifications/{n.id}/retry", headers=owner)
    ).status_code == 409  # already sent
    assert (await client.post(f"{A}/notifications/9999/retry", headers=owner)).status_code == 404


async def test_the_worker_sends_in_batches(client, emails):
    async with SessionLocal() as db:
        for i in range(25):
            await enqueue(
                db, key="password_reset", to_email=f"u{i}@example.com", context={**SAMPLE}
            )
        await db.commit()
    assert await emails.flush() == 20
    assert await emails.flush() == 5


async def test_the_background_worker_sends_as_soon_as_it_is_woken(
    client, owner, emails, monkeypatch
):
    import app.tasks.runner as runner
    from app.services.notifications import notifier

    monkeypatch.setattr(runner, "get_email_sender", lambda: emails)
    tasks = runner.start_background_tasks()
    try:
        await asyncio.sleep(0.2)  # first idle pass
        async with SessionLocal() as db:
            await enqueue(db, key="password_reset", to_email="w@example.com", context={**SAMPLE})
            await db.commit()
        notifier.wake()
        for _ in range(50):
            if emails.sent:
                break
            await asyncio.sleep(0.1)
    finally:
        await runner.stop_background_tasks(tasks)
        notifier.event = None
    assert [m["to"] for m in emails.sent] == ["w@example.com"]


# ===================================================================== wording and safety
def test_every_template_renders_with_sample_data_and_uses_only_its_variables():
    for key, tpl in TEMPLATES.items():
        context = {v: SAMPLE[v] for v in tpl.variables}
        assert render(tpl.subject, context) and render(tpl.body, context)
        validate_template(key, tpl.subject, tpl.body)


@pytest.mark.parametrize(
    "bad",
    [
        "{{ not_a_variable }}",
        "{{ order_code",
        "{% for %}",
        "{{ ''.__class__.__mro__ }}",
        "{{ order_code.__class__.__init__.__globals__ }}",
        "{{ cycler.__init__.__globals__ }}",
        "{% include 'x' %}",
    ],
)
def test_unsafe_or_broken_wording_is_refused(bad):
    with pytest.raises(TemplateRenderError):
        validate_template("order_confirmed", bad, "ok")
    with pytest.raises(TemplateRenderError):
        validate_template("order_confirmed", "ok", bad)


def test_a_template_cannot_use_variables_that_belong_to_another_email():
    with pytest.raises(TemplateRenderError):
        validate_template(
            "order_confirmed", "{{ reason }}", "x"
        )  # `reason` only exists for rejected/cancelled
    validate_template("order_cancelled", "{{ reason }}", "x")


# =================================================================== owner edits wording
async def test_templates_are_listed_with_their_variables(client, owner):
    items = (await client.get(f"{A}/notification-templates", headers=owner)).json()
    assert [t["key"] for t in items] == list(TEMPLATES)
    confirmed = next(t for t in items if t["key"] == "order_confirmed")
    assert (
        "order_code" in confirmed["variables"]
        and confirmed["is_customised"] is False
        and confirmed["is_active"] is True
    )


async def test_editing_wording_changes_the_next_email_and_reset_restores_it(client, owner, emails):
    ok = await client.patch(
        f"{A}/notification-templates/order_confirmed",
        headers=owner,
        json={
            "subject": "Thanks {{ customer_name }}! #{{ order_code }}",
            "body": "Your {{ order_total }} order is in. {{ tracking_url }}",
        },
    )
    assert ok.status_code == 200 and ok.json()["is_customised"] is True
    o, _ = await cash_order(client, owner)
    await emails.flush()
    assert emails.sent[0]["subject"] == f"Thanks Sara Ali! #{o['code']}"
    assert emails.sent[0]["text"].startswith(
        "Your 690.00 EGP order is in. http://frontend.test/track/"
    )
    back = await client.post(f"{A}/notification-templates/order_confirmed/reset", headers=owner)
    assert (
        back.json()["is_customised"] is False
        and back.json()["subject"] == TEMPLATES["order_confirmed"].subject
    )


async def test_invalid_wording_is_refused_with_a_clear_message_and_nothing_is_saved(client, owner):
    for subject, body in (
        ("{{ typo }}", "x"),
        ("ok", "{{ order_code"),
        ("ok", "{{ ''.__class__ }}"),
    ):
        r = await client.patch(
            f"{A}/notification-templates/order_confirmed",
            headers=owner,
            json={"subject": subject, "body": body},
        )
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_template"
    assert (
        await client.patch(
            f"{A}/notification-templates/order_confirmed", headers=owner, json={"subject": ""}
        )
    ).status_code == 422
    assert (
        await client.patch(
            f"{A}/notification-templates/order_confirmed", headers=owner, json={"body": None}
        )
    ).status_code == 422
    assert (
        await client.patch(f"{A}/notification-templates/nope", headers=owner, json={"subject": "x"})
    ).status_code == 404
    listed = (await client.get(f"{A}/notification-templates", headers=owner)).json()
    assert not any(t["is_customised"] for t in listed)


async def test_preview_renders_with_sample_data_and_reports_errors(client, owner):
    r = await client.post(
        f"{A}/notification-templates/order_rejected/preview",
        headers=owner,
        json={
            "subject": "About {{ order_code }}",
            "body": "Sorry {{ customer_name }}: {{ reason }}",
        },
    )
    assert r.status_code == 200 and r.json() == {
        "subject": "About BK-7F3K2Q",
        "body": "Sorry Sara Ali: We are fully booked that day.",
    }
    bad = await client.post(
        f"{A}/notification-templates/order_rejected/preview",
        headers=owner,
        json={"subject": "{{ x }}", "body": "b"},
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_template"
    assert (
        await client.post(
            f"{A}/notification-templates/nope/preview",
            headers=owner,
            json={"subject": "a", "body": "b"},
        )
    ).status_code == 404


async def test_switching_a_template_off_stops_that_email(client, owner, emails):
    await client.patch(
        f"{A}/notification-templates/order_confirmed", headers=owner, json={"is_active": False}
    )
    await cash_order(client, owner)
    assert await rows() == [] and await emails.flush() == 0


async def test_only_the_owner_manages_emails(client, make_headers):
    for role in ("staff", "customer"):
        h = await make_headers(role)
        assert (await client.get(f"{A}/notification-templates", headers=h)).status_code == 403
        assert (
            await client.patch(
                f"{A}/notification-templates/order_confirmed", headers=h, json={"is_active": False}
            )
        ).status_code == 403
        assert (await client.get(f"{A}/notifications", headers=h)).status_code == 403
        assert (await client.post(f"{A}/email-test", headers=h)).status_code == 403
    assert (await client.get(f"{A}/notification-templates")).status_code == 401


async def test_email_log_lists_newest_first(client, owner, emails):
    async with SessionLocal() as db:
        for i in range(5):
            await enqueue(
                db, key="password_reset", to_email=f"u{i}@example.com", context={**SAMPLE}
            )
        await db.commit()
    page = (await client.get(f"{A}/notifications", params={"page_size": 2}, headers=owner)).json()
    assert (
        page["total"] == 5
        and page["total_pages"] == 3
        and [n["to_email"] for n in page["items"]] == ["u4@example.com", "u3@example.com"]
    )
    assert (
        await client.get(f"{A}/notifications", params={"status": "sent"}, headers=owner)
    ).json()["total"] == 0
    assert (
        await client.get(f"{A}/notifications", params={"status": "bogus"}, headers=owner)
    ).status_code == 422


async def test_the_test_email_button_reports_success_and_failure(
    client, owner, monkeypatch, emails
):
    import app.routers.admin_settings as settings_router

    monkeypatch.setattr(settings_router, "get_email_sender", lambda: emails)
    ok = (await client.post(f"{A}/email-test", headers=owner)).json()
    assert ok["sent"] is True and ok["to"].startswith("owner") and emails.sent[0]["to"] == ok["to"]
    emails.fail = True
    bad = (await client.post(f"{A}/email-test", headers=owner)).json()
    assert bad["sent"] is False and "mail server down" in bad["error"]


# ===================================================================== Resend integration
_REAL_CLIENT = httpx.AsyncClient


def _patch_resend(monkeypatch, handler):
    real = _REAL_CLIENT
    monkeypatch.setattr(
        "app.services.email.httpx.AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )


async def test_resend_request_is_built_correctly(monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["auth"], seen["body"] = (
            str(request.url),
            request.headers["authorization"],
            json.loads(request.content),
        )
        return httpx.Response(200, json={"id": "em_1"})

    _patch_resend(monkeypatch, handler)
    await ResendEmailSender("re_test_key", "The Baker <orders@thebaker.test>").send(
        "sara@example.com", "Hello", "Body text"
    )
    assert seen == {
        "url": "https://api.resend.com/emails",
        "auth": "Bearer re_test_key",
        "body": {
            "from": "The Baker <orders@thebaker.test>",
            "to": ["sara@example.com"],
            "subject": "Hello",
            "text": "Body text",
        },
    }


async def test_resend_errors_become_email_errors(monkeypatch):
    _patch_resend(
        monkeypatch, lambda r: httpx.Response(403, json={"message": "domain not verified"})
    )
    with pytest.raises(EmailError, match="403.*domain not verified"):
        await ResendEmailSender("k", "a@b.c").send("x@y.z", "s", "t")

    def boom(request):
        raise httpx.ConnectError("no route")

    _patch_resend(monkeypatch, boom)
    with pytest.raises(EmailError, match="Could not reach Resend"):
        await ResendEmailSender("k", "a@b.c").send("x@y.z", "s", "t")


async def test_the_provider_in_use_follows_configuration(monkeypatch):
    from app.config import get_settings
    from app.services import email

    assert email.email_provider_name() == "log"
    monkeypatch.setattr(get_settings(), "resend_api_key", "re_x")
    assert email.email_provider_name() == "resend"
