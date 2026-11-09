# The Baker

Online ordering for a fictional Cairo bakery: customers browse and order cakes and bakes for delivery or pickup, staff run the order queue, and the owner manages the catalog and settings.

**Stack:** FastAPI + SQLAlchemy (async) + PostgreSQL, React + TypeScript + Vite + Tailwind. Monorepo, Docker Compose locally, Railway (API + database) and Vercel (web) for the demo.

Design docs: [requirements](docs/REQUIREMENTS_DRAFT.md) · [system design](docs/DESIGN.md) · [architecture conventions](docs/ARCHITECTURE_OVERVIEW.md)

## Status

- **M0** scaffolding and authentication: done and deployed.
- **M1** catalog: done. Customers browse the menu (category, occasion, search, sort, pagination) and open product pages. The owner manages products, sizes and prices, photos (with required alt text), categories and occasions.
- **M2** schedule and delivery: done. Weekly opening hours, closed dates, fixed two-hour time slots with order limits, delivery zones with fees and minimum orders, and weekday rules per product. One rules engine answers "which dates and slots can this cart be booked for". Owners manage it all under **Manage shop**, staff can view it, and customers see opening hours, delivery fees and the earliest delivery or pickup date for each product.
- **M3** cart, checkout and cash-on-delivery orders: done. Customers add products (with an optional cake message) to a cart, then check out in five steps (delivery or pickup, date and time, contact details, payment, review). The server prices everything, shows the delivery fee and total before ordering, reserves capacity so the last cake or slot can never be sold twice, and a retried or double-clicked submit never creates two orders. Guests get a private tracking link, signed-in customers see their own orders.
- **M4** card payments and emails: done. Customers can pay by card (Paymob, Egypt, test mode) or cash. A card order holds its slot while the customer pays, the provider's signed webhook confirms it, unpaid orders expire after 35 minutes and free their capacity, and money that arrives too late is refunded automatically. Confirmation emails go through a retrying outbox (Brevo in production). The owner switches payment methods on and off, edits the wording of every email with a live preview, and sees an email log with retry, all under **Manage shop, Payments and emails**.
- **M5** staff order queue: done. Staff and the owner open **Orders** to see the day's orders, filter by stage, delivery or pickup and search, then accept or decline (with a reason), move an order through preparing, ready and delivered or collected, mark it late, cancel it, and email the customer. Declining or cancelling a paid card order refunds it and frees the slot in the same step. A printable **Prep sheet** adds up what to bake that day and lists the messages to write on cakes.
- Next: **M6**, customer tracking with change and cancel, refunds by policy, and account pages. See [DESIGN.md §14](docs/DESIGN.md).

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

## Deploy (demo)

**Railway (backend + database)**
1. New project, add a **PostgreSQL** service.
2. Add a service from this repo with **Root Directory** `backend` (it picks up `backend/railway.json` and the Dockerfile).
3. Variables: `DATABASE_URL` (reference the Postgres service's `DATABASE_URL`), `ENV=production`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS` (both the Vercel URL), `FIRST_OWNER_EMAIL`, `FIRST_OWNER_PASSWORD`.
4. Photo storage (required in production, the app refuses to start without it): `STORAGE_BACKEND=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. See below.
5. Optional: `SEED_DEMO=true` loads the demo catalog on the first start when the catalog is empty.
6. Generate a public domain.

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

## Conventions

- Backend layers: `routers → crud/services → models`, one entity per layer under the same name.
- Schema changes only through Alembic migrations, committed with the model change.
- Money is stored as integer minor units. The server decides prices, never the client.
- Accessibility (WCAG 2.2 AA) is a requirement: lint rules, axe checks and contrast tests run in CI.
