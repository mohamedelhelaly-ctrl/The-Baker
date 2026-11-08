"""In-process background workers (single API worker, as in ARCHITECTURE_OVERVIEW §7).

Both jobs are safe to run concurrently (row locks with SKIP LOCKED), so scaling out later needs
no change beyond moving the shared cache.
"""

import asyncio
import contextlib
import logging

from app.core.clock import utcnow
from app.database import SessionLocal
from app.services.email import get_email_sender
from app.services.notifications import notifier, send_pending
from app.services.payments import get_payment_provider
from app.services.payments.service import expire_unpaid_orders

logger = logging.getLogger("baker.tasks")

EMAIL_TICK_SECONDS = 15
EXPIRY_TICK_SECONDS = 60


async def _email_loop() -> None:
    notifier.event = asyncio.Event()
    while True:
        try:
            async with SessionLocal() as db:
                await send_pending(db, get_email_sender(), utcnow())
        except Exception:
            logger.exception("Email worker iteration failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(notifier.event.wait(), timeout=EMAIL_TICK_SECONDS)
        notifier.event.clear()


async def _expiry_loop() -> None:
    while True:
        try:
            async with SessionLocal() as db:
                await expire_unpaid_orders(db, get_payment_provider(), utcnow())
        except Exception:
            logger.exception("Order expiry iteration failed")
        await asyncio.sleep(EXPIRY_TICK_SECONDS)


def start_background_tasks() -> list[asyncio.Task]:
    return [
        asyncio.create_task(_email_loop(), name="email-outbox"),
        asyncio.create_task(_expiry_loop(), name="order-expiry"),
    ]


async def stop_background_tasks(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
