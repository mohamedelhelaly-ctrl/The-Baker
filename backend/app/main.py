import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

import app.models  # noqa: F401  (register mappers)
from app.config import get_settings
from app.core.errors import register_error_handlers
from app.core.rate_limit import limiter
from app.database import engine
from app.deps import require_module
from app.routers import (
    admin_catalog,
    admin_schedule,
    admin_settings,
    auth,
    availability,
    catalog,
    checkout,
    payments,
    staff_orders,
)
from app.tasks.runner import start_background_tasks, stop_background_tasks

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
settings = get_settings()
API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.getLogger("baker").info(
        "env=%s cors_origins=%s cors_origin_regex=%s",
        settings.env,
        settings.cors_origin_list,
        settings.cors_origin_regex,
    )
    tasks = start_background_tasks() if settings.background_tasks_enabled else []
    try:
        yield
    finally:
        await stop_background_tasks(tasks)
        await engine.dispose()


app = FastAPI(title="The Baker API", version="0.1.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],  # Bearer tokens travel in a header, so no cookies are needed
)
register_error_handlers(app)

# Router registration is the one place where access control is visible (DESIGN.md §3).
app.include_router(auth.router, prefix=API_PREFIX)  # public
app.include_router(catalog.router, prefix=API_PREFIX)  # public read-only menu
app.include_router(
    checkout.router, prefix=API_PREFIX
)  # guests may order; reads need ownership or a token
app.include_router(payments.router, prefix=API_PREFIX)  # provider callbacks (signature-verified)
app.include_router(availability.router, prefix=API_PREFIX)  # public: zones and bookable dates/slots
app.include_router(  # owner only; write endpoints add their own write guard
    admin_catalog.router, prefix=API_PREFIX, dependencies=[Depends(require_module("catalog_admin"))]
)

app.include_router(  # staff may read, owner may write; writes add their own guard
    admin_schedule.router,
    prefix=API_PREFIX,
    dependencies=[Depends(require_module("schedule_admin"))],
)

app.include_router(  # owner only: payment switches, email wording, email log
    admin_settings.router, prefix=API_PREFIX, dependencies=[Depends(require_module("settings"))]
)

app.include_router(  # staff and owner: the order queue
    staff_orders.router, prefix=API_PREFIX, dependencies=[Depends(require_module("orders_queue"))]
)

if settings.storage_backend == "local":  # dev/tests only; production serves photos from R2
    os.makedirs(settings.upload_dir, exist_ok=True)
    app.mount("/media", StaticFiles(directory=settings.upload_dir), name="media")


@app.get("/healthz", tags=["ops"])
async def healthz():
    return {"status": "ok"}
