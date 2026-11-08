# The Baker — Requirements Draft

> Status: **DRAFT** (captured 2026-11-08). Scope of the basic system. Open to change during the design phase.
> Stack and conventions: see [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md).

## Roles

| Role | Summary |
|---|---|
| **Customer** | Browses, orders, tracks and manages their own orders and account |
| **Staff** | Works the order queue and updates order status |
| **Owner** | Everything Staff can do, plus catalog, pricing, policies, staff accounts and store settings |

---

## Customer

### C1. Discover
- **C1.1** Browse the menu by category and occasion, and search.
- **C1.2** View product details: photo, sizes, price, ingredients.

### C2. Order
- **C2.1** Add to cart and edit quantities.
- **C2.2** Choose delivery or pickup, enter an address, and pick a date and time slot.
- **C2.3** See the delivery fee and total before paying.
- **C2.4** Pay online or choose cash on delivery.

### C3. After ordering
- **C3.1** Receive confirmation by email.
- **C3.2** Track order status.
- **C3.3** Cancel or modify an order within the allowed window (before preparation starts).

### C4. Account
- **C4.1** Register, log in, and reset a password.
- **C4.2** Manage saved addresses and profile.
- **C4.3** View order history.

---

## Staff

### S1. Orders
- **S1.1** View the incoming order queue, filtered by date and status.
- **S1.2** Accept or reject an order, with a reason (e.g. out of capacity).
- **S1.3** Update status: `received → preparing → ready → out for delivery → delivered / picked up`.
- **S1.4** Contact the customer about an order issue.
- **S1.5** Mark an order as delayed or cancelled.

---

## Owner

### O1. Catalog and pricing
- **O1.1** Create, edit, archive and price products and categories.
- **O1.2** Manage items, photos and descriptions.
- **O1.3** Set lead times, daily capacity and availability rules per product.

### O2. Policies
- **O2.1** Set the cancellation/modification window and refund policy.

### O3. Team
- **O3.1** Create and remove staff accounts, and assign roles and permissions.

### O4. Store settings
- **O4.1** Business info and opening hours.
- **O4.2** Payment gateway settings.
- **O4.3** Notification templates.
- **O4.4** Store pickup details.

---

## Decisions

| # | Decision | Date |
|---|---|---|
| D1 | **Accessibility (WCAG 2.2 AA) is in scope**: full keyboard use, screen-reader labels, visible focus, high-contrast and larger-text toggle, reduced motion, so the store works for elderly customers, people with limited mobility, and people who use assistive technology. | 2026-11-08 |
| D2 | **Showcase:** a live demo with seeded demo accounts (customer, staff, owner) plus a public GitHub repo and README. | 2026-11-08 |
| D3 | **Payments:** Paymob (Egypt) in test mode for card payments, with signed callbacks, behind a payment-provider interface. Cash on delivery is supported alongside it. Stripe was dropped because it does not support Egyptian merchants. | 2026-11-08 |
| D4 | **Market:** a fictional bakery in Egypt, priced in EGP. | 2026-11-08 |
| D5 | **Language:** English only. UI strings stay centralized so i18n can be added later. | 2026-11-08 |
| D6 | **Delivery fee:** a fixed fee per delivery zone. The owner manages zones, each with a fee and an optional minimum order. | 2026-11-08 |
| D7 | **Guest checkout allowed:** email and phone are required. Guests track orders through a tokenized link in the confirmation email. | 2026-11-08 |
| D8 | **Hosting:** the backend and Postgres run on **Railway**, and the frontend on **Vercel**. Docker Compose stays the local and dev setup. | 2026-11-08 |
| D9 | **Time slots:** fixed two-hour windows, each with a maximum number of orders, for both delivery and pickup. | 2026-11-08 |
| D10 | **Product options:** sizes plus a free-text cake message. No flavour or filling add-ons in v1. | 2026-11-08 |

Note on D3: Paymob test mode is free. Taking real money needs Paymob's business verification. A practice provider (`fake`) lets the whole flow be demonstrated without any account.

## Deferred (not in scope for now)

- Easy-read mode, i.e. plain-language text and simpler checkout.
- Structured allergen data (the UK 14 allergens) and dietary filters.
- Audit trail of status, price and role changes.
- GDPR-style data export and account deletion.
- Bulk and recurring orders.

## Open questions

Tracked in the design phase.
