# The Baker

Online ordering for a fictional Cairo bakery: customers browse and order cakes and bakes for delivery or pickup, staff run the order queue, and the owner manages the catalog and settings.

**Stack:** FastAPI + SQLAlchemy (async) + PostgreSQL, React + TypeScript + Vite + Tailwind. Monorepo, Docker Compose locally, Railway (API + database) and Vercel (web) for the demo.

Design docs: [requirements](docs/REQUIREMENTS_DRAFT.md) · [system design](docs/DESIGN.md) · [architecture conventions](docs/ARCHITECTURE_OVERVIEW.md)

## Status

Milestone **M0** (scaffolding and authentication) is built: register, sign in, password reset, role-based guards, accessibility tooling. Next: M1, the catalog. See [DESIGN.md §14](docs/DESIGN.md).

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
4. Generate a public domain.

**Vercel (frontend)**
1. Import the repo with **Root Directory** `frontend` (Vite preset).
2. Environment variable `VITE_API_URL` = the Railway public URL (no trailing slash).
3. After the first deploy, put the Vercel URL into Railway's `FRONTEND_URL` and `CORS_ORIGINS`.

## Conventions

- Backend layers: `routers → crud/services → models`, one entity per layer under the same name.
- Schema changes only through Alembic migrations, committed with the model change.
- Money is stored as integer minor units. The server decides prices, never the client.
- Accessibility (WCAG 2.2 AA) is a requirement: lint rules, axe checks and contrast tests run in CI.
