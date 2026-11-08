"""All 'now' logic goes through here so tests can freeze time."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

STORE_TZ = ZoneInfo("Africa/Cairo")


def utcnow() -> datetime:
    return datetime.now(UTC)


def store_now() -> datetime:
    return utcnow().astimezone(STORE_TZ)
