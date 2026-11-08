# The Baker

Online ordering for a fictional Cairo bakery: customers browse and order cakes and bakes for delivery or pickup, staff run the order queue, and the owner manages the catalog and settings.

**Stack:** FastAPI + SQLAlchemy (async) + PostgreSQL, React + TypeScript + Vite + Tailwind. Monorepo, Docker Compose locally, Railway (API + database) and Vercel (web) for the demo.

Design docs: [requirements](docs/REQUIREMENTS_DRAFT.md) · [system design](docs/DESIGN.md) · [architecture conventions](docs/ARCHITECTURE_OVERVIEW.md)

## Status

- **M0** scaffolding and authentication: done and deployed.
- **M1** catalog: done. Customers browse the menu (category, occasion, search, sort, pagination) and open product pages. The owner manages products, sizes and prices, photos (with required alt text), categories and occasions.
- **M2** schedule and delivery: done. Weekly opening hours, closed dates, fixed two-hour time slots with order limits, delivery zones with fees and minimum orders, and weekday rules per product. One rules engine answers "which dates and slots can this cart be booked for". Owners manage it all under **Manage shop**, staff can view it, and customers see opening hours, delivery fees and the earliest delivery or pickup date for each product.
- Next: **M3**, cart, checkout and cash-on-delivery orders (it reserves the capacity M2 reports). See [DESIGN.md §14](docs/DESIGN.md).

## Run everything with Docker

```bash
cp .env.example .env
cp backend/.env.example backend/.env     # then set JWT_SECRET (see the file)
docker compose up --build -d             # migrates, creates the first owner, serves
```

| Service | URL |
|---|---|
| Web | http://localhost:5173 |
| API docs | http://localhost:8000/docs |
| Postgres | localhost:5433 (user/password/db: `baker`) |

With `SEED_DEMO=true` in `backend/.env` (the example default), about 30 demo products plus default opening hours, two-hour slots and delivery zones are loaded on first start (each part only fills an empty table). Sign in as the owner (`FIRST_OWNER_EMAIL` / `FIRST_OWNER_PASSWORD`) and open **Manage shop** to edit them. Product photos are stored on a Docker volume locally.

Until email sending is added (M4), password-reset links are written to the backend log: `docker compose logs backend | grep reset-password`.

## Develop without rebuilding containers

```bash
docker compose up -d db

# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
python -m pytest            # uses a separate baker_test database
ruff check . && ruff format --check .

# frontend (second terminal)
cd frontend
npm ci
npm run dev                 # http://localhost:5173
npm run lint && npm test && npm run build
```

## Deploy (demo)

**Railway (backend + database)**
1. New project, add a **PostgreSQL** service.
2. Add a service from this repo with **Root Directory** `backend` (it picks up `backend/railway.json` and the Dockerfile).
3. Variables: `DATABASE_URL` (reference the Postgres service's `DATABASE_URL`), `ENV=production`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS` (both the Vercel URL), `FIRST_OWNER_EMAIL`, `FIRST_OWNER_PASSWORD`.
4. Photo storage (required in production, the app refuses to start without it): `STORAGE_BACKEND=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. See below.
5. Optional: `SEED_DEMO=true` loads the demo catalog on the first start when the catalog is empty.
6. Generate a public domain.

**Cloudflare R2 (product photos)**
1. Cloudflare dashboard, **R2 Object Storage**, create a bucket (for example `the-baker`).
2. Bucket **Settings, Public access**: enable the **r2.dev subdomain** (or connect a custom domain). Copy the public URL into `R2_PUBLIC_URL` (no trailing slash).
3. R2 overview, **Manage API tokens**, create a token with **Object Read & Write** limited to that bucket. Copy the Access Key ID and Secret Access Key. The Account ID is shown on the R2 overview page.

**Vercel (frontend)**
1. Import the repo with **Root Directory** `frontend` (Vite preset).
2. Environment variable `VITE_API_URL` = the Railway public URL (no trailing slash).
3. After the first deploy, put the Vercel URL into Railway's `FRONTEND_URL` and `CORS_ORIGINS`.

## Conventions

- Backend layers: `routers → crud/services → models`, one entity per layer under the same name.
- Schema changes only through Alembic migrations, committed with the model change.
- Money is stored as integer minor units. The server decides prices, never the client.
- Accessibility (WCAG 2.2 AA) is a requirement: lint rules, axe checks and contrast tests run in CI.
