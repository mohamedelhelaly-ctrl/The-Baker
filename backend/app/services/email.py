"""Email sending behind an interface. M0 ships the console sender; Resend arrives with M4."""

import logging
from typing import Protocol

logger = logging.getLogger("baker.email")


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class ConsoleEmailSender:
    """Logs the email instead of sending it (local development and the first deploy)."""

    async def send(self, to: str, subject: str, text: str) -> None:
        logger.info("EMAIL to=%s subject=%r\n%s", to, subject, text)


_sender: EmailSender = ConsoleEmailSender()


def get_email_sender() -> EmailSender:
    return _sender
