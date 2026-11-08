"""Email sending behind an interface. Resend in production, the log in development and tests."""

import logging
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


class ResendEmailSender:
    URL = "https://api.resend.com/emails"

    def __init__(self, api_key: str, sender: str):
        self.api_key = api_key
        self.sender = sender

    async def send(self, to: str, subject: str, text: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    self.URL,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"from": self.sender, "to": [to], "subject": subject, "text": text},
                )
        except httpx.HTTPError as exc:
            raise EmailError(f"Could not reach Resend: {exc}") from exc
        if response.status_code >= 400:
            raise EmailError(f"Resend answered {response.status_code}: {response.text[:300]}")


@lru_cache
def _build_sender() -> EmailSender:
    s = get_settings()
    if s.resend_api_key:
        return ResendEmailSender(s.resend_api_key, s.email_from)
    return ConsoleEmailSender()


def get_email_sender() -> EmailSender:
    return _build_sender()


def email_provider_name() -> str:
    return "resend" if get_settings().resend_api_key else "log"
