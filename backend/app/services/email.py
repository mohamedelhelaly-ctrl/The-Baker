"""Email sending behind an interface. Brevo in production, the log in development and tests."""

import logging
from email.utils import parseaddr
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings

logger = logging.getLogger("baker.email")


class EmailError(Exception):
    pass


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class ConsoleEmailSender:
    """Logs the email instead of sending it (local development and tests)."""

    async def send(self, to: str, subject: str, text: str) -> None:
        logger.info("EMAIL to=%s subject=%r\n%s", to, subject, text)


class BrevoEmailSender:
    """Brevo's transactional API (HTTPS, so it works on hosts that block SMTP). The sender address
    must be verified in Brevo (Senders, Domains and Dedicated IPs), a single address is enough."""

    URL = "https://api.brevo.com/v3/smtp/email"

    def __init__(self, api_key: str, sender: str):
        self.api_key = api_key
        name, address = parseaddr(sender)
        self.sender = {"email": address, **({"name": name} if name else {})}

    async def send(self, to: str, subject: str, text: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    self.URL,
                    headers={"api-key": self.api_key, "accept": "application/json"},
                    json={
                        "sender": self.sender,
                        "to": [{"email": to}],
                        "subject": subject,
                        "textContent": text,
                    },
                )
        except httpx.HTTPError as exc:
            raise EmailError(f"Could not reach Brevo: {exc}") from exc
        if response.status_code >= 400:
            raise EmailError(f"Brevo answered {response.status_code}: {response.text[:300]}")


@lru_cache
def _build_sender() -> EmailSender:
    s = get_settings()
    if s.brevo_api_key:
        return BrevoEmailSender(s.brevo_api_key, s.email_from)
    return ConsoleEmailSender()


def get_email_sender() -> EmailSender:
    return _build_sender()


def email_provider_name() -> str:
    return "brevo" if get_settings().brevo_api_key else "log"
