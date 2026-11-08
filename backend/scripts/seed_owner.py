"""Create the first owner from env vars. Idempotent; run by docker-entrypoint.sh."""

import asyncio
import logging

from app.database import SessionLocal, engine
from app.services.bootstrap import ensure_first_owner


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    async with SessionLocal() as db:
        created = await ensure_first_owner(db)
    print("first owner created" if created else "first owner: nothing to do")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
