# The Baker — System Design

> Status: **v0.1 draft**, 2026-11-08
> Inputs: [REQUIREMENTS_DRAFT.md](REQUIREMENTS_DRAFT.md) (scope and decisions D1–D8) and [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) (stack and conventions).
> Requirement IDs (C1.1, S1.3, O2.1 …) refer to the requirements draft.

---

## 1. Goals

The Baker is an online ordering platform for a fictional bakery in Cairo. Customers order cakes and baked goods for delivery or pickup in a chosen time slot, staff run the order queue, and the owner manages the catalog, capacity and store settings.

**Design goals, in priority order:**

1. **Correct orders.** No overselling of daily capacity or time slots, prices are always computed on the server, and order status changes follow the defined lifecycle.
2. **Accessible to everyone** (D1). WCAG 2.2 AA is a requirement, not an afterthought.
3. **Simple to run.** One repo, one `docker compose up` locally, and Railway (API) + Vercel (web) for the demo.
4. **Easy to extend.** Payments, email and file storage sit behind interfaces, money handling supports any currency, and UI strings are centralized.

---

## 2. Repository layout

A monorepo, as described in ARCHITECTURE_OVERVIEW §5.

```
The-Baker/
├── docker-compose.yml          # db, backend, frontend, mailpit (dev)
├── .env.example
├── README.md                   # setup, demo accounts, architecture links
├── .github/workflows/          # CI with path filters per app
├── backend/
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py  database.py  deps.py
│   │   ├── core/               # permissions.py, security.py, money.py, clock.py
│   │   ├── models/  schemas/  crud/  routers/
│   │   ├── services/           # pricing, availability, orders, payments/, notifications/, storage/
│   │   └── tasks/              # expire_unpaid_orders, send_pending_notifications
│   ├── scripts/seed_demo.py
│   └── tests/
├── frontend/
│   └── src/ (lib/, hooks/, components/{auth,layout,ui,common,<feature>}/, pages/<feature>/)
└── docs/
```

---

## 3. Roles and permissions

There are three fixed roles. Permissions live in one config file (`core/permissions.py`) that maps each **module** to the roles allowed to read and write it. Guards are generated from this config and attached in `main.py`.

| Module | Customer | Staff | Owner | Guest |
|---|---|---|---|---|
| `catalog` (public read) | R | R | R | R |
| `checkout` / own orders | RW (own) | — | — | RW (with tracking token) |
| `account` | RW (own) | RW (own) | RW (own) | — |
| `orders_queue` | — | RW | RW | — |
| `catalog_admin` | — | — | RW | — |
| `schedule_admin` (zones, slots, hours, capacity) | — | R | RW | — |
| `settings` (business, policies, payments, templates) | — | — | RW | — |
| `team` | — | — | RW | — |

- **O3.1, "assign roles and permissions":** in v1 the owner assigns a role (`staff` or `owner`) to each team account. Custom per-user permissions are deferred, but the module-based config is designed so a `role_permissions` table can replace the static map later without touching routers.
- The system must always have at least one active owner. The API refuses to demote or deactivate the last one.
- The frontend reads `/auth/me` and hides pages the user can't access. That is for UX only; the server always enforces access.

---

## 4. Domain rules

These rules shape the data model and the services.

### 4.1 Availability and lead time (C2.2, O1.3)

A product variant can be ordered for a fulfilment **date** and **slot** only if all of the following hold:

1. The product is active (`is_available` and not archived) and the variant is active.
2. The store is open that day: an `opening_hours` row exists, the day is not closed, and there is no `store_closures` row for that date.
3. The product is available on that weekday (`product_availability` rules, which default to every day).
4. **Lead time:** `slot_start ≥ now + max(lead_time_hours of all items in the cart)`.
5. **Product daily capacity:** `reserved_qty + requested_qty ≤ daily_capacity` for that product and date. A null capacity means unlimited.
6. **Slot capacity:** `reserved_orders + 1 ≤ max_orders` for that slot and date.

Dates and times are calculated in the store timezone (`Africa/Cairo`). Timestamps are stored in UTC. All "now" logic goes through `core/clock.py` so tests can freeze time.

### 4.2 Capacity reservation (no overselling)

Capacity is held in counter rows that are locked inside the order transaction:

```
product_daily_usage (product_id, date, reserved_qty)     UNIQUE(product_id, date)
slot_daily_usage    (time_slot_id, date, reserved_orders) UNIQUE(time_slot_id, date)
```

When an order is placed, the service:

1. Upserts the counter rows (`INSERT … ON CONFLICT DO NOTHING`).
2. Runs `SELECT … FOR UPDATE` on them, **in a fixed order** (by product id, then slot id) to avoid deadlocks.
3. Checks the limits, increments the counters and inserts the order, **all in one transaction**.

Cancellation, rejection and payment timeout give the capacity back in the same transaction as the status change. A test places concurrent orders for the last unit to prove that only one succeeds.

### 4.3 Pricing (C2.3)

Totals are always calculated on the server by `services/pricing.py`. The client never sends prices.

```
line_total   = variant.price × quantity
subtotal     = Σ line_total
delivery_fee = zone.fee if fulfilment == delivery else 0
total        = subtotal + delivery_fee
```

- A delivery order is rejected if `subtotal < zone.min_order_amount`, with a clear message showing how much more is needed.
- Order items **snapshot** the product name, variant name and unit price, so later catalog edits never change past orders.

### 4.4 Cancellation and modification window (C3.3, O2.1)

The owner sets `cancellation_window_hours` (default 24). The customer can cancel or modify an order only if:

- its status is `received` or `accepted` (preparation has not started), **and**
- `now ≤ slot_start − cancellation_window_hours`.

The API computes this as `order.can_modify_until` and returns it, so the UI shows a countdown ("You can change this order until Tue 14:00") instead of making the customer guess.

**What can be modified:**

| Order | Can change |
|---|---|
| Cash on delivery | Items and quantities, date/slot, address, notes. The order is re-quoted and capacity is re-reserved. |
| Card (paid) | Date/slot, address within a zone with the same fee, notes. Changing items requires cancel and re-order, which avoids partial charges. |

### 4.5 Refunds (O2.1)

The owner chooses a refund policy: `full`, `percentage` (e.g. 80%), or `none` for customer cancellations inside the window. The policy text is shown at checkout and on the order page.

- **Staff rejection or staff cancellation:** always a full refund.
- Refunds go through the payment provider (§7), and the result is recorded in `payments.refunded_amount`.

---

## 5. Data model

### 5.1 Entity overview

```mermaid
erDiagram
    users ||--o{ addresses : has
    users ||--o{ orders : places
    users ||--o{ password_reset_tokens : has
    categories ||--o{ products : contains
    products ||--o{ product_variants : "sizes"
    products ||--o{ product_images : has
    products }o--o{ occasions : "tagged via product_occasions"
    products ||--o{ product_availability : "weekday rules"
    products ||--o{ product_daily_usage : "capacity used"
    delivery_zones ||--o{ addresses : "located in"
    delivery_zones ||--o{ orders : "delivered to"
    time_slots ||--o{ slot_daily_usage : "capacity used"
    time_slots ||--o{ orders : "scheduled in"
    orders ||--|{ order_items : contains
    orders ||--o{ order_status_events : history
    orders ||--o{ order_messages : "staff contact"
    orders ||--o{ payments : "paid by"
    orders ||--o{ notifications : triggers
    product_variants ||--o{ order_items : "ordered as"
```

All tables follow the conventions: integer `id` primary keys, `created_at` / `updated_at` with server defaults, explicit `ondelete` on every foreign key, and an index on every foreign key.

### 5.2 Tables

**Identity**

| Table | Key columns |
|---|---|
| `users` | `email` (unique, case-insensitive), `password_hash`, `full_name`, `phone`, `role` enum(`customer`,`staff`,`owner`), `is_active`, `last_login_at` |
| `password_reset_tokens` | `user_id` → users (CASCADE), `token_hash` (unique), `expires_at`, `used_at` |
| `addresses` | `user_id` → users (CASCADE), `label`, `zone_id` → delivery_zones (RESTRICT), `street`, `building`, `floor`, `apartment`, `landmark`, `notes`, `is_default` |

**Catalog**

| Table | Key columns |
|---|---|
| `categories` | `name`, `slug` (unique), `description`, `sort_order`, `is_archived` |
| `occasions` | `name`, `slug` (unique), `sort_order`, `is_archived` (e.g. Birthday, Wedding, Ramadan & Eid, Corporate) |
| `products` | `category_id` → categories (RESTRICT), `name`, `slug` (unique), `description`, `ingredients`, `lead_time_hours`, `daily_capacity` (nullable), `is_available`, `is_archived`, `is_featured` |
| `product_variants` | `product_id` (CASCADE), `name` ("6-inch, serves 8"), `price` (int, minor units), `sort_order`, `is_active` |
| `product_images` | `product_id` (CASCADE), `storage_key` (unique), **`alt_text` (NOT NULL)**, `sort_order`. The public URL is computed from the key and the storage settings, so moving the bucket domain needs no data migration. |
| `product_occasions` | `product_id`, `occasion_id` (composite PK, CASCADE) |
| `product_availability` | `product_id` (CASCADE), `weekday` 0–6 (0 = Monday), `is_available`. Only blocked days are stored, so no rows means available every day. Unique per product and weekday. |

Archiving is a soft delete. Archived products disappear from the storefront but remain on past orders.

**Schedule and delivery**

| Table | Key columns |
|---|---|
| `opening_hours` | `weekday` (unique), `opens_at`, `closes_at`, `is_closed` |
| `store_closures` | `date` (unique), `reason` (holidays, one-off closures) |
| `time_slots` | `weekday`, `starts_at`, `ends_at`, `fulfilment_type` enum(`delivery`,`pickup`,`both`), `max_orders`, `is_active` |
| `delivery_zones` | `name` (e.g. Maadi, Zamalek, New Cairo), `fee`, `min_order_amount`, `is_active`, `sort_order` |
| `product_daily_usage` | `product_id`, `date`, `reserved_qty`, unique(`product_id`,`date`) |
| `slot_daily_usage` | `time_slot_id`, `date`, `reserved_orders`, unique(`time_slot_id`,`date`) |

**Orders**

| Table | Key columns |
|---|---|
| `orders` | `code` (unique, public, e.g. `BK-7F3K2Q`), `idempotency_key` (unique), `user_id` → users (SET NULL, nullable for guests), `contact_name`, `contact_email`, `contact_phone`, `fulfilment_type`, `fulfilment_date`, `time_slot_id` (SET NULL) plus `slot_starts_at` / `slot_ends_at` snapshots, `zone_id` (SET NULL) plus `zone_name` and `delivery_address` snapshots, `subtotal`, `delivery_fee`, `total`, `currency`, `payment_method` enum(`card`,`cod`), `payment_status` enum(`unpaid`,`pending`,`paid`,`partially_refunded`,`refunded`,`failed`), `status` (§6), `is_delayed`, `delay_note`, `rejection_reason`, `cancellation_reason`, `customer_notes`, `placed_at`. There is no stored tracking token; see the M3 notes. |
| `order_items` | `order_id` (CASCADE), `product_id` / `variant_id` (SET NULL), `product_name`, `variant_name`, `unit_price`, `quantity`, `line_total`, `inscription` (message on the cake) |
| `order_status_events` | `order_id` (CASCADE), `from_status`, `to_status`, `actor_user_id` (SET NULL), `reason`, `created_at`. This powers the customer tracking timeline. |
| `order_messages` | `order_id` (CASCADE), `author_id` (SET NULL), `channel` enum(`email`,`note`), `body`, `sent_at` |

**Payments and notifications**

| Table | Key columns |
|---|---|
| `payments` | `order_id` (CASCADE), `provider` (`paymob`, `fake`; cash orders have no row), `provider_ref` (the provider's payment id, e.g. the Paymob order id; unique), `amount`, `refunded_amount`, `status`, `failure_reason` |
| `processed_webhook_events` | `provider`, `event_id`, unique together, so each webhook event is handled once |
| `notifications` | `order_id` (SET NULL), `template_key`, `to_email`, `subject`, `body`, `status` enum(`pending`,`sent`,`failed`), `attempts`, `last_error`, `sent_at`. This is an outbox. |
| `notification_templates` | `key` (unique: `order_confirmed`, `order_accepted`, `order_rejected`, `status_changed`, `order_delayed`, `order_cancelled`, `order_modified`, `password_reset`, `staff_message`), `subject`, `body`, `is_active` |

**Settings (single row)**

`store_settings`: `business_name`, `phone`, `whatsapp`, `email`, `address`, `pickup_location`, `pickup_instructions`, `timezone`, `currency`, `cancellation_window_hours`, `refund_policy` enum, `refund_percentage`, `refund_policy_text`, `card_enabled`, `cod_enabled`, `cod_max_total` (nullable).

**Payment secrets are never stored in the database.** API keys and webhook secrets come from environment variables. The owner's settings screen only switches methods on and off and shows whether each provider is configured.

### 5.3 Money

- Amounts are stored as **integers in minor units**: piastres for EGP. Floats are never used.
- `core/money.py` holds a currency table `{EGP: 2, USD: 2, …}` with each currency's number of decimal places for formatting and parsing. The frontend formats amounts with `Intl.NumberFormat`.
- Choosing a currency is a store setting, so switching currency is a configuration change, not a code change.

### 5.4 Indexes (beyond foreign keys)

| Index | Serves |
|---|---|
| `orders (fulfilment_date, status)` | Staff queue filtered by date and status (S1.1) |
| `orders (user_id, placed_at DESC)` | Order history (C4.3) |
| `orders (status, placed_at)` partial `WHERE status = 'pending_payment'` | Payment-expiry job |
| `products (category_id, is_archived, is_available)` | Menu browsing |
| GIN trigram on `products.name`, `products.description` | Menu search with `ILIKE` (C1.1) |
| `notifications (status, created_at)` partial `WHERE status = 'pending'` | Outbox worker |

---

## 6. Order lifecycle

### 6.1 State machine

```mermaid
stateDiagram-v2
    [*] --> pending_payment : card order placed
    [*] --> received : COD order placed
    pending_payment --> received : payment confirmed (webhook)
    pending_payment --> cancelled : payment failed / expired (30 min)
    received --> accepted : staff accepts
    received --> rejected : staff rejects (reason)
    accepted --> preparing
    preparing --> ready
    ready --> out_for_delivery : delivery orders
    out_for_delivery --> delivered
    ready --> picked_up : pickup orders
    received --> cancelled : customer (in window) / staff
    accepted --> cancelled : customer (in window) / staff
    preparing --> cancelled : staff only (reason)
    ready --> cancelled : staff only (reason)
    delivered --> [*]
    picked_up --> [*]
    rejected --> [*]
    cancelled --> [*]
```

- The transitions are defined once, as a table in `services/orders.py`, as `(from, to, allowed_roles, fulfilment_type)`. Both the API and the UI read from this table: the staff UI only shows buttons for the transitions that are allowed next.
- An invalid transition returns `409 Conflict`.
- **Delayed** (S1.5) is a flag (`is_delayed` + `delay_note`), not a status, because an order can be delayed in any active status. Setting it notifies the customer.
- Every transition writes an `order_status_events` row and puts the matching notification in the outbox.
- `rejected` and `cancelled` give capacity back (§4.2) and trigger a refund if the order was paid (§4.5).

### 6.2 Typical flows

**Card checkout (C2.4, C3.1)**

```
Client                      API                                   Paymob
  │ POST /checkout/quote ──▶ validate + price                       │
  │ ◀── totals / errors                                             │
  │ POST /orders (Idempotency-Key) ──▶ tx: reserve capacity,        │
  │                              create order(pending_payment)      │
  │                              create Checkout Session ─────────▶│
  │ ◀── { redirect_url }                                            │
  │ ─────────────────────────── pay on Paymob page ───────────────▶│
  │                              ◀── webhook checkout.session.completed
  │                              verify signature, dedupe event,
  │                              payment=paid, status=received,
  │                              outbox: order_confirmed email
  │ /checkout/success?code=… ──▶ GET /orders/{code} (polls until received)
```

**Cash on delivery:** the order is created directly in `received` with `payment_status = unpaid`. Staff mark it paid when it's delivered or picked up.

**Guest tracking (D7):** when an order is placed, a random 32-byte token is generated. Only its hash is stored. The confirmation email links to `/track/{code}?t={token}`. Logged-in customers can see their own orders without a token.

---

## 7. Integrations

All integrations sit behind small interfaces in `services/`, with a fake implementation used by tests and local development.

| Interface | Methods | Production | Dev / test |
|---|---|---|---|
| `PaymentProvider` | `create_payment(order) → redirect_url`, `parse_webhook(req) → event`, `refund(payment, amount)` | `PaymobProvider` (Unified Checkout, **test mode**, D3) | `FakeProvider` |
| `CashOnDelivery` | same interface, no-op redirect | built-in | built-in |
| `EmailSender` | `send(to, subject, html, text)` | Brevo (HTTP API) | Mailpit container / console |
| `FileStorage` | `put(file) → key,url`, `delete(key)` | S3-compatible bucket (Cloudflare R2), because managed hosts have temporary disks (D8) | local disk |

- **Stripe was removed.** It does not support Egyptian merchants. Paymob, an Egyptian provider with a free test mode, replaced it behind the same `PaymentProvider` interface, which is exactly the swap the interface was designed for.
- **Webhooks** check the signature, deduplicate through `processed_webhook_events`, and are safe to receive more than once.
- **Emails** are written to the `notifications` outbox inside the business transaction, then sent by a background task that retries with backoff. A failed email never rolls back an order, and the owner can see failures.
- **Templates** use Jinja2 in a sandboxed environment with a whitelist of variables (`{{ order.code }}`, `{{ customer.name }}`, `{{ order.total }}`, `{{ tracking_url }}` …). The owner edits them with a live preview.

**Background tasks** (in-process, single worker, as in ARCHITECTURE_OVERVIEW §7):

- `expire_unpaid_orders`: every minute, cancels `pending_payment` orders older than 30 minutes and gives their capacity back.
- `send_pending_notifications`: every 15 seconds, processes the outbox.

Both use `SELECT … FOR UPDATE SKIP LOCKED`, so they stay safe if we scale to several workers later.

---

## 8. API

REST under `/api/v1`, JSON, JWT bearer auth. Every list endpoint is paginated with the standard envelope `{items, total, page, page_size, total_pages}`, and `page_size` is limited to 100. Errors use one shape: `{error: {code, message, fields?}}`.

### 8.1 Public and customer

| Method | Path | Auth | Req |
|---|---|---|---|
| POST | `/auth/register` · `/auth/login` | — | C4.1 |
| POST | `/auth/forgot-password` · `/auth/reset-password` | — | C4.1 |
| GET | `/auth/me` | user | — |
| PATCH | `/me` | user | C4.2 |
| GET/POST/PATCH/DELETE | `/me/addresses[/{id}]` | user | C4.2 |
| GET | `/me/orders` | user | C4.3 |
| GET | `/store` | — | Business info, hours, pickup details, policy text |
| GET | `/categories` · `/occasions` · `/delivery-zones` | — | C1.1 |
| GET | `/products?category=&occasion=&q=&sort=&page=` | — | C1.1 |
| GET | `/products/{slug}` | — | C1.2 |
| GET | `/availability/dates?fulfilment=&items=&days=` | — | Earliest date and a per-day verdict (with reason) for the next 30 days (up to 60). `items` is the cart as `variant_id[:qty],...`; quantities are needed to check product capacity. |
| GET | `/availability/slots?date=&fulfilment=&items=` | — | Slots with remaining capacity and the reason any slot is unavailable. Rejects past dates and dates more than 90 days ahead. |
| POST | `/checkout/quote` | optional | C2.3 |
| POST | `/orders` | optional (guest OK) | C2.1–C2.4 |
| GET | `/orders/{code}` | owner of the order, or `?t=` token | C3.2 |
| PATCH | `/orders/{code}` | owner of the order, or token | C3.3 |
| POST | `/orders/{code}/cancel` | owner of the order, or token | C3.3 |
| POST | `/payments/paymob/webhook` | Paymob HMAC (`hmac` query parameter) | C2.4 |

### 8.2 Staff (`orders_queue`)

| Method | Path | Req |
|---|---|---|
| GET | `/staff/orders?date=&status=&fulfilment=&q=&page=` | S1.1 |
| GET | `/staff/orders/summary?date=` | Counts by status for the queue tabs |
| GET | `/staff/orders/{id}` | S1.1 |
| POST | `/staff/orders/{id}/accept` · `/reject {reason}` | S1.2 |
| POST | `/staff/orders/{id}/transition {to}` | S1.3 |
| POST | `/staff/orders/{id}/delay {note}` · `/cancel {reason}` | S1.5 |
| POST | `/staff/orders/{id}/messages {body}` | S1.4: emails the customer and logs the message |
| POST | `/staff/orders/{id}/mark-paid` | Cash collected |
| GET | `/staff/prep-sheet?date=` | Quantity of each product needed for the day (supports capacity planning) |

### 8.3 Owner (`catalog_admin`, `schedule_admin`, `settings`, `team`)

| Resource | Endpoints | Req |
|---|---|---|
| Categories / occasions | CRUD + `POST …/{id}/archive` · `/restore` | O1.1 |
| Products | CRUD + archive/restore, `PUT /admin/products/{id}/availability` | O1.1, O1.3 |
| Variants | `POST/PATCH/DELETE /admin/products/{id}/variants[/{vid}]` | O1.1 |
| Images | `POST /admin/products/{id}/images` (multipart, alt text required), `PATCH` reorder/alt, `DELETE` | O1.2 |
| Delivery zones | CRUD | D6 |
| Schedule | `PUT /admin/opening-hours`, CRUD `/admin/time-slots`, CRUD `/admin/closures` | O1.3, O4.1 |
| Settings | `GET/PATCH /admin/settings` (business, pickup, policies, payment toggles) | O2.1, O4.1, O4.2, O4.4 |
| Templates | `GET /admin/notification-templates`, `PATCH /{key}`, `POST /{key}/preview` | O4.3 |
| Team | `GET/POST /admin/team`, `PATCH /{id}` (role, active), `DELETE /{id}` (deactivates the account) | O3.1 |
| Notifications | `GET /admin/notifications?status=failed`, `POST /{id}/retry` | Operations |

### 8.4 Cross-cutting

- **Idempotency:** `POST /orders` requires an `Idempotency-Key` header, so a double click or a retry never creates two orders.
- **Rate limits** (slowapi): login, register, forgot-password, quote and order creation.
- **Caching:** a TTL + single-flight cache on `/categories`, `/occasions`, `/delivery-zones` and `/store`, placed below the auth layer and cleared when an admin writes. Product lists are not cached in v1.

---

## 9. Frontend

### 9.1 Routes

| Area | Route | Page | Req |
|---|---|---|---|
| Store | `/` | Home: featured items, categories, occasions | C1.1 |
| | `/menu?category=&occasion=&q=` | Menu with filters and debounced search | C1.1 |
| | `/products/:slug` | Product detail: gallery, size picker, price, ingredients, earliest date | C1.2 |
| | `/cart` | Cart: edit quantities and inscriptions | C2.1 |
| | `/checkout` | Step 1 fulfilment & zone → 2 date & slot → 3 contact & address → 4 payment → 5 review | C2.2–C2.4 |
| | `/checkout/success` · `/checkout/cancelled` | Result pages | C3.1 |
| | `/track/:code` | Status timeline, can-modify countdown, cancel/modify | C3.2, C3.3 |
| | `/accessibility` · `/policies` | Accessibility statement, refund and cancellation policy | D1, O2.1 |
| Auth | `/login` · `/register` · `/forgot-password` · `/reset-password` | | C4.1 |
| Account | `/account` · `/account/addresses` · `/account/orders` · `/account/orders/:code` | | C4.2, C4.3 |
| Staff | `/staff/orders` | Queue: date picker, status tabs with counts, refreshes every 30 s | S1.1 |
| | `/staff/orders/:id` | Order detail, allowed actions, contact panel (email, tel:, WhatsApp) | S1.2–S1.5 |
| | `/staff/prep-sheet` | Printable daily production list | — |
| Owner | `/admin/products[/new | /:id]` · `/admin/categories` · `/admin/occasions` | | O1.1–O1.3 |
| | `/admin/schedule` | Opening hours, time slots, closures | O1.3, O4.1 |
| | `/admin/delivery-zones` · `/admin/policies` · `/admin/settings` · `/admin/templates` · `/admin/team` | | O2–O4 |

Route guards in `App.tsx` are `RequireAuth`, `GuestOnly`, and `RequireModule("orders_queue")`.

### 9.2 State

- **Cart:** stored on the client (React context + `localStorage`) as `{variant_id, quantity, inscription}`. Prices shown in the cart come from `/checkout/quote`, never from the client. This works the same for guests and signed-in users.
- **Checkout:** state is kept per step in one reducer. The "Continue" button calls `/checkout/quote`, so errors (slot full, below minimum order, lead time) appear on the step that caused them.
- Server data is held in page-level hooks (`useProducts`, `useOrder`) with an AbortController to cancel stale requests. There is no global store, as in ARCHITECTURE_OVERVIEW §3.

---

## 10. Accessibility (WCAG 2.2 AA, D1)

### 10.1 Commitments

| Area | What we do | WCAG |
|---|---|---|
| Structure | Semantic landmarks, one `h1` per page, logical heading order, skip link | 1.3.1, 2.4.1, 2.4.6 |
| Keyboard | Every action works by keyboard. Modals and drawers trap focus and return it on close. No keyboard traps. | 2.1.1, 2.1.2 |
| Focus | Visible focus ring (≥ 3:1 contrast) that is never hidden by the sticky header or cart bar | 2.4.7, 2.4.11 |
| Targets | Interactive targets are ≥ 24×24 px, and ≥ 44 px for primary actions | 2.5.8 |
| Contrast | Text ≥ 4.5:1 and UI components ≥ 3:1, enforced through design tokens | 1.4.3, 1.4.11 |
| Not colour alone | Status badges use an icon and text as well as colour. Errors use an icon and text. | 1.4.1 |
| Images | **Alt text is required at upload** (enforced by the API), and decorative images use `alt=""` | 1.1.1 |
| Forms | Visible labels, `autocomplete` attributes, inline errors linked with `aria-describedby`, and an error summary at the top of each checkout step | 1.3.5, 3.3.1, 3.3.3 |
| Redundant entry | Saved addresses and contact details are prefilled, and checkout steps never ask for the same thing twice | 3.3.7 |
| Accessible authentication | Pasting and password managers are allowed, there are no CAPTCHA puzzles, and there is a show-password toggle | 3.3.8 |
| Live updates | `aria-live="polite"` for cart changes, quote totals and the staff queue's new-order count | 4.1.3 |
| Date and slot picking | Slots are a native radio group with the time as text, not a calendar that only works with a pointer | 2.5.7 |
| Consistent help | The contact (phone/WhatsApp) link is always in the same place in the footer and header | 3.2.6 |
| Motion | `prefers-reduced-motion` is respected and nothing auto-plays | 2.3.3 |
| Reflow | Works at 320 px width and at 200–400% zoom with no horizontal scroll | 1.4.4, 1.4.10 |

### 10.2 Display preferences

A "Display" menu in the header offers **text size** (100 / 125 / 150%), **high contrast**, and **reduce motion**. These are CSS custom-property themes on `<html>`, saved in `localStorage`.

### 10.3 Verification

- **Lint:** `eslint-plugin-jsx-a11y`.
- **Automated:** `@axe-core/playwright` runs on every key page in CI, and the build fails on any serious or critical violation.
- **Manual:** keyboard-only and VoiceOver passes through the golden paths (browse → order → track; staff queue; add a product), recorded in `docs/ACCESSIBILITY.md`.
- **Lighthouse:** an accessibility score of at least 95 on the storefront pages.

### 10.4 RTL readiness

Tailwind logical utilities (`ms-`, `me-`, `ps-`, `start-`), `dir` set on `<html>`, and all UI strings in `src/lib/strings.ts`. Adding Arabic means adding translations, not changing the layout.

---

## 11. Security

- Passwords are hashed with bcrypt, and the minimum length is 10 characters.
- The JWT access token lasts 60 minutes and inactive users are rejected.
- Password reset tokens are random, only their hash is stored, they last 30 minutes and work once. The endpoint returns the same response whether or not the email exists.
- Guest tracking tokens: only the hash is stored, and they are compared in constant time.
- Prices, totals, capacity and allowed transitions are always decided on the server.
- The Paymob callback signature (HMAC-SHA512) is verified, and duplicate transactions are ignored.
- Uploads are checked by MIME type and magic bytes (JPEG/PNG/WebP), limited to 5 MB, and re-encoded with Pillow to strip EXIF data.
- CORS allows only the frontend origin. Secrets come only from environment variables. `.env` files are ignored by git and `.dockerignore`.
- Staff and owner pages are never cached, and user data endpoints send `Cache-Control: no-store`.

---

## 12. Testing

| Level | Tooling | Focus |
|---|---|---|
| Unit | pytest | Pricing, money formatting, availability rules, the state-machine table, the cancellation window (with frozen time) |
| Integration | pytest + test Postgres (compose) + httpx | Every router: auth guards for each role, pagination, validation errors |
| Concurrency | pytest + asyncio.gather | Last-unit capacity and last-slot races, and double-submit with the same idempotency key |
| Payments | FakeProvider, and Paymob calls replaced by a recorder | Webhook handled once, payment expiry, refunds |
| Frontend unit | Vitest + Testing Library | Cart reducer, checkout step validation, display preferences |
| End-to-end | Playwright + axe | Guest card checkout, COD checkout, staff moves an order to delivered, owner adds a product |

CI runs on GitHub Actions with path filters (`backend/**`, `frontend/**`).

---

## 13. Deployment and demo (D2, D8)

| Piece | Local | Demo |
|---|---|---|
| Database | `postgres:16-alpine` in compose | **Railway** Postgres, in the same project as the backend |
| Backend | compose service, self-migrating entrypoint | **Railway** service built from `backend/Dockerfile` (root directory `backend/`), health check at `/healthz` |
| Frontend | compose nginx | **Vercel** project (root directory `frontend/`, Vite preset) |
| Email | Mailpit (web UI on :8025) | Brevo |
| Files | local volume | Cloudflare R2 bucket |
| Payments | FakeProvider | Paymob test mode + callback address on the Railway domain |

```
Browser ──▶ Vercel (static SPA, CDN)
   │
   └── fetch + Bearer JWT ──▶ Railway: FastAPI ──▶ Railway Postgres
                                   ▲    │
              Paymob callbacks ────┘    ├──▶ Brevo (email)
                                        └──▶ R2 (product images)
```

### 13.1 Railway (backend + database)

- The entrypoint runs `alembic upgrade head`, seeds the first owner from env vars, runs the optional demo seed, and then starts `uvicorn` on `$PORT`. Running it again on a restart is safe.
- **`DATABASE_URL`** comes from Railway's Postgres service. `app/database.py` rewrites the scheme to `postgresql+asyncpg://` for the async engine and `postgresql+psycopg://` for the sync batch engine.
- The pool size is set explicitly to fit the Railway Postgres connection limit, as in ARCHITECTURE_OVERVIEW §2.
- There is **one replica**, because background tasks and the TTL cache run in-process (§7). The tasks already use `SKIP LOCKED`, so moving the cache to Redis is the only change needed to scale out.
- Secrets are set as Railway variables: `JWT_SECRET`, `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID`, `PUBLIC_API_URL`, `BREVO_API_KEY`, `R2_*`, `FRONTEND_URL`, `CORS_ORIGINS`.

### 13.2 Vercel (frontend)

- `VITE_API_URL` is set in Vercel's environment variables and baked into the bundle at build time. It points to the Railway public domain.
- `frontend/vercel.json` adds the SPA rewrite (`/(.*) → /index.html`) and cache headers: `no-cache` on `index.html` and `immutable` on `/assets/*`. These replace what nginx does locally.
- **Preview deployments:** every pull request gets a Vercel preview URL. `CORS_ORIGINS` lists the production domain, and an optional `CORS_ORIGIN_REGEX` allows `https://the-baker-*.vercel.app` previews against the demo API.

### 13.3 Cross-origin notes

- The frontend and API are on different domains. Auth uses a **Bearer token in a header, not cookies**, so there are no third-party-cookie or `SameSite` problems, and CSRF does not apply.
- The payment return address and the tracking links in emails, are built from `FRONTEND_URL` (Vercel). The webhook URL is the Railway domain.
- The same Docker Compose stack is still used for local development and CI, so nothing depends on the hosting platform.

**Seeded demo** (`scripts/seed_demo.py`, idempotent):

- About 30 products in 6 categories (Celebration Cakes, Cupcakes, Breads, Pastries, Cookies, Seasonal), with occasions such as Birthday, Wedding, Ramadan & Eid, and Corporate.
- Delivery zones across Cairo and Giza: Maadi, Zamalek, Heliopolis, Nasr City, New Cairo, Sheikh Zayed.
- Opening hours, two-hour slots, and a few sample orders in every status.
- Demo accounts `customer@demo.thebaker`, `staff@demo.thebaker` and `owner@demo.thebaker`, listed in the README and on a login hint panel shown only in demo mode.
- A banner: "Demo store, no real orders. Use card 4242 4242 4242 4242."
- An optional nightly reset job so the demo stays clean.

---

### M2 implementation notes

- **One engine, `services/availability.py`.** `evaluate_day` is a pure function (no database), so each rule in §4.1 has its own unit-level test, including the exact lead-time boundary. `load_context` fetches everything for a date range with a fixed number of queries, so the 60-day overview is not 60 queries. Checkout (M3) will reuse the same function and then lock the counters.
- **Reason codes** the frontend can switch on: `closed`, `closure`, `product_unavailable_day`, `product_capacity`, `outside_hours`, `lead_time`, `slot_full`, `no_slots`. Each comes with a human message.
- **Slots must lie inside opening hours** (otherwise `outside_hours`), and two slots may not overlap on the same weekday unless one is delivery-only and the other pickup-only.
- **Delivery zones are deactivated, not deleted**, so old orders and saved addresses keep a valid reference. Inactive zones are hidden from customers.
- **Roles:** staff can read the schedule and zones (`schedule_admin` read), only the owner can change them (write).
- **Counters:** `product_daily_usage` and `slot_daily_usage` exist now and are read by the engine; M3 writes them under `SELECT ... FOR UPDATE`.

---

### M3 implementation notes

- **Quote before order.** `POST /checkout/quote` never fails because of the customer's choices. It returns `problems`, each tagged with the step that can fix it (`items`, `zone`, `date`, `slot`), plus `ready`. Checkout shows each message where it can be fixed and blocks Continue.
- **Placing an order** (`services/orders.py`): early validation, then the counter rows are locked (`SELECT ... FOR UPDATE`, products by id first, then the slot), the quote is computed **again on the locked numbers**, the counters are incremented and the order is inserted, all in one transaction. Counters are read as plain column rows, never as cached ORM objects. Tests fire simultaneous orders at the last unit and the last slot, and exactly the allowed number succeed.
- **Idempotency.** `Idempotency-Key` is required. A repeat returns the original order (200 instead of 201) without reserving anything again, including when the duplicates arrive at the same instant. The frontend keeps one key per distinct order, so a retry after a network failure is safe.
- **Tracking tokens are derived, not stored.** The guest token is an HMAC of the order code with the server secret. A retried request therefore returns the same link, and no secret sits in the database. Rotating `JWT_SECRET` invalidates existing guest links.
- **Access to an order:** the right token, the customer who owns it, or staff/owner. Anyone else gets the same 404 as for a code that does not exist, so codes cannot be probed.
- **Snapshots:** names, sizes, unit prices, zone name, fee and address are copied onto the order, so later catalog or zone edits never change a past order.
- **Release:** `release_order_capacity` gives an order's units and slot back inside the caller's transaction. M5 (reject, cancel) and M6 (customer cancel) call it.
- **Deferred to M4:** card payments (the API answers `card_unavailable`, the UI shows the option disabled), the `payments` table, and confirmation emails. Order status starts at `received` for cash on delivery.
- The order page lives at `/track/:code` and doubles as the confirmation page; M6 adds cancel and modify to it.

---

### M4 implementation notes

- **Card flow.** The order is placed first (status `pending_payment`, capacity reserved exactly like a cash order), then the customer is sent to the provider's page. Only the provider's **signed webhook** marks an order paid; the browser returning from the payment page proves nothing. The order page polls until the confirmation arrives. Opening the payment page happens after the database transaction commits, so no row locks are held during a network call.
- **Providers sit behind an interface** (`services/payments`): `PaymobProvider` (an Intention is created with the secret key; the customer is redirected to Unified Checkout with the public key and a client secret; the signed Transaction Processed Callback confirms payment; refunds and voids use the secret key) and `FakeProvider` (a practice page in our own frontend that feeds the same event handler, refused in production).
- **Paymob specifics.** The callback is verified with HMAC-SHA512 over Paymob's documented, ordered list of transaction fields (`services/payments/paymob_provider.py`); the signature arrives in the `hmac` query parameter. Order lines are sent as items that add up exactly to the order total, as Paymob requires. Each payment attempt gets a fresh `special_reference` (`BK-XXXXXX-<random>`), which is how a callback is matched back to its order. A declined attempt changes nothing (the customer can retry); refund and void callbacks are ignored because we record those ourselves. Paymob offers no way to close a payment page, so a payment arriving after an order expired is refunded automatically. A same-day full refund that Paymob refuses falls back to a void. The implementation follows Paymob's published documentation and is covered by tests using a recorded stand-in; it still needs one real test payment to confirm (README step 8).
- **Events are idempotent.** Each webhook event id is stored once (`processed_webhook_events`); a duplicate delivery, even simultaneous ones, changes nothing and sends one email.
- **Unpaid orders expire.** After 35 minutes a background job cancels the order, closes the provider's payment page where the provider allows it, frees the capacity and tells the customer. An open payment page is reused for 31 minutes before a fresh one is created. If money still arrives for a cancelled order, or a second payment arrives for an already paid one, it is refunded automatically and recorded.
- **Payment page could not be opened:** the order is cancelled, capacity released, and the idempotency key is freed so the customer's retry creates a fresh order rather than returning the cancelled one.
- **Emails use an outbox.** `enqueue()` writes a `notifications` row inside the business transaction; a worker sends it. A mail outage can never roll back or block an order, retries back off (30s, 1m, 2m, 4m), after five failures the email stays visible as failed and the owner can retry it. A wake signal sends most emails within moments instead of waiting for the 15 second tick. Password reset emails use the same outbox.
- **Editable wording.** Nine templates have built-in defaults; the owner's edits live in `notification_templates`. They are rendered in a Jinja2 **sandbox** with a fixed list of variables per email (`StrictUndefined`, so a typo or an unknown variable is rejected when saving, with a clear message). Previews render with sample data. Only the owner can edit; secrets are never stored in the database.
- **Owner switches.** `store_settings` holds `card_enabled` and `cod_enabled` (at least one must stay on). Card is only offered when it is switched on **and** the server has a provider configured, and `/store` reports exactly which methods checkout may show.
- **Workers** (`tasks/runner.py`) run in the API process (email outbox every 15 s plus wake-ups, order expiry every 60 s) and use `SKIP LOCKED`, so scaling to several workers later needs no change. They are switched off in tests, which call the same functions directly.
- **Confirmation email links** are the same guest tracking links as before, so a guest who closes the page can come back from their inbox.

---

### M5 implementation notes

- **One transition table** (`services/orders.py`): each row is `(from, to, roles, fulfilment type, needs reason)`. The API enforces it (`409 invalid_transition` for anything else, so stages cannot be skipped or repeated) and the order detail returns `actions`, the steps the signed-in person may take next, so the screen only shows those buttons. Delivery orders end at `delivered`, pickup orders at `picked_up`.
- **Staff only see paid orders.** Unpaid card orders (`pending_payment`) are left out of the queue, the counts and the prep sheet, and answer 404 to every staff action. They appear once the payment is confirmed.
- **Every action locks the order row first** (`services/staff_orders.py`), so two staff members, or staff and a payment event, cannot act on the same order at once. Two simultaneous rejections release the capacity once: one wins, the other gets 409.
- **Reject and cancel are one transaction:** refund (card orders that were paid), give the units and the slot back, record the reason on the order and its timeline, queue the customer's email. If the refund fails, nothing changes and the person sees an error, so an order is never cancelled while the money is kept. Cash orders need no refund.
- **Late is a flag, not a status** (`is_delayed` + note). Marking it emails the customer; it can be updated or removed, and it clears itself when the order finishes or is closed.
- **Contact the customer** emails through the same outbox (`staff_message` template) and keeps a copy in `order_messages`, shown on the order. Staff also see the phone and email as links.
- **Cash collected** (`mark-paid`) records payment on a cash order; it is refused for card orders and for rejected or cancelled orders.
- **Queue:** filter by day (or all days), stage, delivery or pickup, and search by code, name, phone or email (typed `%` and `_` are plain text). Counts per stage come from `/staff/orders/summary`. The page refreshes itself every 30 seconds.
- **Prep sheet:** per day, the quantity of each product and size to make (declined, cancelled and unpaid orders are not counted) and the messages to write on cakes with their time slot. It prints cleanly (the site header, footer and controls are hidden when printing).
- Staff and the owner have the same rights in this module; the table keeps the role column so a stricter rule can be added without changing the API.

---

### M6 implementation notes

- **The rule** (`services/policies.py`): a customer can cancel or change an order only while its status is `received` or `accepted` **and** now is no later than `slot_start − cancellation_window_hours`. The API returns `can_change`, `can_modify_until` and `cancel_refund` with the order, so the tracking page says "until Mon 10:00" and "you will get 800.00 EGP back" instead of making the customer guess. The window and the refund policy (`full`, `percentage` 1 to 99, or `none`) are the owner's, edited under **Cancellation and refunds**; the wording customers read is generated from them (plus an optional extra note) and shown on the order page and at checkout.
- **Who may do it.** The customer only: the holder of the tracking link, or the signed-in owner of the order. Staff use their own endpoints (a staff member calling the customer endpoint gets the same 404 as a stranger).
- **Cancelling** is one transaction under the order's row lock: refund (card orders, per policy; a failed refund changes nothing and tells the customer), free the units and the slot, record the reason, email the customer. Two simultaneous cancels free the capacity once. Staff cancellation and rejection still refund in full.
- **Changing** covers date and time slot, delivery area and address, and notes. The items are not editable: to change them the customer cancels and orders again (a deliberate trim of the §4.4 table, which allowed item changes on cash orders). If the date or slot changes, the old and new days are locked in date order, the order's own units are released, the new booking is checked with the same rules as a fresh order (lead time, capacity, closures), and the new day is reserved, all or nothing. If only the address or notes change, the date is not re-checked, so a customer is never refused for the clock having moved on. A paid card order keeps its total, so it can only move to an area with the same fee; a cash order's fee and total follow the new area. Prices stay as ordered. Each change adds a line to the order history and sends the "order changed" email.
- **Account.** `PATCH /me` edits name and phone (the email and role cannot be changed here). Saved addresses (`/me/addresses`, up to 10, one default, delivery areas must be active) are prefilled at checkout: the default is filled in on arrival and any can be picked. `/me/orders` lists the customer's own orders, newest first; guest orders are not linked.
- **The cart follows the account** (`carts` table, `GET`/`PUT /me/cart`). Signing in restores the saved cart; items a guest added first are merged in (same item: quantities add up). While signed in every change is saved a moment later. Nothing is saved until the account's own cart has been fetched (so an empty local cart can never wipe it), and nothing is saved if that fetch failed. Signing out empties the cart on this browser only; the account keeps it. A cart left behind by a different account (an expired session) is never inherited. Carts hold only the choices (variant, quantity, cake message); prices always come from a fresh quote.
- **Shop information stays current:** the site re-reads `/store` whenever the visitor opens another page or returns to the tab, so a policy or payment change shows up without a reload.
- **Tracking page** now refreshes itself every 30 seconds until the order is finished (every 3 seconds while waiting for payment), so progress stays current without a reload.
- **Tests** freeze the clock at fixed dates; their login tokens are now minted to be valid at any frozen time (they used the real clock, which made tests depend on the time of day they ran).

---

### M7 implementation notes

- **Team (O3.1).** The owner lists, adds, changes and removes staff and owner accounts (`/admin/team`). The owner chooses a temporary password (at least 10 characters) and hands it over; the person changes it under **My account** (`POST /auth/change-password`, which asks for the current password and refuses an unchanged one). Removing is switching off, not erasing: the account keeps its history, can be switched back on, and its session ends at once because every request checks the account is still active. Safeguards: nobody can change their own role or switch off their own account, and the last active owner cannot be removed or demoted. The owner rows are locked while that is checked, so two owners acting on each other at the same moment cannot leave the shop without an owner. Customers cannot be added to the team this way (an existing customer's email is refused), because roles are never granted without the owner typing a new account.
- **Shop details (O4.1, O4.4).** Name, phone, WhatsApp, email, address and the pickup place and instructions are the owner's to edit and are public through `/store`. They appear in the footer (contact links), at checkout when pickup is chosen, on the order page, and in order emails (the shop name, and "Collect from: ..." for pickup orders). An empty name falls back to the configured default.
- **Demo accounts (D2).** With `SEED_DEMO=true` and `DEMO_PASSWORD` set, a demo customer (`customer@demo.thebaker`) and demo staff member (`staff@demo.thebaker`) are created next to the demo catalog; the owner is the `FIRST_OWNER_*` account. They share one password that is set only in the environment, never in the repository, so the public demo cannot be signed into with a guessable one. Existing accounts are never touched.
- **Accessibility audit.** See [ACCESSIBILITY.md](ACCESSIBILITY.md): what is enforced in CI, how each WCAG principle is met, the known limitations, and a manual checklist (screen reader, keyboard, zoom, colour) that still needs a person.
- **Operations.** The README is the deploy guide: every environment variable in one table, the Railway, Vercel, R2, Paymob and Brevo setup, demo accounts, and how to run the tests.

---

### Visual design (applied after M7)

- **Look:** the colours are the project's own cream, brown and terracotta (kept at the owner's request); everything else follows the "place" rules of the design-taste skill: Literata for headlines (weight 400) and Figtree for text (400 and 500), square corners (2px on controls), flat hairline cards with no shadows, sentence-case labels, one drawn-underline link style, buttons that step up 1px on hover and press 1px on click, cards that lift 2px, and photographs that zoom 1.03 inside their frame. One opaque header with a hairline: the shop's words on the left, its name in the middle, cart, account and display on the right.
- **Home page** (the short page of the skill, under eight photographs): a full-width picture with nothing on it (the bakery's own paper-craft cover illustration), then the headline, one hard fact (today's opening time, from the hours the owner set) and one button; one section with the menu in three groups of up to five products with their "from" price beside a photograph, and the visit block (address, hours with an open-now line, delivery and pickup); a brown closing band with the one action; the footer. The hero enters once on load, and the section's photograph develops once as it arrives (both off under reduced motion). On a phone an action bar appears once the hero's button has scrolled away.
- **Pictures** on the home page: the hero is the bakery's own cover illustration (`frontend/public/photos/baker-cover-*.webp`, made from `baker-cover.png`); the one photograph beside the menu is a licensed stand-in from Wikimedia Commons (credited in one footer line, the list opens). Replace it with the bakery's own photograph; nothing on the page says it is a stand-in. Product tiles stay generated until the owner uploads real product photos.
- **Menu and product pages** use the same look: search bar, category pills and one Filters panel on the menu; flat square product tiles; a product page with the size options, price and add button together.
- **Cart, checkout, order page, account, staff and owner screens** keep their structure and take the shared look (fonts, corners, hairlines, buttons) through the common styles.

---

## 14. Delivery plan

Each milestone is one or more pull requests with tests. The demo is updated at the end of each milestone.

| # | Milestone | Covers |
|---|---|---|
| M0 ✅ | Scaffolding: monorepo, compose, CI, design tokens and a11y lint, auth (register, login, reset, me), and a **first deploy to Railway + Vercel**, so every later milestone ships to a live URL | C4.1, D8 |
| M1 ✅ | Catalog: public menu, search, product page, and owner CRUD with images | C1, O1.1, O1.2 |
| M2 ✅ | Schedule and zones: hours, slots, closures, capacity, availability endpoints | O1.3, D6 |
| M3 ✅ | Cart, quote, checkout, COD orders, capacity reservation | C2 |
| M4 ✅ | Paymob (Egypt) test payments, webhooks, outbox emails, templates | C2.4, C3.1, O4.2, O4.3 |
| M5 ✅ | Staff queue, lifecycle, delay/cancel, contact, prep sheet | S1 |
| M6 ✅ | Tracking, modify/cancel window, refunds, account pages | C3, C4.2, C4.3, O2 |
| M7 ✅ | Team management, settings, accessibility audit, demo seed, deploy, README polish | O3, O4, D1, D2 |

---

## 15. Resolved questions

| # | Question | Answer | Decision |
|---|---|---|---|
| 1 | Time slot shape | Fixed two-hour windows, each with a maximum number of orders, for both delivery and pickup | D9 |
| 2 | Product options | Sizes (variants) plus a free-text cake message only. No flavour or filling add-ons in v1. | D10 |
| 3 | Market | Stays in Egypt (EGP). Another currency is possible later through configuration (§5.3). | D4 |
| 4 | Hosting | Backend and Postgres on Railway, frontend on Vercel (§13) | D8 |

No open questions remain.
