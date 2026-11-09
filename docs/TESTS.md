# Tests

What is tested, and why. Every test is listed with one line on what it proves. Run them with:

```bash
cd backend  && python -m pytest        # needs the database: docker compose up -d db
cd frontend && npm test
```

**278 backend tests** (pytest, on a real PostgreSQL) and **270 frontend tests** (Vitest, Testing Library, axe). CI runs both on every push, together with the linters, the build, and a check that the database migrations apply, roll back, re-apply and match the models.

## How the tests are built

**Backend**
- Each test runs against a real database (`baker_test`) that is emptied after every test. Nothing is faked at the database level, because the most important rules (nobody buys the last cake twice, a refund that fails changes nothing) depend on real locks and transactions.
- **Time is frozen** (`at(MON)` means Monday 9 November 2026, 08:00 in Cairo) so results never depend on the day or hour the tests run. The login tokens used by the tests are valid at any frozen time.
- Email is collected by a fake sender (`emails`), and `flush()` runs the outbox worker once, as the real worker would.
- Paymob is replaced by a stand-in that records every request, so the tests check exactly what we send and how we read its answers.
- Concurrency tests fire several requests at once with `asyncio.gather` and check the end state.
- Roles are tested together with the feature: each area has a test that customers, staff, guests and the owner get the right answer (200, 401 or 403).

**Frontend**
- The browser's network is switched off. Each test names the API answers it needs (`mockFetch`), so no test can reach a real server.
- Elements are found **by their accessible names** (label, role, button text), the way a screen reader finds them. A control without a usable name makes its test fail.
- Pages that matter are also checked with **axe**, an automated accessibility checker (marked "axe" below).
- The design colours are checked separately for contrast (see `tokens.test.ts`).

---

# Backend tests (`backend/tests/`)

## `test_auth.py`: accounts, sign-in, passwords, startup safety (17)

| Test | What it proves |
|---|---|
| register returns token and lowercases email | A new account is signed in at once and its email is stored in lowercase |
| register duplicate email is 409 even with different case | `Sara@x.com` and `sara@x.com` are the same account |
| register validates password and email | Short passwords and malformed emails are refused with field errors |
| register rejects password over bcrypt limit | A password longer than 72 bytes is refused, not silently cut short |
| login success and me | Signing in works and `/auth/me` returns the user and what they may open |
| login wrong password and unknown email look identical | The error and the timing do not reveal whether an email has an account |
| me requires valid token | No token, a bad token or a tampered token is refused |
| disabled user is rejected | A switched-off account cannot sign in or use an old session |
| token for deleted user is rejected | A token for an account that no longer exists is refused |
| forgot password same response for known and unknown | The reset form answers the same either way, so accounts cannot be discovered |
| reset password flow and single use | A reset link works once, sets the new password, and cannot be reused |
| reset password rejects expired and bogus tokens | Old or made-up reset links are refused |
| first owner is created once | The first owner is created from the environment, and never again |
| guards follow permission map | Each protected area answers customers, staff and owners as the permission table says |
| healthz | The health check answers `ok` (used by Railway) |
| cors origins tolerate quotes spaces and trailing slash | A sloppily typed `CORS_ORIGINS` setting still works (this once broke the live site) |
| production requires r2 storage and complete credentials | In production the app refuses to start without photo storage or with half-set keys |

## `test_admin_catalog.py`: the owner's menu management (16)

| Test | What it proves |
|---|---|
| only owner can manage catalog (customer, staff) | Neither customers nor staff can open the menu management endpoints |
| admin requires login | Signed-out visitors get 401 |
| category slug is unique and stable on rename | Category web addresses never collide and do not change when renamed |
| category validation | Empty or overlong category names are refused |
| archived category hides its products publicly | Archiving a category removes its products from the public menu |
| create product with variants and occasions | A product with sizes, prices and occasions is created in one request |
| product needs a size and valid references | A product with no size, or an unknown category or occasion, is refused |
| update product partially and replace occasions | Changing one field leaves the rest; occasions are replaced as a set |
| archive hides from menu but keeps in admin | Archived products disappear for customers but stay editable |
| variants can be added changed and the last one is protected | Sizes can be edited, but the last active size cannot be removed |
| upload converts to webp and serves it | Uploaded photos are converted to a web format and served |
| upload rejects missing alt text and bad files | A photo without alt text, or a non-image, is refused |
| upload size limit | Oversized files are refused |
| image limit, edit and delete removes file | A product has a maximum number of photos; deleting one also removes the file |
| exif is stripped | Location and camera data inside photos is removed before saving |

## `test_catalog.py`: the public menu (11)

| Test | What it proves |
|---|---|
| public menu needs no login and hides admin fields | Anyone can browse, and internal fields never leak |
| filter by category and occasion | Menu filters return the right products |
| search matches name and description case insensitively | Search finds "CHOC" in "chocolate" in names and descriptions |
| search treats wildcards literally | Typing `%` or `_` searches for those characters, not "anything" |
| sorting | Featured, name, price and newest orderings are right |
| pagination is bounded and consistent | Page size is capped, pages do not overlap, totals are right |
| unavailable and variantless products are not listed | Products switched off or with no size are hidden |
| product detail shows only active sizes | Switched-off sizes are not offered |
| lists use a constant number of queries | The menu does not slow down as products grow (no query-per-product) |
| store info and taxonomy lists | `/store`, categories and occasions return the expected public data |
| demo seed is idempotent and browsable | The demo catalog loads once, and running it again changes nothing |

## `test_schedule.py`: opening hours, time slots, zones, availability (37)

| Test | What it proves |
|---|---|
| schedule is readable by staff but only owner can change it | Staff can look at the schedule, only the owner edits it |
| opening hours validation and idempotent replace | Hours must make sense, and saving the same week twice is harmless |
| store info includes opening hours | The footer data comes from the saved hours |
| slot overlap rules | Two time slots on the same day cannot overlap |
| slot validation and delete | Slots need valid times; deleting works |
| closures | Closed dates can be added, listed and removed, but not in the past |
| delivery zones | Zones with fees and minimum orders are created, edited and deactivated |
| slots with no cart only need the store to be open | Without a cart, any open day offers its slots |
| slots that already started are unavailable | Today's earlier slots cannot be booked |
| lead time boundary is inclusive | A cake needing 48 hours can be booked exactly 48 hours ahead |
| longest lead time in the cart wins | A cart with two products obeys the slower one |
| closed weekday and closure dates | A closed weekday or a holiday offers no slots, with the reason |
| no opening hours configured means closed | A shop with no hours set takes no orders |
| slots outside opening hours are unavailable | A slot cannot sit outside the opening times |
| pickup and delivery see their own slots | Slots for delivery only or pickup only appear for the right choice |
| inactive slots are hidden | Switched-off slots are not offered |
| full slot is marked and others stay open | A slot at its order limit is shown as full; the others stay bookable |
| all slots full explains why | If every slot is full, the day says "fully booked" |
| product weekday rule | A product sold only on certain weekdays cannot be booked on others |
| product availability validation and defaults | Weekday rules need valid days; the default is every day |
| product daily capacity | A product with a daily limit stops at the limit |
| fully booked product message | The message names the product that is fully booked |
| dates overview | The next days are listed with a yes or no and the reason |
| earliest date respects lead time and cart | The earliest date accounts for lead time and quantities |
| dates when nothing is configured | An unconfigured shop reports no dates instead of failing |
| dates use a fixed number of queries | The date overview stays fast however long the period |
| bad items are rejected (7 forms) | `abc`, `1:0`, `1:101`, `0`, `-3`, `1:x` and `,` are refused as cart descriptions |
| unknown or unbuyable items are rejected | Items that do not exist or cannot be bought are refused |
| date and fulfilment validation | Past dates, dates too far ahead and bad delivery types are refused |
| availability is public | Customers need no login to ask what can be booked |
| demo schedule seed is idempotent and bookable | The demo hours load once and produce bookable slots |

## `test_checkout.py`: pricing, placing orders, capacity (33)

| Test | What it proves |
|---|---|
| quote prices lines and delivery | Line totals, subtotal, delivery fee and total are computed on the server |
| quote pickup has no fee and ignores zone | Pickup costs no delivery fee |
| quote ignores prices sent by the client | A customer cannot change the price by editing the request |
| quote without choices is not ready but has no problems | A cart with no date yet is simply "not ready", not an error |
| quote same variant on two lines with different messages | Two cakes with different messages stay separate lines |
| quote below delivery minimum explains how much more | The message says how much more to add, or to choose pickup |
| quote unknown or inactive zone | A zone that does not exist or is off is reported |
| quote flags unavailable lines and excludes them from totals | A product that was just switched off is flagged and not charged |
| quote schedule problems are tagged with their step | Each problem says which checkout step can fix it |
| quote slot that already started or is full | Past or full slots are reported |
| quote respects product lead time | The earliest date follows the product's notice time |
| quote input limits | Carts over the line or quantity limit are refused |
| place cod delivery order | A cash delivery order is created with the right totals and starts as Received |
| place pickup order needs no address or zone | A pickup order needs neither |
| order keeps a snapshot of names and prices | Later menu or price edits never change a past order |
| order is validated | A missing or short idempotency key, no address or zone, an empty cart, zero quantity, bad email or phone, blank name or street, missing building, notes over 500 characters, an unknown delivery type or no slot are each refused, and no order is created |
| card is refused when no provider is set up | Choosing card with no payment provider configured gives a clear refusal and creates no order |
| order below delivery minimum is rejected with the step | The refusal names the step to fix |
| order with unbookable date or slot is rejected (3 forms) | A past date, a closed day (Friday) and a missing slot are each refused |
| order for an archived product is rejected | An archived product cannot be ordered |
| same idempotency key returns the same order once | Sending the same request twice returns the first order (200, not a new 201) |
| concurrent duplicate submissions create one order | Five identical requests at the same instant create exactly one order |
| last unit goes to exactly one of many simultaneous orders | With one cake left and many buyers at once, only one succeeds |
| a slot never takes more orders than its limit | The same for time slots |
| capacity is shared across sizes and checked in units | A product's daily limit counts every size together |
| capacity is per day | Booking Tuesday does not use up Wednesday |
| releasing an order gives the capacity back | A cancelled order frees its cake units and its slot |
| guest reads an order only with the right token | A guest needs the private link; a wrong token gets 404 |
| signed in customer owns their orders and nobody else sees them | A customer sees their own orders; others get the same 404 as for a missing code |
| an expired or invalid login just means guest | A bad token while ordering is treated as a guest, not an error |
| tracking tokens are stable per order and different between orders | The same order always has the same link; two orders never share one |

## `test_payments.py`: the card flow, provider-independent (18)

| Test | What it proves |
|---|---|
| store lists the methods checkout can offer | `/store` says exactly which of cash and card checkout may show |
| at least one method stays on and only the owner changes it | The owner cannot switch both off; staff and customers cannot change them |
| card is refused when not set up or switched off | Card orders are refused if there is no provider or the owner turned it off |
| cash is refused when switched off | Likewise for cash |
| card order waits for payment and holds the slot | An unpaid card order is "waiting for payment" and keeps its slot |
| retrying a card checkout returns the same payment page | A retry does not open a second payment |
| paying confirms the order and sends the email | A verified payment turns the order to Received and queues the confirmation |
| an abandoned payment releases the slot | An unpaid order is cancelled and its slot freed |
| demo payment endpoint is locked down | The practice payment needs the order's private token, accepts only valid outcomes (422 otherwise), and does not exist at all unless the practice provider is active |
| payment link reuses the open page and refuses what cannot be paid | A customer can reopen their payment, but not for paid or cancelled orders |
| cash orders have no payment link | Cash orders cannot be "paid" online |
| if the payment page cannot be opened nothing is kept and a retry works | A provider outage cancels the order cleanly and frees the key for a retry |
| unpaid card orders expire and free their capacity | After 35 minutes an unpaid order is cancelled and the customer is told |
| expiry leaves paid and cash orders alone | The expiry job never touches orders that should stay |
| money arriving after expiry is refunded not kept | A payment that arrives too late is refunded automatically |
| a second payment for an already paid order is refunded | A double payment is returned |
| events are processed once and unknown ones are harmless | A repeated or unknown callback changes nothing |
| refund records partial and full amounts | Partial and full refunds are recorded on the payment and the order |

## `test_paymob.py`: Paymob specifics (36)

| Test | What it proves |
|---|---|
| the signature follows the documented field order | Our check of Paymob's signature uses its published field order |
| missing fields count as empty text and extra fields are not signed | Absent fields are treated as Paymob does, and extras are ignored |
| payment status screen reports paymob without secrets | The owner screen shows the provider and mode, never a key |
| live keys are reported as live mode | A live key shows "live", a test key "test" |
| paymob configuration is validated | The app refuses to start with Paymob selected but keys missing |
| the payment intention is built from the order | The request to Paymob has the right amount, items, billing data and reference |
| pickup orders have no delivery item and long names are trimmed | No delivery line for pickup; long names fit Paymob's limits |
| a single word name still fills the required last name | One-word names do not make Paymob reject the request |
| a callback address is only sent when the API is publicly reachable | Local development does not send an unreachable address |
| if paymob refuses the order is cancelled and the slot freed (400, 401, 404, 500) | Any Paymob error cancels the order cleanly |
| if paymob cannot be reached the order is cancelled | A network failure does the same |
| a valid callback marks the order paid | A correctly signed callback confirms the order |
| the callback works with an uppercase signature | Letter case in the signature does not matter |
| the same callback delivered many times is applied once | Repeats (even simultaneous) change nothing and send one email |
| callbacks that do not carry a valid signature are rejected (6 forms) | A wrong secret, changed amount, missing, garbage, empty or other transaction's signature is refused |
| a forged success for someone else's order cannot pay this one | A valid signature for another order cannot confirm this one |
| callbacks we do not act on still get a 200 | Declines and refund notices are acknowledged and ignored |
| the callback address is hidden unless paymob is the provider | The owner sees the address only when it matters |
| the old stripe address no longer exists | The removed Stripe endpoint is gone |
| a signature problem is logged with the signed text to help setup | A bad signature logs what we computed, without secrets |
| money that arrives after the order expired is refunded | A late payment is refunded through Paymob |
| refund requests use the secret key and the paid transaction | Refunds are sent for the right transaction with the right key |
| a full refund falls back to a void when paymob has not settled it | If a refund is refused, a same-day void is tried |
| a refund paymob has only initiated counts as accepted | A refund Paymob reports as "pending" is a success |
| a refund answered with 201 created is accepted | Paymob's real answer (201 Created) is understood (found in production logs) |
| a refund paymob refuses is reported not recorded | A refused refund is an error, not marked as refunded |
| a refund without a transaction id is refused up front | We never ask Paymob to refund a payment we cannot identify |
| expiring an order does not need paymob | Cancelling an unpaid order works even if Paymob is down |

## `test_notifications.py`: emails and the outbox (26)

| Test | What it proves |
|---|---|
| a cash order queues its confirmation in the same transaction | The email is saved together with the order, so it cannot be lost |
| the cake message and pickup details appear in the email | The email shows the message to write and where to collect |
| a mail outage never loses or blocks an order | If the mail service is down, the order still succeeds |
| failed emails back off then stay visible and can be retried | Failed sends retry with growing delays, then show as failed and can be retried by hand |
| the worker sends in batches | 25 waiting emails go out 20 at a time, then the last 5 |
| the background worker sends as soon as it is woken | Emails leave within moments, not on the next tick |
| every template renders with sample data and uses only its variables | All 9 emails render and only use their allowed details |
| unsafe or broken wording is refused (7 forms) | Missing variables, broken syntax, and attempts to reach Python internals or include files are refused |
| a template cannot use variables that belong to another email | Each email only gets its own details |
| templates are listed with their variables | The owner screen lists every email and what can be inserted |
| editing wording changes the next email and reset restores it | Edits apply to new emails; "restore" goes back to the original |
| invalid wording is refused with a clear message and nothing is saved | A broken edit changes nothing |
| preview renders with sample data and reports errors | The live preview works and shows mistakes |
| switching a template off stops that email | A disabled email is not sent |
| only the owner manages emails | Staff and customers cannot edit wording or read the log |
| email log lists newest first | The log shows the latest emails first |
| the test email button reports success and failure | "Send me a test email" reports both outcomes |
| brevo request is built correctly | The Brevo request has the right address, headers and body |
| brevo accepts a bare sender address and reports errors | A plain sender works; Brevo's errors and outages become clear messages |
| the provider in use follows configuration | No key means the log, a Brevo key means Brevo |

## `test_staff_orders.py`: the staff order queue (23)

| Test | What it proves |
|---|---|
| only staff and owner reach the queue | Customers and signed-out visitors are refused |
| the queue lists orders and filters them | Day, stage, delivery or pickup, and search (name, code, phone, email) work; `%` is plain text |
| unpaid card orders stay out of the queue | Orders waiting for payment are invisible to staff and cannot be acted on |
| summary counts by status | The tab counts are right |
| the detail lists the allowed next steps | The server says which buttons to show |
| a delivery order goes through every stage | Accepted, preparing, ready, out for delivery, delivered, with history and emails |
| a pickup order is collected not delivered | Pickup ends at "collected" and cannot go out for delivery |
| stages cannot be skipped or repeated | Impossible moves are refused with 409 |
| the owner can work the queue too | Owners have the same queue rights as staff |
| rejecting gives back the slot and tells the customer | Declining requires a reason, frees capacity and emails the reason |
| cancelling an accepted order needs a reason and frees capacity | Same for staff cancellation |
| the freed slot can be booked again | Freed capacity can really be sold |
| two staff rejecting at once release the capacity once | Simultaneous decisions free the slot exactly once |
| rejecting a paid card order refunds it | A card refund happens with the decline |
| a failed refund changes nothing | If the refund fails, the order stays as it was and says why |
| a cash order needs no refund | Cash orders skip the refund |
| marking late tells the customer and can be cleared | The late flag emails the customer and can be removed |
| a finished order cannot be marked late and loses its flag | Late only applies to open orders and clears at the end |
| staff can message the customer | A message is emailed and kept on the order |
| cash collected is recorded once | "Cash collected" works once |
| cash cannot be recorded on a card order | Card orders cannot be marked as cash-paid |
| cash cannot be recorded on a rejected order | Nor dead orders |
| the prep sheet adds up a day | Quantities per product and size and the cake messages, excluding declined orders |

## `test_customer_orders.py`: policy, cancel, change (27)

| Test | What it proves |
|---|---|
| the owner sets the window and the refund policy | The owner edits the policy; the wording customers read updates; others are refused |
| nonsense policies are refused (5 forms) | Negative or huge windows, 0% or 100% "percentage", and unknown policies are refused |
| the order says until when it can be changed | The deadline is exactly the slot start minus the window |
| a guest cancels with their link and the slot is freed | A guest can cancel; capacity returns; the email says so |
| cancelling is refused once the window has closed | After the deadline, cancelling is refused |
| the owner can make the window shorter | A shorter window lets customers cancel later |
| an accepted order can still be cancelled but not one being prepared | Cancelling stops at preparation |
| only the customer can cancel their order | Wrong tokens, strangers, staff and signed-out visitors get 404 |
| two cancel requests at once free the slot only once | Triple-clicking cancels once |
| a full refund policy returns everything | Card cancellations refund the full total |
| a percentage policy keeps the rest | 80% returns 80% and records a partial refund |
| a no refund policy cancels without touching the payment | The payment is left alone and the email says no refund |
| a failed refund leaves the order as it was | A refund failure cancels nothing |
| changing the time slot moves the reservation | The old slot is freed and the new one taken, never counted twice |
| changing the date moves the reservation to that day | Moving to another day moves the capacity |
| a full slot is refused and nothing changes | A refused change leaves the original booking untouched |
| changing only the address or notes does not recheck the date | Address and note edits are never blocked by the clock moving on |
| a cash order can move to an area with another fee | The fee and total follow the new area |
| a paid card order cannot change its delivery fee | A paid order keeps its total |
| a card order can change its slot | Time changes are fine for paid orders |
| other changes are refused with a clear reason | No changes, unknown areas, pickup with address, past dates and closed windows each have a clear refusal |
| only the customer can change their order | Strangers get 404 |
| a change and a staff action at the same time stay consistent | A customer change racing a staff rejection ends in one valid state |

## `test_account.py`: profile, addresses, history, cart (13)

| Test | What it proves |
|---|---|
| a customer edits their name and phone | Profile edits are saved and trimmed |
| profile changes are checked and need a login | Bad names and phones are refused; role and email cannot be changed here |
| saved addresses can be created listed edited and deleted | Full address management |
| only one address is the default | Choosing a default unsets the old one |
| addresses belong to one person only | Other customers cannot see, edit or delete them |
| address input is checked | Blank streets and unknown zones are refused |
| there is a limit on saved addresses | A customer can save at most 10 |
| order history lists only my orders newest first | History shows only your own signed-in orders |
| order history is paged | Long histories page correctly |
| a cart is saved on the account and comes back | The cart is stored per account and replaced as a whole |
| carts are private to each account | Nobody reads another account's cart |
| nonsense carts are refused | Zero or huge quantities, bad ids and over 30 lines are refused |
| two tabs saving at once keep one cart row | Simultaneous saves never create duplicate carts |

## `test_team.py`: team, password, shop details, demo accounts (21)

| Test | What it proves |
|---|---|
| only the owner manages the team | Staff, customers and guests are refused |
| the list has staff and owners but no customers | The team list has the right people and no password data |
| a new staff member can sign in and work the queue but not manage | Staff accounts have exactly staff rights |
| a new owner can manage the team | Owner accounts have owner rights |
| bad accounts are refused | Short passwords, bad roles and emails, and duplicate emails (even a customer's) are refused |
| removing a member switches the account off and ends their session | A removed person is signed out at once and cannot sign in, but can be switched back on |
| a role can be changed | Promoting staff to owner works |
| nobody can lock themselves or the shop out | You cannot demote, switch off or remove yourself |
| two owners cannot remove each other at the same moment | A race between two owners always leaves one owner |
| the last owner rule itself | The "last active owner" safeguard works when applied directly |
| unknown and customer ids are not found | Customers cannot be managed as team members |
| changing a password | Wrong current, same, and weak passwords are refused; the old password stops working |
| the owner edits the shop details and customers see them | Details saved by the owner show on the public `/store` |
| nonsense shop details are refused (5 forms) | Bad phones, emails and overlong text are refused |
| only the owner changes the shop details | Staff and customers are refused |
| emails use the shop name and pickup details | Order emails carry the owner's shop name and pickup place |
| demo accounts exist only when a password is set | Demo accounts are created only with `DEMO_PASSWORD`, once, and work |

---

# Frontend tests (`frontend/src/`)

## `test/tokens.test.ts`: colour contrast of the design (40)

The browser test environment cannot measure colours, so the design colours themselves are checked. The same checks run for the normal and the high-contrast theme.

| Test | What it proves |
|---|---|
| text colour on background pairs are at least 4.5:1 (16 pairs per theme) | Body text, muted text, button text, error and success text, and links and text on the warm tint band are readable (WCAG 1.4.3) |
| borders and the focus ring are at least 3:1 (4 pairs per theme) | Form borders and the keyboard focus ring can be seen (WCAG 1.4.11) |

## `App.test.tsx`: sign-in, route guards, display settings (14)

| Test | What it proves |
|---|---|
| login, register, forgot password, reset password and home have no axe violations (5) | The basic public pages pass the accessibility checker |
| has a skip link and a single h1 | A "skip to content" link exists and each page has one main heading |
| signs in, loads permissions and lands on the account page | Signing in stores the session and shows what the user may open |
| shows a focused error summary on a wrong password and keeps the user on the page | A failed sign-in tells you what went wrong and moves focus to the message |
| links field errors to inputs with aria-describedby | Registration errors are tied to their fields for screen readers |
| redirects signed-out visitors from /account to sign in | Private pages need a login |
| clears a stale token and redirects when the session has expired | An expired session ends cleanly |
| keeps signed-in users away from the sign-in page | Signed-in visitors are sent on to their account |
| toggles high contrast and text size on the page and remembers them | Display preferences apply and persist |
| closes the Display panel with Escape and returns focus to its button | The display menu is keyboard friendly |

## `catalog.test.tsx`: menu, product page, owner's menu screens (22)

| Test | What it proves |
|---|---|
| formats minor units without float surprises | Prices such as 650.00 are shown exactly |
| parses prices strictly | `abc`, `-5`, `1.234`, `0`, `1,5` and empty are rejected |
| describes lead times | "Order at least 2 days ahead" wording |
| home is a photograph, the menu groups with prices, and the visit details, with no axe violations | The home page: the hero photograph, a menu group per category with prices, the visit block, the credits line, and accessibility |
| menu lists products with photos, alt text and prices, and has no axe violations | Each product shows an image with alt text and its price |
| filters by category and sorts, sending the choice to the API | Picking a category pill and a sort option in the Filters panel reaches the server |
| debounces typing into a single request | Typing "chocolate" sends one search, not nine |
| shows a friendly empty state and can clear filters | "No products" with a way back |
| shows an error with a retry button when the API fails | Failures are explained and recoverable |
| paginates with Previous and Next | Paging works |
| shows details and switches the price when another size is chosen | The product page price follows the size |
| gallery thumbnails switch the main photo and expose alt text | Photo gallery works accessibly |
| explains a missing product | An unknown product page says so |
| hides the manage link and blocks the pages for customers | Customers do not see or reach owner pages |
| sends signed-out visitors to sign in | Owner pages need a login |
| lets the owner see the product table, accessibly | The product table has headers and a caption |
| archives a product and announces it | Archiving works and is announced |
| validates the new-product form: server errors are linked to fields and summarised | Form errors appear on their fields and in a summary |
| rejects a malformed price before calling the API | Bad prices are caught in the browser |
| requires alt text before uploading a photo | A photo cannot be uploaded without a description |
| edit page has no axe violations | The product editor passes the checker |
| categories page adds a category | Adding a category works |

## `schedule.test.tsx`: schedule, zones, roles, customer-facing hours (21)

| Test | What it proves |
|---|---|
| parses ISO dates without a timezone shift and formats times | Dates and times display correctly |
| accepts zero for amounts like free delivery | A delivery fee of 0 is valid |
| shows hours, slots grouped by day and closed dates, with no axe violations | The schedule screen content and accessibility |
| saves opening hours as seven day entries | Saving sends all seven days |
| refuses opening times that are not before closing times, without calling the API | The browser catches impossible hours |
| adds a time slot and shows the server's overlap message | Overlaps are explained |
| edits a slot's capacity and asks before deleting | Editing works; deleting asks first |
| adds and removes closed dates | Holiday management |
| staff can see the schedule but not change it, and do not see catalog links | Staff see a read-only schedule |
| staff are blocked from the catalog pages | Menu management is owner-only |
| customers are blocked from the schedule | Customers cannot open it |
| the owner is sent to Products from /admin and sees every area in the nav | The owner's navigation is complete |
| lists zones with fees and inactive state, with no axe violations | Delivery zone list |
| adds a zone with free delivery (fee 0) in minor units | Free-delivery zones save correctly |
| rejects malformed amounts before calling the API | Bad fees are caught in the browser |
| staff see zones read-only | Staff cannot edit zones |
| shows opening hours in the footer | Customers see the hours |
| the delivery page lists areas, fees and minimums, including free delivery | The delivery information page |
| product page shows the earliest delivery and pickup dates for the cart | Customers see when they can get a product |
| product page says so when there are no dates soon | And when they cannot |
| saves the weekdays a product is sold | Weekday rules save |

## `checkout.test.tsx`: cart, checkout, order tracking (30)

| Test | What it proves |
|---|---|
| adds a product with a message, announces it and updates the header count | Adding to the cart works and is announced |
| merges the same item and message, but keeps different messages on separate lines | Same item adds up; different messages stay separate |
| clamps absurd quantities and survives a corrupted saved cart | Silly quantities and broken saved data cannot break the cart |
| drops invalid saved lines | Bad saved items are discarded |
| prices the lines from the server and has no axe violations | The cart shows server prices and passes the checker |
| changes quantity, asks the server again, and removes lines | Quantity edits re-price; removal works |
| shows the cake message in the cart but does not let it be edited there | The message is read-only in the cart |
| flags lines that are no longer available and blocks checkout until they are removed | Unavailable items stop checkout |
| shows a friendly empty cart | Empty cart message |
| warns when prices cannot be checked | A pricing outage is explained |
| walks through every step and places a cash-on-delivery order | The full happy path |
| does not send prices or totals from the browser | The server decides every price |
| explains a missing cart | Checkout with an empty cart explains itself |
| step 1 refuses to continue without an area and address, with a focused error summary | Required address fields |
| shows the server's below-minimum message on the step that can fix it and blocks Continue | Minimum-order rule shown where it can be fixed |
| lists only bookable dates, disables full slots and warns when few remain | Date and slot picking |
| step 2 needs a date and a time | Required schedule |
| step 3 validates the contact details | Name, email and phone checks |
| pickup skips the address and sends no zone | Pickup flow |
| a double click places exactly one order | Double submission is blocked |
| sends the customer back to the right step when the slot was just taken, then reuses or renews the key sensibly | A race for the last slot is handled |
| retrying the same order reuses its Idempotency-Key | A retry cannot duplicate the order |
| prefills the contact step for a signed-in customer | Known details are filled in |
| each step is accessible | Every checkout step passes the checker |
| shows status, progress, schedule, items and totals, and has no axe violations | The order page |
| pickup orders have a shorter progress and no delivery fee | Pickup orders show a shorter progress |
| explains declined and cancelled orders, with the reason | The reason is shown |
| shows a late-order notice | The late warning |
| does not show the thank-you banner when the page is simply opened again | The banner is only for a just-placed order |
| gives a helpful message for an unknown or unauthorised order | Unknown orders get a friendly message |

## `payments.test.tsx`: paying and the owner's payment and email screens (29)

| Test | What it proves |
|---|---|
| offers card when the shop supports it, and sends the customer to the payment page | Card checkout redirects |
| explains when card is not available and keeps cash selectable | Card unavailable message |
| when cash is switched off, only card is offered and selected | Cash-off behaviour |
| shows a payment-start failure and lets the customer try again | Payment page failure |
| invites the customer to pay and opens a payment page on request | "Pay by card" on a waiting order |
| says so when the time to pay has run out | Expired payment |
| treats a failed payment reported by Paymob on the way back as not completed, even if the link says paid | A failed payment is never shown as paid |
| a successful return from Paymob waits for the confirmation instead of trusting the link | Only the signed confirmation counts |
| after cancelling on the payment page it explains and offers to pay again | Cancelled payment |
| keeps checking until the confirmation arrives, without asking to pay again | The page updates itself |
| shows refunds and cancellation for an order whose payment arrived too late | Late payments are explained |
| makes clear it is practice, shows the amount, and completes the payment | The practice payment page |
| cancelling reports an expired payment | Practice-page cancel |
| shows server problems | Practice-page errors |
| is for the owner only | Payments screen access |
| shows the provider status and webhook address, and has no axe violations | Owner status panel |
| saves the payment switches and reports server refusals | Payment toggles |
| shows the server's message when both methods are switched off | Cannot switch both off |
| explains when card is not set up on the server | Not-configured message |
| sends a test email and reports the result either way | Test email button |
| shows why a test email failed | Failure reason shown |
| describes a connected email service | Shows the sender |
| names Brevo when that is the connected service | Brevo shown by name |
| lists the insertable details for the chosen email and saves edits | Email wording editor |
| switches to another email and offers to restore an edited one | Template switching and restore |
| previews with sample details and shows wording the server refuses | Live preview |
| shows why wording cannot be saved | Save errors |
| lists emails, filters by status and retries a failed one | Email log and retry |
| says when there is nothing to show | Empty log |

## `staff.test.tsx`: the order queue, order detail, prep sheet (21)

| Test | What it proves |
|---|---|
| shows the Orders link to staff and the owner, and keeps customers out | Menu link by role |
| tells a customer they cannot open the queue | Not-allowed page |
| sends /staff to the queue | Redirect |
| lists the day's orders with counts per stage and no axe violations | Queue content, stage counts, accessibility |
| marks late orders with text, not colour alone | "Late" is written, not only coloured |
| asks for the chosen stage, delivery type and search text | Filters reach the server |
| says so when nothing matches | Empty queue |
| opens an order found by code from another page on any day | Links from the prep sheet |
| shows everything staff need to prepare and deliver the order | Order detail |
| only offers the steps the server allows | Buttons follow the server |
| accepts the order and shows the next steps the server returns | Accept flow |
| does not send a second request on a double click | Double click safety |
| will not decline without a reason, then sends it | Reason required |
| warns that a paid card order is refunded when it is cancelled | Refund warning |
| shows the server's message when something fails, and keeps the order as it was | Failed actions |
| marks the order late and can remove the flag | Late flag |
| emails the customer and lists what was sent | Contact the customer |
| records cash collected | Cash button |
| explains when an order cannot be found | Missing order |
| adds up what to make and lists the cake messages, with no axe violations | Prep sheet |
| says when there is nothing to make | Empty prep sheet |

## `customerOrders.test.tsx`: customer cancel and change (16)

| Test | What it proves |
|---|---|
| tells the customer until when they can change the order and what the rules are | Deadline and policy text |
| explains that the time has passed instead of offering buttons | After the window |
| offers nothing once the bakery is preparing the order | During preparation |
| asks for confirmation, then cancels and shows the result | Cancel flow |
| says how much of a card payment comes back before the customer decides | Refund amount shown first |
| says plainly when the policy keeps the payment | No-refund policy shown |
| shows the server's reason when cancelling fails, and keeps the order | Cancel errors |
| does not send a second cancel on a double click | Double click safety |
| shows the current details and keeps the items out of reach | Change page content |
| saves new notes and address, then returns to the order with a confirmation | Change flow |
| sends the new date and time when the customer picks them | Rescheduling |
| asks for a time when only a new date was chosen | Date needs a time |
| shows why the bakery cannot make the change | Server refusals |
| only offers areas with the same delivery fee to a customer who has paid | Paid orders keep their total |
| says the order cannot be changed any more | Closed window |
| a signed-in customer can change their order without the link token | Account access |

## `account.test.tsx`: account pages, checkout addresses, owner policy (17)

| Test | What it proves |
|---|---|
| has a profile, orders and addresses section, with no axe violations | Account navigation |
| saves a new name and phone | Profile edit |
| shows what the server did not accept | Profile errors on fields |
| lists the orders with their status and a link to each | Order history |
| has a friendly empty state | No orders yet |
| pages through longer histories | Paging |
| lists them and marks the default | Saved addresses |
| adds an address | Add flow |
| edits an address | Edit flow |
| asks before deleting | Delete confirmation |
| shows field errors from the server on the field | Address errors |
| fills in the default address and lets the customer pick another | Checkout uses saved addresses |
| does not overwrite an address the customer already typed | Typing wins |
| shows no saved-address picker to a guest | Guests see no picker |
| shows the current policy and what customers read, with no axe violations | Owner policy screen |
| saves a percentage policy and shows the new wording | Policy save |
| shows a refused policy | Policy errors |

## `cartSync.test.tsx`: the cart follows the account (8)

| Test | What it proves |
|---|---|
| brings back the cart saved on the account when someone signs in | Restore on sign-in |
| saves changes to the account | Changes are saved |
| saves an emptied cart too | Emptying is saved (after an order) |
| merges what a guest added with the account's cart | Guest items are kept |
| never saves before the account's own cart has arrived | An empty cart can never wipe the saved one |
| does not save anything when the saved cart could not be loaded | No saving after a failed load |
| does not hand one account's leftover cart to a different account | No cart inheritance between accounts |
| empties the cart on this browser but keeps it on the account | Sign out and back in |

## `signout.test.tsx`: signing out (3)

| Test | What it proves |
|---|---|
| goes straight to the sign-in page, ends the session and empties the cart | Sign-out from the account page |
| also leaves a public page, where nothing else would send the visitor away | And from public pages |
| does not hand the previous account's cart to the next person who signs in | Shared browsers |

## `store.test.tsx`: shop information stays current (3)

| Test | What it proves |
|---|---|
| picks up a policy the owner changed after this page was first opened | Navigating refreshes the shop info |
| looks again when the visitor comes back to the tab | Returning to the tab refreshes it |
| keeps showing what it had when the shop cannot be reached | A server outage does not blank the page |

## `team.test.tsx`: team, shop details, contact details, password (16)

| Test | What it proves |
|---|---|
| lists the team with roles and status, and no actions on your own account | Team list |
| adds a staff member and tells the owner what to hand over | Add flow, password not kept |
| shows why an account could not be added | Add errors |
| changes a role | Role change |
| asks before removing someone, then removes them | Removal confirmation |
| switches a removed account back on | Re-activation |
| shows the server's reason when a change is refused | Refusals (last owner) |
| is closed to staff, who do not even see the link | Owner only |
| loads and saves the details | Shop details form |
| shows a refused value on its field | Shop details errors |
| shows contact details in the footer and the shop's own name | Customers see the details |
| shows no contact section while the owner has not filled it in | No empty section |
| tells a pickup customer where to collect, at checkout and on the order page | Pickup place (checkout) |
| shows the pickup place on the order page | Pickup place (order) |
| changes it and clears the fields | Password change |
| shows a wrong current password on its field | Password error |

## `a11y.test.tsx`: accessibility of remaining pages (13)

| Test | What it proves |
|---|---|
| the not-found page | No axe violations |
| the not-allowed page | No axe violations |
| the owner's categories page and occasions page (2) | No axe violations |
| the order page in six states: waiting for payment, running late, cancelled, declined, delivered, still changeable (6) | No axe violations in each |
| the display menu, open | No axe violations |
| the skip link is the first thing a keyboard user reaches and it targets the main content | First Tab stop is "skip to content" |
| every page has exactly one level-one heading | Page structure on four routes |

## `ui.test.tsx`: header, account menu, menu filters, shared look (17)

| Test | What it proves |
|---|---|
| is short for a visitor: three words, the name, cart, sign in and display | The header holds Menu, Delivery and Visit on the left, the name in the middle, and cart, sign in and display on the right |
| keeps everything about the signed-in person in one account menu | My account, My orders, the email and Sign out sit in one menu that starts closed |
| offers staff and owners their extra areas, and keeps Orders one click away | Orders stays in the header; Manage shop and Prep sheet are in the menu |
| staff see the queue but not the shop settings they cannot change | Role-based items in the menu |
| closes the menu with Escape and puts focus back on its button | Keyboard behaviour of the account menu |
| closes the menu when the visitor clicks elsewhere or follows a link | Outside click and link click close it |
| has no axe violations with the account menu and the display menu open | Both open menus pass the accessibility checker |
| shows a search bar, category pills and one Filters button, nothing else | The menu's top area is just those three things |
| opens the panel with occasion and sort, and counts what is active | The Filters panel holds occasion and sort, shows "Filters, 2 active" and a summary line |
| picking a category narrows the request, and the pill shows it is selected | Category pills work like radios and reach the server |
| clears everything with one button, and the button only appears when something is set | One "Clear filters" resets search, category and panel |
| closes the panel with Escape | Keyboard behaviour of the Filters panel |
| has no axe violations with the panel open | The open panel passes the checker |
| the 404 page offers one way home | One clear button on the not-found page |
| the home page lists up to five products with a price in each group | Each menu group on the home page shows at most five products |
| the home page says whether the bakery is open, from the hours the owner set | The "Open now, until ..." line comes only from real opening hours |
| the order page shows progress as a list with done, current and not-yet steps | The timeline marks each step and announces done, current and not yet |
