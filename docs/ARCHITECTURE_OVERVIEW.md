# Platform Architecture Overview

A full-stack web application: an async Python API, a React single-page frontend, and PostgreSQL, containerized with Docker Compose. This document covers structure and patterns only.

## 1. System at a glance

```
┌──────────────────┐   REST + JWT    ┌───────────────────────┐      ┌────────────┐
│  Frontend (SPA)  │ ──────────────▶ │  Backend API          │ ───▶ │ PostgreSQL │
│  React + Vite    │                 │  FastAPI + SQLAlchemy │      └────────────┘
│  served by nginx │                 │  (async)              │
└──────────────────┘                 └───────────────────────┘
```

| Unit | Stack |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy 2 (async), Pydantic, Alembic |
| Frontend | React, TypeScript, Vite, Tailwind, React Router |
| Database | PostgreSQL |
| Packaging | Docker Compose (db, backend, frontend/nginx) |

---

## 2. Backend

### Directory structure

```
backend/
├── alembic/                  # DB migrations (git-tracked, linear history)
│   └── versions/
├── alembic.ini
├── app/
│   ├── main.py               # app setup, CORS, startup/shutdown, router registration
│   ├── database.py           # engine, session factory, Base, get_db dependency
│   ├── deps.py               # shared dependencies (current user, etc.)
│   ├── core/                 # cross-cutting: permissions, authz guards, security (JWT, hashing)
│   ├── models/               # SQLAlchemy ORM models, one module per entity
│   ├── schemas/              # Pydantic request/response models, mirrors models/
│   ├── crud/                 # data-access layer, one class per entity
│   ├── routers/              # HTTP endpoints, one router per module
│   ├── services/             # business logic, importers, background work
│   ├── tasks/                # background-job wrappers
│   └── data/                 # static reference data
├── scripts/                  # one-off ops: seeding, backfills, imports
├── tests/                    # pytest
├── Dockerfile
├── docker-entrypoint.sh
├── requirements.txt
└── .env.example
```

### Separation of concerns

```
HTTP request
   │
   ▼
routers/   →  validates input with schemas/, applies auth guards, returns a response model
   │
   ▼
crud/ or services/   →  crud: queries and persistence
   │                    services: multi-step business logic, imports, external calls
   ▼
models/    →  ORM tables and relationships
```

| Layer | Owns | Must not |
|---|---|---|
| **routers** | Routes, status codes, dependency wiring | Contain queries or business rules |
| **schemas** | Request/response shapes and validation | Be used as ORM objects |
| **crud** | Async queries, filters, pagination, eager loading | Raise HTTP concerns beyond simple lookups |
| **services** | Workflows spanning entities, file processing, integrations | Know about HTTP |
| **models** | Tables, constraints, relationships | Import routers or services |
| **core** | Permissions, auth guards, security helpers | Depend on feature modules |

One entity usually appears once per layer under the same name (`models/x.py`, `schemas/x.py`, `crud/x.py`, `routers/x.py`), so features are easy to find and to add.

### ORM and database

- SQLAlchemy 2.x declarative models, asyncpg for requests, and a separate sync engine for blocking batch jobs.
- A single `get_db` dependency yields one session per request.
- Conventions: integer primary keys, `created_at` / `updated_at` with server defaults, explicit `ondelete` on every foreign key, string-based relationships to avoid import cycles, and a models package that imports every model so mappers register.
- Connection pools are sized explicitly and checked against the database's `max_connections`.

```python
class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    parent_id = Column(ForeignKey("parents.id", ondelete="SET NULL"), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    parent = relationship("Parent", back_populates="items")
```

### Auth and access control

- JWT bearer auth with a current-user dependency that rejects disabled accounts. Passwords are hashed with bcrypt.
- Role-based access: one permissions config maps each module to the roles allowed to read and write it, and guard dependencies are generated from it.
- Guards are attached when routers are registered in `main.py`, so access control is visible in one place.
- Access is enforced on the server. The frontend mirrors it only to hide pages.

### Testing

Pytest with small, behavior-focused test files per feature.

---

## 3. Frontend

### Directory structure

```
frontend/
├── index.html
├── vite.config.ts
├── package.json
├── Dockerfile
├── nginx.conf
└── src/
    ├── main.tsx              # React root
    ├── App.tsx               # all routes and route guards
    ├── lib/                  # API client, auth context, session, permissions, shared types, helpers
    ├── hooks/                # reusable hooks
    ├── components/
    │   ├── auth/             # route guards, auth layout
    │   ├── layout/           # app shell, side nav, top bar
    │   ├── ui/               # generic primitives: modal, pagination, badges, breadcrumb
    │   ├── common/           # shared form widgets
    │   └── <feature>/        # components used by one feature
    └── pages/
        └── <feature>/        # route-level pages: list, detail, edit/form
```

### Separation of concerns

| Area | Responsibility |
|---|---|
| `pages/` | Route-level screens. They fetch data, hold local state and compose components. |
| `components/<feature>/` | Feature-specific pieces (modals, panels, forms) |
| `components/ui/` | Reusable, feature-agnostic building blocks |
| `components/auth/` | Route protection (logged-in, guest-only, role-gated) |
| `lib/` | Non-visual logic: API client, auth state, permissions, types, formatting |
| `hooks/` | Reusable stateful logic |

### Conventions

- **Feature folders** under `pages/` and `components/` with matching names. CRUD features follow one pattern: list page, detail page, edit page.
- **One API client:** typed `get/post/put/patch/delete`, base URL from the environment, token injected automatically, a structured error type, and a global 401 handler that clears the session and redirects to login.
- **Types mirror backend schemas** in one file.
- **No heavy state library:** local hooks, one auth context, and small cache modules.
- **Composable route guards** wrap pages in `App.tsx`.
- Tailwind for styling and Recharts for charts.

---

## 4. Best practices for large datasets

### Server-side pagination
- Every list endpoint is paginated on the server, with bounded `skip`/`limit` or `page`/`page_size`.
- Responses use a standard envelope (items, total, page, page size, total pages).
- The data query has a stable `ORDER BY`, plus a separate count query with the same filters. Search, filtering and sorting run in SQL, never in Python.
- The frontend keeps only the current page in state, debounces search and cancels stale requests.
- For very deep tables, use keyset (cursor) pagination.

### Indexing
- Every foreign key and frequent filter column is indexed, with composite indexes shaped to real query patterns (equality columns first, then range or sort).
- Substring search (`ILIKE '%x%'`) can't use a B-tree, so searchable text columns get **trigram GIN indexes**, created in a migration.
- Index changes ship as small, reviewable migrations. Redundant indexes are dropped because they slow writes.
- Verify with `EXPLAIN ANALYZE` on realistic data.

### Caching
- A **TTL + single-flight cache** on read-heavy aggregate endpoints, so concurrent identical requests share one query.
- The cache sits **below** the auth layer (an endpoint decorator, not middleware), so guards always run. It is opt-in per endpoint.
- In-process caches for reference data during batch work, and file caches for generated exports that are invalidated when data changes.
- The cache is per-process. Move it to Redis when scaling to multiple workers.

### Pre-aggregation
- Dashboards read from **rollup tables** instead of scanning the largest tables, with parity tests against the live queries.
- Heavy aggregates raise `work_mem` per transaction (`SET LOCAL`).

### Bulk writes and long jobs
- Chunked inserts instead of per-row commits, and lookup indexes built once per run.
- Slow work returns `202 Accepted` and runs in the background, and the UI polls for status.
- Uploads are staged and processed by a job, not parsed inside the request.

### Database hygiene
- Eager loading only where the response needs it, to avoid N+1 queries.
- Timezone-aware timestamps, with date handling centralized.
- Schema changes go through migrations only.

---

## 5. Repository strategy: one monorepo

Backend, frontend, Docker setup and docs live in **one git repository**. There is one `.git` at the root and no nested repos.

```
project/
├── docker-compose.yml      # the whole stack
├── .env.example            # compose-level settings
├── README.md               # one setup guide for everything
├── project-back/           # API, migrations, Dockerfile, entrypoint
├── project-front/          # SPA, Dockerfile, nginx.conf
└── docs/                   # product docs, plans, handovers
```

### Why a monorepo

1. **Atomic changes.** A feature that touches a schema, an endpoint and a page ships as one commit and one pull request. There are no "backend merged first, frontend later" gaps and no cross-repo version matrix.
2. **One source of truth for the contract.** Frontend types sit next to the backend schemas they mirror, so a breaking API change shows up in the same diff that fixes its consumer.
3. **Migrations travel with code.** Alembic revisions are committed beside the model changes that need them, so any commit is a self-consistent, deployable snapshot.
4. **One command to run everything.** The compose file at the root builds and starts the database, API and web app together, and a new teammate needs one clone and one `docker compose up`.
5. **One branch, one release.** Deploying means checking out one ref. Rollback means redeploying the previous commit, and backend and frontend can't drift out of sync.
6. **Simpler operations.** One repo means one set of access rules, one CI pipeline and one place to search, review and track history.
7. **Docs next to the code.** Product docs, plans and handover notes are versioned with the code and branch they describe.
8. **Less duplicated tooling.** Shared ignore rules, line-ending config and conventions are defined once at the root.

### Conventions that keep it clean

- **Clear top-level boundaries:** each app is a self-contained folder with its own dependencies, Dockerfile, `.dockerignore` and `.env.example`. The root holds only orchestration and docs.
- **Layered env files:** the root `.env` is for Compose (ports, frontend build args), and the backend's `.env` is for app and database secrets. All real `.env` files are git-ignored, and only documented `.env.example` files are committed.
- **Root `.gitignore` split by section** (backend, frontend, runtime data, credentials) so each stack's artifacts stay out of history.
- **Independent builds:** each service builds from its own folder context, so the backend image never contains frontend code and vice versa.
- **One default branch and consistent branch names** locally and on the remote. The branch that production runs is documented in the README.
- **Documented history:** if a repo grows from a single backend into the full stack, the README says so, and the superseded standalone repo is retired so there is no second source of truth.

### Trade-offs to be aware of

- The repo grows larger and CI should build only what changed (path filters per app).
- Access control is per-repo, so everyone with access sees both halves.
- Teams that need independent release cadences per app may later split along the same top-level folders, since the layout already makes that straightforward.

---

## 6. Migrations and version control

- **Alembic migrations are git-tracked** and ship in the same commit and pull request as the model change they belong to.
- The revision history is **linear**: each revision names its parent, so `alembic upgrade head` replays the same chain on every environment.
- Revisions are small and single-purpose. Autogenerate drafts them, a human reviews them, and DDL is idempotent where it matters (`IF NOT EXISTS`).
- Data backfills live in `scripts/`, separate from schema migrations.
- `.env` files are git-ignored, and only a documented `.env.example` is committed.
- Take a backup before any release that includes a migration.

---

## 7. Deployment (Docker Compose)

One compose file brings up the whole system with a single command.

```
repo/
├── docker-compose.yml
├── .env.example               # published ports and frontend build args
├── backend/   (Dockerfile, docker-entrypoint.sh, .env.example)
└── frontend/  (Dockerfile, nginx.conf)
```

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | Named volume, healthcheck, credentials read from the backend's env file |
| `backend` | `python:3.12-slim` | Starts only after the DB is healthy, own healthcheck, named volume for logs and ledgers |
| `frontend` | multi-stage Node build → `nginx:alpine` | Static bundle only |

- **Self-migrating entrypoint:** the container retries `alembic upgrade head` until the DB is ready, seeds the first admin from env vars, runs optional idempotent backfills (non-fatal), then starts the server. It is safe to rerun on every restart.
- **Frontend build:** the API URL is a **build argument**, because Vite bakes it in at build time and it must be reachable from the browser, not the Docker-internal service name.
- **nginx:** SPA fallback to `index.html`, no-cache on `index.html`, long immutable caching on hashed assets, and gzip.
- **Config:** secrets come from env files that are git-ignored and excluded from images (`.dockerignore`). Compose-level settings (ports, build args) are kept in a separate root `.env`. Env files are `required: true`, so a wrong path fails loudly instead of silently using default credentials.
- **Ports and proxying:** published ports are overridable and can bind to loopback behind a reverse proxy, with optional path-prefix hosting so several apps can share one proxy.
- **Single API worker** where in-memory caches are warmed in the background. Scaling out means moving the cache to Redis first.

```bash
cp .env.example .env && cp backend/.env.example backend/.env
docker compose up --build -d      # migrate, seed, serve
```

### Principles
1. One command to a working system, with migrations and the first admin handled at startup.
2. Config via environment, never in images or git.
3. Health-gated startup and a health endpoint.
4. Idempotent startup steps, non-fatal for anything optional.
5. Same image in every environment. Only env files and ports change.
6. Small attack surface: slim images, a static-only frontend container, and only the reverse proxy exposed.
7. Logs go to stdout, state lives in named volumes, and backups come before migrating releases.

---

## 8. Key design decisions

1. Monorepo: backend, frontend, compose and docs versioned together.
2. Strict layering (router → crud/service → model) with Pydantic schemas at the HTTP boundary.
3. One entity, one file per layer, under the same name, on both backend and frontend.
4. Authorization lives in one config and is attached declaratively. The frontend mirrors it for UX only.
5. Async for I/O, sync for batch compute, with the connection-pool math documented.
6. Server-side pagination, deliberate indexing and caching below auth for large datasets.
7. Migrations and tests are first-class and live in git.
8. Containerized, self-migrating, config-driven deployment.
