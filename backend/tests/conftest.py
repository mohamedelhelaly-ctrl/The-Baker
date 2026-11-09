import os
import tempfile

import psycopg
import pytest
from psycopg import sql
from sqlalchemy import create_engine, text

# Must be set before the app is imported.
TEST_DB = "baker_test"
BASE_URL = os.environ.get("TEST_DATABASE_BASE", "postgresql://baker:baker@localhost:5433")
os.environ["DATABASE_URL"] = f"{BASE_URL}/{TEST_DB}"
os.environ["ENV"] = "test"
os.environ["ACCESS_TOKEN_MINUTES"] = "5000000"  # tests move the clock; tokens must not expire
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["BACKGROUND_TASKS_ENABLED"] = "false"  # tests call the workers directly
# Never inherit payment or email setup from a developer's backend/.env: tests start from "nothing configured".
os.environ["PAYMENT_PROVIDER"] = "none"
for _name in (
    "PAYMOB_SECRET_KEY",
    "PAYMOB_PUBLIC_KEY",
    "PAYMOB_HMAC_SECRET",
    "PAYMOB_INTEGRATION_ID",
):
    os.environ.pop(_name, None)  # unset, so they are None
os.environ["BREVO_API_KEY"] = ""
os.environ["FRONTEND_URL"] = "http://frontend.test"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="baker-uploads-")
os.environ["PUBLIC_API_URL"] = "http://api.test"

from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def sync_engine():
    with psycopg.connect(f"{BASE_URL}/postgres", autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    eng = create_engine(get_settings().sync_database_url)
    with eng.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
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
    """Collects what would be sent. `flush()` runs the outbox worker once, like the real worker would."""

    def __init__(self, fail: bool = False):
        self.sent: list[dict] = []
        self.fail = fail

    async def send(self, to: str, subject: str, text: str) -> None:
        if self.fail:
            raise RuntimeError("mail server down")
        self.sent.append({"to": to, "subject": subject, "text": text})

    async def flush(self, now=None) -> int:
        from datetime import timedelta

        from app.core.clock import utcnow
        from app.database import SessionLocal
        from app.services.notifications import send_pending

        # A small margin: the database stamps rows with its own clock.
        async with SessionLocal() as db:
            return await send_pending(db, self, now or utcnow() + timedelta(minutes=1))


@pytest.fixture
def emails():
    yield FakeEmailSender()


@pytest.fixture(autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()  # each test has its own event loop


@pytest.fixture
async def client(sync_engine):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _token_valid_at_any_frozen_time(user_id: int) -> str:
    """Tests freeze the clock at fixed dates (time_machine). A token stamped with the real clock would
    look 'issued in the future' whenever the frozen time is earlier, so these span 2000 to 2100."""
    import jwt

    from app.config import get_settings

    s = get_settings()
    payload = {"sub": str(user_id), "iat": 946_684_800, "exp": 4_102_444_800}
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


@pytest.fixture
async def make_headers(client):
    """Return auth headers for a new user of the given role."""
    from app.core.security import hash_password
    from app.crud.user import user_crud
    from app.database import SessionLocal
    from app.models.user import UserRole

    counter = iter(range(1, 1000))

    async def make(role: str = "customer") -> dict[str, str]:
        async with SessionLocal() as db:
            user = await user_crud.create(
                db,
                email=f"{role}{next(counter)}@example.com",
                password_hash=await hash_password("password-1234"),
                full_name=role.title(),
                role=UserRole(role),
            )
        return {"Authorization": f"Bearer {_token_valid_at_any_frozen_time(user.id)}"}

    return make


@pytest.fixture
async def owner(make_headers):
    return await make_headers("owner")
