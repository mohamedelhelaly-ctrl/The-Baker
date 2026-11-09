# The Baker

Online ordering for a fictional Cairo bakery. Customers browse and order cakes and bakes for delivery or pickup and pay by card or cash, staff run the order queue, and the owner manages the menu, schedule, policies, team and shop details.

**Live demo:** <https://the-baker-seven.vercel.app> (test-mode payments only, no real orders or money)

**Stack:** FastAPI + SQLAlchemy (async) + PostgreSQL, React + TypeScript + Vite + Tailwind. Monorepo, Docker Compose locally, Railway (API + database) and Vercel (web) for the demo, Cloudflare R2 for photos, Paymob for card payments, Brevo for email.

Design docs: [requirements](docs/REQUIREMENTS_DRAFT.md) · [system design](docs/DESIGN.md) · [accessibility audit](docs/ACCESSIBILITY.md) · [architecture conventions](docs/ARCHITECTURE_OVERVIEW.md)

## What it does

**Customers**
- Browse the menu (category, occasion, search, sort), open a product, choose a size and write a message for the cake.
- Check out as a guest or with an account: delivery or pickup, a date and a two-hour time slot, then pay by card or cash. The server prices everything and reserves capacity, so the last cake or slot can never be sold twice and a double click never places two orders.
- Track the order from a private link (or from **My orders**), change its date, time, address or notes, or cancel it while the bakery's window is open. Cancelling a card order is refunded by the owner's policy.
- Keep a profile, saved addresses and a cart that follows the account.

**Staff**
- A live order queue with filters and search: accept or decline (with a reason), move an order through preparing, ready and delivered or collected, mark it late, cancel it, and email the customer. Declining or cancelling a paid card order refunds it and frees the slot.
- A printable **prep sheet**: what to bake for a day, with the messages to write on cakes.

**Owner**
- Menu: products, sizes and prices, photos (alt text required), categories, occasions, availability rules and daily capacity.
- Schedule: opening hours, closed dates, time slots with order limits, delivery zones with fees and minimum orders.
- Policies: how long customers can change or cancel, and what a card cancellation refunds (full, a percentage, none).
- Payments and emails: switch card and cash on or off, edit the wording of every email with a live preview, read the email log and retry failures.
- Shop details (contact, pickup place) and the **team** (add, change and remove staff and owner accounts).

**Accessibility** (WCAG 2.2 AA) is a requirement, not an extra: skip link, visible focus, labelled fields with linked errors, live announcements, text size, high contrast and reduced motion switches. Lint, axe and contrast tests run in CI. See the [audit](docs/ACCESSIBILITY.md), including what still needs a person to test.

## Try it

Sign in at the demo with these accounts (the password is given with the project; it is never stored in the repository):

| Role | Email |
|---|---|
| Owner | the `FIRST_OWNER_EMAIL` account |
| Staff | `staff@demo.thebaker` |
| Customer | `customer@demo.thebaker` |

Or just browse and order as a guest. For a card payment use Paymob's test card: Visa `4111 1111 1111 1111`, expiry `01/39`, CVV `123`, name `Test Account`.

## Status

All milestones are built and tested (see [DESIGN.md §14](docs/DESIGN.md)): M0 scaffolding and sign-in, M1 catalog, M2 schedule and delivery, M3 cart, checkout and cash orders, M4 card payments and emails, M5 staff order queue, M6 change, cancel and account, M7 team, shop details, accessibility audit and demo data. A visual design pass is the remaining step.

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

With `SEED_DEMO=true` in `backend/.env` (the example default), about 30 demo products plus default opening hours, two-hour slots and delivery zones are loaded on first start (each part only fills an empty table). Add `DEMO_PASSWORD` to also create the demo customer and staff accounts. Sign in as the owner (`FIRST_OWNER_EMAIL` / `FIRST_OWNER_PASSWORD`) and open **Manage shop** to edit everything. Product photos are stored on a Docker volume locally.

Without a Brevo key (see below) emails, including password-reset links, are written to the backend log instead of being sent: `docker compose logs backend | grep reset-password`.

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

CI (`.github/workflows/ci.yml`) runs the same checks on every push: lint, format, migrations (up, down, up, and a check that they match the models), the backend tests against a real Postgres, and the frontend lint, tests and build.

## Configuration

All settings are environment variables. Secrets live only there, never in the repository or the database. `backend/.env.example` documents each one.

| Variable | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection (Railway provides it) |
| `ENV` | production | `production` turns on the safety checks (no practice payments, photo storage required) |
| `JWT_SECRET` | yes | Signs sign-in tokens and guest tracking links. Changing it signs everyone out and breaks old tracking links |
| `FRONTEND_URL`, `CORS_ORIGINS` | yes | The Vercel address (links in emails, allowed browser origin) |
| `FIRST_OWNER_EMAIL`, `FIRST_OWNER_PASSWORD`, `FIRST_OWNER_NAME` | first start | Creates the first owner if none exists |
| `PUBLIC_API_URL` | card payments | The backend's public address, so Paymob can call back |
| `PAYMENT_PROVIDER` | no | `paymob`, `fake` (practice page, refused in production) or `none` (cash only) |
| `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID` | with Paymob | From the Paymob dashboard |
| `BREVO_API_KEY`, `EMAIL_FROM` | for real emails | Without a key, emails go to the log |
| `STORAGE_BACKEND`, `R2_*` | production | `r2` plus the five Cloudflare R2 values; `local` for development |
| `SEED_DEMO`, `DEMO_PASSWORD` | demo only | Load the demo catalog, and create the demo customer and staff accounts |
| `VITE_API_URL` | frontend | The backend address, set on Vercel |

## Deploy (demo)

**Railway (backend + database)**
1. New project, add a **PostgreSQL** service.
2. Add a service from this repo with **Root Directory** `backend` (it picks up `backend/railway.json` and the Dockerfile).
3. Variables: `DATABASE_URL` (reference the Postgres service's `DATABASE_URL`), `ENV=production`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS` (both the Vercel URL), `FIRST_OWNER_EMAIL`, `FIRST_OWNER_PASSWORD`.
4. Photo storage (required in production, the app refuses to start without it): `STORAGE_BACKEND=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. See below.
5. Optional demo data: `SEED_DEMO=true` loads the demo catalog on the first start when the catalog is empty. Add `DEMO_PASSWORD` to also create the demo customer and staff accounts (give reviewers that password; never reuse a real one).
6. Generate a public domain, then set `PUBLIC_API_URL` to it. Migrations run on every start (`docker-entrypoint.sh`), so deploying a new version updates the database too.
7. Check it: `https://<your-railway-domain>/healthz` answers `{"status":"ok"}`.

**Paymob (card payments in EGP, test mode)**

Paymob is an Egyptian payment provider. Building and testing is free. Taking real money needs Paymob's business verification (see "Going live" below).

1. **Create an account** at Paymob (<https://accept.paymob.com>, Egypt). Their checklist says account creation gives you the dashboard and the test environment. Whether test mode needs business documents is not stated in their docs, so if you are blocked, ask support@paymob.com for test access.
2. **Switch the dashboard to Test mode** with the toggle at the top right. Keys and integrations differ between Test and Live, so stay in Test.
3. **Copy the keys.** Settings, then Developers, **API Keys**: copy the **Secret key** (`egy_sk_test_...`), the **Public key** (`egy_pk_test_...`) and the **HMAC secret**. Only the main account user can see the HMAC secret; if it is hidden, ask support.
4. **Copy the Integration ID.** Settings, **Payment Integrations**, with Test selected: copy the ID of an online **card** integration (the "Integration ID" column). If the list is empty, ask your Paymob account manager or support to create a test card integration.
5. **Set the Webhook URL.** Click that integration, paste `https://<your-railway-domain>/api/v1/payments/paymob/webhook` into **Webhook URL**, and press **Save Changes**. (The app also sends this address with every payment, but setting it here is the safe belt-and-braces option; duplicate calls are harmless.)
6. **Railway variables** (backend service). `PUBLIC_API_URL` must be your backend's public address with no trailing slash:
   - `PAYMENT_PROVIDER=paymob`
   - `PAYMOB_SECRET_KEY` (the `egy_sk_test_...` value)
   - `PAYMOB_PUBLIC_KEY` (the `egy_pk_test_...` value)
   - `PAYMOB_HMAC_SECRET`
   - `PAYMOB_INTEGRATION_ID` (a number, no quotes)
   - `PUBLIC_API_URL=https://<your-railway-domain>`

   The app refuses to start if `PAYMENT_PROVIDER=paymob` is set without all four `PAYMOB_` values.
7. **Check it is connected.** As the owner, open **Manage shop, Payments and emails**. It should say **Paymob (test mode)** and **Available to customers**, and it shows the callback address to paste in step 5.
8. **Make a test payment** on the live site: add a product, check out, choose **Pay online by card**, and pay with a test card (cardholder `Test Account`, expiry `01/39`, CVV `123`): Visa `4111 1111 1111 1111` or Mastercard `5123 4567 8901 2346`. Test wallet: number `01010101010`, MPin and OTP `123456`. You return to the order page, which turns to **Received** within a few seconds.
9. **If the order stays on "Waiting for payment"** after a successful test payment, look at the Railway logs:
   - no line mentioning `/payments/paymob/webhook`: Paymob is not reaching us. Re-check step 5 (saved? right integration? Test mode?) and `PUBLIC_API_URL`.
   - a warning `Paymob callback signature mismatch ... Signed string: ...`: the HMAC secret is wrong or from the other mode, or Paymob signs a slightly different field list than documented. Re-copy the secret from Test mode; if it still fails, the logged signed string (it contains no secrets) shows exactly what was computed.
10. **Going live.** Paymob's checklist: account creation, paperwork validation, contract, risk approval, test and validation, technical approval, then live credentials. Afterwards switch the dashboard to Live, copy the **live** keys, HMAC secret and a **live** integration ID, and update the same Railway variables.

Behaviour worth knowing: a declined card attempt does not cancel the order (the customer can retry on the same page); an unpaid order is cancelled after 35 minutes and its slot freed; Paymob cannot close a payment page, so a payment that still arrives after cancellation is refunded automatically; same-day full refunds fall back to a void. For local development use `PAYMENT_PROVIDER=fake` (a practice page). `PAYMENT_PROVIDER=fake` is refused in production.

**Brevo (emails, free, no domain needed, about 300 a day)**

Without a key, emails are only written to the server log.
1. Create a free Brevo account. Under **SMTP & API, API Keys**, create an **API key**.
2. Under **Senders, Domains & Dedicated IPs, Senders**, add the address you want to send from (for example your Gmail) and confirm it with the code Brevo emails to it.
3. Railway variables: `BREVO_API_KEY` and `EMAIL_FROM`, for example `The Baker <you@gmail.com>`. The address must be exactly the verified sender.
4. Mail sent from a Gmail address can land in spam, because Gmail only vouches for mail sent by Google. Fine for a demo; use your own domain for real customers.
5. Use **Send me a test email** on the Payments and emails screen to check the setup.

**Cloudflare R2 (product photos)**
1. Cloudflare dashboard, **R2 Object Storage**, create a bucket (for example `the-baker`).
2. Bucket **Settings, Public access**: enable the **r2.dev subdomain** (or connect a custom domain). Copy the public URL into `R2_PUBLIC_URL` (no trailing slash).
3. R2 overview, **Manage API tokens**, create a token with **Object Read & Write** limited to that bucket. Copy the Access Key ID and Secret Access Key. The Account ID is shown on the R2 overview page.

**Vercel (frontend)**
1. Import the repo with **Root Directory** `frontend` (Vite preset).
2. Environment variable `VITE_API_URL` = the Railway public URL (no trailing slash).
3. After the first deploy, put the Vercel URL into Railway's `FRONTEND_URL` and `CORS_ORIGINS`.

## Testing

- Backend: `python -m pytest` (about 280 tests, on a real Postgres). They cover the rules that matter most: nobody can buy the last cake twice, a retried request never creates a second order, a payment callback is verified and handled once, a refund that fails changes nothing, and each role sees only what it should.
- Frontend: `npm test` (about 240 tests with Testing Library and axe). Components are found by their accessible names, the way a screen reader finds them.
- Time is frozen in tests, so results do not depend on the day or hour they run.

## Conventions

- Backend layers: `routers → crud/services → models`, one entity per layer under the same name.
- Schema changes only through Alembic migrations, committed with the model change.
- Money is stored as integer minor units. The server decides prices, never the client.
- Accessibility (WCAG 2.2 AA) is a requirement: lint rules, axe checks and contrast tests run in CI.
