"""Load the demo catalog (run by docker-entrypoint.sh when SEED_DEMO=true). Idempotent."""

import asyncio
import logging

from app.database import SessionLocal, engine
from app.services.demo_seed import seed_demo_catalog


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    async with SessionLocal() as db:
        created = await seed_demo_catalog(db)
    print("demo catalog seeded" if created else "demo catalog: nothing to do")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
