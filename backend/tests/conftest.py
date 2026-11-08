import os

import psycopg
import pytest
from psycopg import sql
from sqlalchemy import create_engine, text

# Must be set before the app is imported.
TEST_DB = "baker_test"
BASE_URL = os.environ.get("TEST_DATABASE_BASE", "postgresql://baker:baker@localhost:5433")
os.environ["DATABASE_URL"] = f"{BASE_URL}/{TEST_DB}"
os.environ["ENV"] = "test"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["FRONTEND_URL"] = "http://frontend.test"

from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.email import get_email_sender  # noqa: E402


@pytest.fixture(scope="session")
def sync_engine():
    with psycopg.connect(f"{BASE_URL}/postgres", autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    eng = create_engine(get_settings().sync_database_url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def clean_db(sync_engine):
    yield
    with sync_engine.begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


class FakeEmailSender:
    def __init__(self):
        self.sent: list[dict] = []

    async def send(self, to: str, subject: str, text: str) -> None:
        self.sent.append({"to": to, "subject": subject, "text": text})


@pytest.fixture
def emails():
    fake = FakeEmailSender()
    app.dependency_overrides[get_email_sender] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_email_sender, None)


@pytest.fixture(autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()  # each test has its own event loop


@pytest.fixture
async def client(sync_engine):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
