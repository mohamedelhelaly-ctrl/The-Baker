# User acceptance tests (UAT)

A test script for the whole platform, written per kind of user: the **visitor** (not signed in), the **customer** (signed in), **staff**, and the **owner**, followed by checks that cut across all of them (emails, payments, time, security, accessibility, devices, deployment).

Each row is one test: what to do, what you must see. Run them on the live site, or locally (see `README.md`), and tick the box when the result matches. When it does not, write the test ID and what you saw in the **Defect log** at the end.

## Contents

| Section | For | Test ID prefix |
|---|---|---|
| 0 | Setup: accounts, shop data, test card, what is by design | none |
| 1 | Visitor: home page | V-HOME |
| 2 | Visitor: header, footer and display settings | V-NAV |
| 3 | Visitor: the menu | V-MENU |
| 4 | Visitor: product page | V-PROD |
| 5 | Visitor: cart | V-CART |
| 6 | Visitor: checkout (cash and pickup) | V-CO |
| 7 | Visitor: paying by card | V-PAY |
| 8 | Visitor: tracking, changing and cancelling an order | V-TRK |
| 9 | Visitor: register, sign in, password reset | V-AUTH |
| 10 | Customer: account, addresses, orders, cart, security | C-ACC, C-ADDR, C-ORD, C-CART, C-SEC |
| 11 | Staff: access, queue, one order, prep sheet | S-ACC, S-Q, S-ORD, S-PREP |
| 12 | Owner: catalog, schedule and zones, payments, emails, policies, shop details, team | O-CAT, O-PRD, O-SCH, O-ZON, O-PAY, O-MAIL, O-POL, O-SHOP, O-TEAM |
| 13 | Everyone: emails, data, time, security, accessibility, devices, resilience, deployment | X-MAIL, X-DATA, X-TIME, X-SEC, X-A11Y, X-DEV, X-RES, X-DEP |
| 14 | The 30-minute smoke path | none |
| 15 | Defect log | none |
| 16 | Sign-off | none |

## How to use this document

| Priority | Meaning | Run it |
|---|---|---|
| **P1** | The main flow. If it fails, the site cannot do its job. | Every release |
| **P2** | Important behaviour and the common mistakes people make. | Every release |
| **P3** | Corner cases: unusual input, timing, limits, races. | Before a demo or a go-live |

- **Run in order within a section.** Later tests reuse what earlier ones created (an order, an address).
- **"Expected" is the whole truth.** Anything extra, missing or worded differently is a finding.
- **Use a private browser window per user**, so two people signed in at once do not share a session.
- **Times are Cairo time.** The shop's day, slots and cut-offs all use Africa/Cairo, whatever your computer's clock says.
- **Messages in quotes are the exact wording** the site should show.

## 0. Setup (do this once before testing)

### 0.1 Accounts

| Name | Role | Used for |
|---|---|---|
| `owner` | Owner | The owner screens (section 12). Created from the `FIRST_OWNER_*` settings. |
| `staff` | Staff | Created by the owner in test O-TEAM-02. |
| `customer1` | Customer | Registered in V-AUTH-01. |
| `customer2` | Customer | A second customer, to prove people cannot see each other's data. |
| `guest` | none | Any private window that is not signed in. |

Use real addresses you can read for every email you register, so you can check the emails in section 13.1.

### 0.2 Shop data the tests assume

Set this up as the owner first (or use the demo data), then note the real values here so the expected results are easy to check:

| Item | Needed |
|---|---|
| Opening hours | Open every day except one closed weekday (call it **closedDay**). Note a day with different hours (for example Friday from 13:00). |
| Time slots | At least three slots per day, each two hours, each with a small **order limit** (2 is ideal so a slot fills quickly). One slot that is **pickup only**. |
| Delivery zones | **Zone A** with a fee and no minimum, **Zone B** with a different fee and a **minimum order**, and an **inactive zone**. |
| Closed dates | One closed date in the next two weeks (call it **holiday**). |
| Products | A cake with a long **lead time** (48 hours or more), a bread with **same-day** lead time, one with a **daily capacity of 3**, one sold only on certain weekdays, one **archived**, one **switched off**, one with **three sizes**. |
| Policies | Window **24 hours**, refund **full**. (You will change it in section 12.) |
| Payments | Cash **on**. Card **on** with Paymob test keys (or the practice provider locally). |
| Email | A working sender so emails arrive; a second run with it off for the "log only" case. |

### 0.3 Paymob test details (card payments)

Visa `4111 1111 1111 1111` or Mastercard `5123 4567 8901 2346`, expiry `01/39`, CVV `123`, name `Test Account`. Test wallet `01010101010`, PIN and OTP `123456`.

### 0.4 Things that are by design (not defects)

- Card refunds show as **Refunded** here at once, but the bank may take up to 7 days to return the money.
- A customer **cannot edit the items** of an order, only the date, time, area, address and notes. To change items they cancel and order again.
- Orders placed **as a guest are never added to an account**, even with the same email.
- There is **no email verification** when registering.
- The weekly opening hours appear **once** on the home page, in the footer.
- Product pictures are placeholders until the owner uploads real ones.
- Emails sent from a Gmail address can land in **spam**.
- `Practice payments` only exist when the server is set to the practice provider (never on the live site).

---

## 1. Visitor: home page, navigation and display

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-HOME-01 | P1 | Open the site address as `guest`. | The home page loads with the cover picture, the headline "Bakery in Cairo, baked to order", a line with today's opening time, and an **Order now** button. | ☐ |
| V-HOME-02 | P1 | Click **Order now**. | You land on the menu page. | ☐ |
| V-HOME-03 | P2 | Look at **Our favourites**. | Exactly four product tiles (picture and name, no prices), each linking to its product. A "See the whole menu" link goes to the menu. | ☐ |
| V-HOME-04 | P2 | Click a favourite tile. | That product's page opens. | ☐ |
| V-HOME-05 | P2 | Read **About us**. | The line "A little bakery, a lot of love, and flavors worth coming back for." and a short paragraph, with the baker drawing beside it (under it on a phone). | ☐ |
| V-HOME-06 | P2 | Scroll to the bottom. | One footer strip with four aligned columns in this order: **Visit**, **Delivery and pickup**, **Opening hours**, **Shop**. No separate Visit section above it. | ☐ |
| V-HOME-07 | P2 | In **Visit**, read the address. | "Road 9, Maadi" then "Cairo, Egypt", an open-now line ("Open now, until …" or "Closed, opens …"), and a **Get directions** link. | ☐ |
| V-HOME-08 | P3 | Click **Get directions**. | A map search for the address opens in a new tab. | ☐ |
| V-HOME-09 | P2 | Look at **Opening hours** in the footer. | All seven days with their times, matching the owner's hours. They appear nowhere else on the home page. | ☐ |
| V-HOME-10 | P3 | As owner, change the opening hours, reload the home page. | The hero line, the open-now line and the footer table all show the new hours. | ☐ |
| V-HOME-11 | P3 | As owner, mark every day closed, reload. | The hero line has no opening time ("Cakes, pastries and bread, for delivery or pickup."), the open-now line is not wrong, the footer says hours are set by the bakery or shows "Closed". | ☐ |
| V-HOME-12 | P3 | As owner, change the featured products so five are featured, reload. | Only four favourites show, never more. | ☐ |
| V-HOME-13 | P3 | As owner, set the shop address, phone, WhatsApp and email in **Shop details**, reload. | The footer shows your address instead of the default, and a **Contact** list with working phone, WhatsApp and email links. | ☐ |
| V-HOME-14 | P3 | Make the API unreachable (turn off the network after loading), then reload. | The page does not crash. The hero still shows; lists that need the API show nothing or an error, never a blank white page. | ☐ |
| V-HOME-15 | P2 | Open the home page on a phone (or narrow the window to 390px). | The hero picture, one full-width **Order now** button, favourites two per row, About text then the drawing, the footer columns stacked. No sideways scrolling. | ☐ |
| V-HOME-16 | P3 | On the phone, scroll past the hero button. | A fixed **Order now** bar appears at the bottom. Scrolling back up to the hero hides it. | ☐ |
| V-HOME-17 | P3 | On the phone, scroll to the very end of the page. | The bottom bar never hides the last footer line. | ☐ |
| V-HOME-18 | P3 | Turn on "Reduce motion" (or your system setting) and reload. | The hero picture and headline appear at once, nothing slides or fades in. | ☐ |

## 2. Visitor: header, footer and display settings

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-NAV-01 | P1 | Look at the header as `guest`. | Left: **Menu**, **Delivery**, **Visit**. Middle: the shop name (links home). Right: **Cart**, **Sign in**, **Display**. | ☐ |
| V-NAV-02 | P2 | Click each header word. | Menu and Delivery open their pages. **Visit** scrolls to the footer strip on whatever page you are on. | ☐ |
| V-NAV-03 | P2 | Hover over a header word. | An underline draws under it. The current page's word has a bar under it. | ☐ |
| V-NAV-04 | P2 | Add an item to the cart. | The cart shows a number badge with the count. | ☐ |
| V-NAV-05 | P2 | Click the shop name. | You go to the home page. | ☐ |
| V-NAV-06 | P1 | Open **Display**. Choose **Large**, then **Extra large**. | The whole site's text grows each time. The panel stays inside the screen. | ☐ |
| V-NAV-07 | P2 | In Display, switch on **High contrast**. | Colours turn to black on white, borders become heavier, links underlined, every page stays readable. | ☐ |
| V-NAV-08 | P2 | Reload the page and open another page. | Your Display choices are remembered. | ☐ |
| V-NAV-09 | P2 | Press **Escape** with Display open. | It closes and focus returns to the Display button. | ☐ |
| V-NAV-10 | P3 | Click anywhere outside the open Display panel. | It closes. | ☐ |
| V-NAV-11 | P2 | On a phone, check the header. | The name and the right-hand items on the first row, the three words on the second. The cart is an icon with its count, Display shows "Aa". Nothing overflows. | ☐ |
| V-NAV-12 | P2 | Press Tab from the top of any page. | The first stop is "Skip to main content"; pressing Enter jumps to the main content. | ☐ |
| V-NAV-13 | P3 | Open a page that does not exist (for example `/nowhere`). | A "Page not found" page with one **Home** button. Header and footer still work. | ☐ |
| V-NAV-14 | P3 | Look at the footer on the menu page and the cart page. | The same four-column strip as the home page (the header's Visit word still scrolls to it). | ☐ |
| V-NAV-15 | P3 | Click **Delivery areas and fees** in the footer. | The delivery page lists each active area with its fee and minimum order. Inactive areas are not listed. Free delivery shows as "Free". | ☐ |

## 3. Visitor: the menu

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-MENU-01 | P1 | Open **Menu**. | A search bar, a **Filters** button, category pills (All selected), a count ("30 products" or the real number), and a grid of product tiles with name and "From EGP …". | ☐ |
| V-MENU-02 | P1 | Click a category pill. | The list narrows to that category, the pill is highlighted, the address changes to include the category. | ☐ |
| V-MENU-03 | P1 | Type "choc" in the search bar. | After a short pause the list narrows to matching products, typed letters are not lost while it updates. | ☐ |
| V-MENU-04 | P2 | Search for letters that match nothing ("zzzz"). | "Nothing matches your search. Try a different word or clear the filters." with one **Clear filters** button. | ☐ |
| V-MENU-05 | P2 | Search "%" or "_". | Treated as plain text: no results (or only products that really contain those characters), no error. | ☐ |
| V-MENU-06 | P2 | Search in capitals ("CAKE") and in the middle of a word ("velvet"). | Matches regardless of capital letters, in names and descriptions. | ☐ |
| V-MENU-07 | P1 | Click **Filters**. | A panel opens under the button with **Occasion** and **Sort by** choices. It never leaves the screen (also on a phone). | ☐ |
| V-MENU-08 | P2 | Choose an occasion. | The list narrows; the Filters button shows a count (for example "Filters 1"); a summary line shows the occasion. | ☐ |
| V-MENU-09 | P2 | Choose each sort in turn (Featured, Name, Price low to high, Price high to low, Newest). | The order of the products follows each choice. Prices rise or fall correctly. | ☐ |
| V-MENU-10 | P2 | Combine a category, an occasion and a search. | Results satisfy all three. The count is correct. | ☐ |
| V-MENU-11 | P2 | Click **Clear filters**. | Search empties, category returns to All, occasion and sort reset. The button disappears when nothing is set. | ☐ |
| V-MENU-12 | P2 | Press **Escape** while the Filters panel is open. | It closes and focus returns to the Filters button. | ☐ |
| V-MENU-13 | P2 | Copy the address with filters applied and open it in a new tab. | The same filters apply (the address is shareable). | ☐ |
| V-MENU-14 | P2 | Use the browser **Back** button after changing filters. | It goes back to the page before, not through every filter step. | ☐ |
| V-MENU-15 | P2 | With more than one page of products, click **Next** and **Previous**. | "Page 2 of 3" updates, **Previous** is disabled on page 1 and **Next** on the last page. | ☐ |
| V-MENU-16 | P3 | Change a filter while on page 2. | You return to page 1 of the new results. | ☐ |
| V-MENU-17 | P2 | Check that archived and switched-off products never appear, and products with no active size are not listed. | None of them are shown, whatever the search. | ☐ |
| V-MENU-18 | P3 | Hover a product tile. | It lifts slightly and its picture zooms in a little inside its frame (a fine pointer only). | ☐ |
| V-MENU-19 | P2 | Tab through the menu with the keyboard. | Search, Filters, each pill, each product link is reachable in order with a visible focus ring. The category pills behave as one group (arrow keys move between them). | ☐ |
| V-MENU-20 | P3 | Turn the API off, then open the menu. | "We could not load the menu." with a **Try again** button. After turning the API back on, the button loads the menu. | ☐ |
| V-MENU-21 | P3 | A category deep link from the home page chips or an old address with `?category=unknown`. | No crash; an empty result with the clear option, or all products. | ☐ |

## 4. Visitor: product page

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-PROD-01 | P1 | Open a product. | Name, category, occasions, a picture, sizes with prices, the price, lead time, earliest delivery and pickup dates, message field, quantity, **Add to cart**, and the About and Ingredients text. | ☐ |
| V-PROD-02 | P1 | Choose another size. | The big price changes to that size's price. | ☐ |
| V-PROD-03 | P1 | Add a product with the default quantity 1. | A green line "Added 1 × Name (size) to your cart." with a **View cart** link; the header count goes up. | ☐ |
| V-PROD-04 | P2 | Type a message ("Happy Birthday Sara") and add. | The message is kept with that cart line. | ☐ |
| V-PROD-05 | P3 | Type more than 80 characters in the message. | The field stops at 80. | ☐ |
| V-PROD-06 | P2 | Add the same size and the same message twice. | One cart line with quantity 2, not two lines. | ☐ |
| V-PROD-07 | P2 | Add the same size with a different message. | Two separate cart lines. | ☐ |
| V-PROD-08 | P3 | Clear the quantity field and click **Add to cart**. | Adds 1 (never 0, never an error). | ☐ |
| V-PROD-09 | P3 | Type 0, a negative number, 1000 or letters as the quantity. | The quantity ends between 1 and 100. Nothing breaks. | ☐ |
| V-PROD-10 | P2 | Read the earliest dates for a cake with a 48-hour lead time. | The dates are at least two days away (and respect closed days and holidays). | ☐ |
| V-PROD-11 | P3 | For a product with no available dates soon (fully booked or all days closed). | "No dates available soon" instead of a date. | ☐ |
| V-PROD-12 | P2 | Open a product with several photos. | Thumbnails below the main picture; clicking one swaps the picture. Each picture has a description for screen readers. | ☐ |
| V-PROD-13 | P2 | Open an address for a product that does not exist. | "We could not find that product." with a link back to the menu. | ☐ |
| V-PROD-14 | P3 | Open a product you saw earlier after the owner archived it. | Same "could not find" page (archived products are not sold). | ☐ |
| V-PROD-15 | P3 | Use only the keyboard: Tab to the sizes, arrow between them, type in the fields, press Enter on Add to cart. | Everything is reachable; the size options behave as one radio group; Enter adds. | ☐ |
| V-PROD-16 | P3 | On a phone. | One column: picture, then the buying details; no sideways scroll; the Add button full width. | ☐ |
| V-PROD-17 | P3 | Click the category name above the product title. | The menu opens filtered to that category. | ☐ |

## 5. Visitor: cart

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-CART-01 | P1 | Open the cart with items in it. | Each line with picture, name, size, price, a quantity box, a **Remove** link and the line total; an order summary with subtotal, "Chosen at checkout" for delivery, total; **Continue to checkout**. | ☐ |
| V-CART-02 | P1 | Change a quantity. | Totals update from the server after a moment. | ☐ |
| V-CART-03 | P1 | Click **Remove**. | The line disappears, a message announces it; removing the last line shows "Your cart is empty." with a **Browse the menu** button. | ☐ |
| V-CART-04 | P2 | A line with a cake message. | The message shows as plain text ("Message on the cake: …"). There is **no** field to edit it in the cart. | ☐ |
| V-CART-05 | P2 | Clear the quantity box and type a new number. | You can empty it and retype; it does not snap back while typing. Leaving it empty restores the real quantity. | ☐ |
| V-CART-06 | P3 | Type 0, -3 or 500 as a quantity. | Corrected to between 1 and 100. | ☐ |
| V-CART-07 | P2 | Reload the page. | The cart is still there (kept in this browser). | ☐ |
| V-CART-08 | P2 | Open the site in a second tab. | The same cart appears. | ☐ |
| V-CART-09 | P2 | As owner, archive a product that is in a guest's cart; the guest reloads the cart. | The line is flagged "… is no longer available.", the banner "Some items are no longer available" shows, **Continue to checkout** is disabled until it is removed. | ☐ |
| V-CART-10 | P3 | As owner, change the price of an item in a cart. | The cart shows the new price (prices always come from the server, never from what was stored). | ☐ |
| V-CART-11 | P3 | Cut the network, then change a quantity. | "We could not check your cart prices…" message; no crash. | ☐ |
| V-CART-12 | P3 | Add more than 30 different lines (use a script or many sizes). | The server refuses carts over the line limit with a clear message, the site does not crash. | ☐ |
| V-CART-13 | P3 | Corrupt the saved cart (browser storage edited by hand). | The cart ignores invalid lines and opens empty or with the valid lines. | ☐ |
| V-CART-14 | P2 | Click **Keep shopping**. | You return to the menu. | ☐ |
| V-CART-15 | P3 | On a phone. | Each cart line stacks neatly; the quantity box and Remove sit under the name; the price under them; the summary and button below. | ☐ |
## 6. Visitor: checkout (cash on delivery and pickup)

Preconditions: a cake and a bread in the cart, signed out. The progress bar above the form has five steps: Delivery or pickup, Date and time, Your details, Payment, Review.

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-CO-01 | P1 | From the cart click **Continue to checkout**. | Step 1 opens. The progress bar shows step 1 filled. The order summary stays visible beside (below on a phone). | ☐ |
| V-CO-02 | P1 | Step 1: leave **Delivery** selected, click **Continue** with nothing filled. | "There is a problem" summary takes focus and lists what is missing (area, street, building). Each missing field shows its own message. You do not advance. | ☐ |
| V-CO-03 | P1 | Choose an area, type a street and a building, click **Continue**. | Step 2 opens. Floor, apartment and landmark are optional. | ☐ |
| V-CO-04 | P1 | Step 2: open the date list. | Only dates the whole cart can be made for are listed (lead time, opening days, holidays and capacity respected). | ☐ |
| V-CO-05 | P1 | Choose a date, then a time. | Times for that day appear with their windows; choose one and **Continue**. | ☐ |
| V-CO-06 | P1 | Step 3: enter name, email and phone, **Continue**. | Step 4 opens. | ☐ |
| V-CO-07 | P1 | Step 4: **Cash on delivery or pickup** is selected. **Continue**. | Step 5 (Review). | ☐ |
| V-CO-08 | P1 | Step 5: check the review. | Shows delivery address, date and time, contact, notes, payment, the policy ("Changing your mind: …") and the **Place order** button with the exact total including the delivery fee. | ☐ |
| V-CO-09 | P1 | Click **Place order**. | You land on the order's tracking page: "Thank you, your order has been received", status **Received**. The cart is empty. A confirmation email arrives. | ☐ |
| V-CO-10 | P1 | Repeat with **Pickup**. | No area or address is asked. The order is created, the summary shows no delivery fee. | ☐ |
| V-CO-11 | P2 | On the pickup option, read the text. | "Where to collect: …" and instructions appear when the owner set a pickup place. | ☐ |
| V-CO-12 | P2 | Click **Back** on any step. | You go back one step with your answers kept. | ☐ |
| V-CO-13 | P2 | Open `/checkout` with an empty cart. | "Your cart is empty, so there is nothing to check out." with a link to the menu. | ☐ |
| V-CO-14 | P2 | Step 1 on a delivery with Zone B (minimum order) and a cart below the minimum. | "Delivery to Zone B needs an order of at least … Add … more, or choose pickup." The step does not let you continue. | ☐ |
| V-CO-15 | P2 | Add enough to pass the minimum. | The message goes and you can continue. | ☐ |
| V-CO-16 | P3 | Pick the inactive zone (by an old saved address or editing the address). | "We do not deliver to that area." and you cannot place the order. | ☐ |
| V-CO-17 | P2 | Step 2: click **Continue** with no date. | "Choose a date." | ☐ |
| V-CO-18 | P2 | Step 2: choose a date, no time, **Continue**. | "Choose a time." | ☐ |
| V-CO-19 | P2 | Look at a time slot with one or two places left. | It shows "Only 1 left" / "Only 2 left". | ☐ |
| V-CO-20 | P2 | Look at a full slot. | It is disabled and says it is fully booked. | ☐ |
| V-CO-21 | P2 | A pickup-only slot while Delivery is chosen. | It is not offered for delivery. | ☐ |
| V-CO-22 | P2 | Step 3: leave each field empty in turn. | "Enter your name.", "Enter a valid email address, such as sara@example.com.", "Enter a phone number using digits, spaces, + or -." | ☐ |
| V-CO-23 | P3 | Phone with letters ("call me"), too short (123456), too long (21+ chars). | Refused with the phone message. Digits, spaces, +, - and brackets are allowed. | ☐ |
| V-CO-24 | P3 | Email variants: `a@b`, `a b@c.com`, `A@B.COM`. | The first two are refused. Upper-case is accepted and the confirmation goes to the lowercase address. | ☐ |
| V-CO-25 | P3 | Notes with 500 characters, then 501. | 500 accepted; 501 refused. | ☐ |
| V-CO-26 | P3 | Street/building with only spaces. | Refused as empty. | ☐ |
| V-CO-27 | P2 | Step 4 when the owner has switched **cash off**. | Only card is offered and selected. | ☐ |
| V-CO-28 | P2 | Step 4 when card is switched off or not set up. | "Pay online by card (not available right now)" is shown disabled; cash stays selectable. | ☐ |
| V-CO-29 | P1 | Double-click **Place order** quickly. | Exactly **one** order is created (check the order history or the queue). | ☐ |
| V-CO-30 | P2 | Place an order, then press the browser Back button to the checkout and place again. | A second, separate order is created only if you really submit again; the first is not duplicated or lost. | ☐ |
| V-CO-31 | P3 | Cut the network right as you click **Place order**, then reconnect and click again. | No duplicate order: the retry returns the first order (it carries the same idempotency key). | ☐ |
| V-CO-32 | P2 | Two people order the **last** unit of a product (daily capacity 3, order 3 as one person and 1 as another, at the same moment). | Exactly one succeeds; the other sees "… is no longer available" and is sent back to the step that can fix it. | ☐ |
| V-CO-33 | P2 | A time slot with 1 place left, two customers place at once. | One order, one refusal ("Fully booked"). | ☐ |
| V-CO-34 | P2 | A slot fills up while you are on step 5. | Placing is refused with the reason, you return to the date and time step with your other answers kept. | ☐ |
| V-CO-35 | P3 | A product is archived while you are on step 5. | The order is refused; the cart flags the item. Nothing is charged or created. | ☐ |
| V-CO-36 | P2 | Capacity is shared across sizes. Product has daily capacity 3; order 2 of the small and 2 of the large for the same day. | Refused: total units 4 exceed 3. | ☐ |
| V-CO-37 | P2 | Capacity is per day. Book the capacity for Tuesday, then Wednesday. | Wednesday still has capacity. | ☐ |
| V-CO-38 | P2 | A product sold only on certain weekdays. | Other weekdays are not listed. A cart mixing it with another product only offers days both can be made. | ☐ |
| V-CO-39 | P2 | A cart with a 48-hour cake and a same-day bread. | The earliest date follows the slowest item (48 hours). | ☐ |
| V-CO-40 | P2 | The exact lead time boundary: order a 48-hour cake and pick the earliest listed slot. | It is accepted; the slot just before it is not listed. | ☐ |
| V-CO-41 | P2 | Pick the holiday date and a closed weekday. | Neither is offered. | ☐ |
| V-CO-42 | P3 | A slot earlier today that has already started. | Not offered. | ☐ |
| V-CO-43 | P3 | A date more than 90 days away (only possible by editing the request by hand; the site never offers it). | Refused ("We take orders up to 90 days ahead."). | ☐ |
| V-CO-44 | P3 | Change the zone after choosing a date. | The summary updates the delivery fee and total at once. | ☐ |
| V-CO-45 | P3 | Edit prices in the browser (developer tools) before placing. | Ignored. The server charges its own prices. The review total matches the server's. | ☐ |
| V-CO-46 | P3 | Sign in during checkout (second tab) and place the order in the first. | The order belongs to the account only if the first tab was signed in when it was placed. | ☐ |
| V-CO-47 | P3 | Keyboard only: Tab, arrows, Enter through all five steps. | Every control reachable. After **Continue**, focus moves to the new step's heading. Errors take focus. | ☐ |
| V-CO-48 | P3 | Phone width. | Steps in one column, the progress bar shows "Step 2 of 5", buttons large enough to tap. | ☐ |

## 7. Visitor: paying by card

Preconditions: card is on. Local runs use the practice payment page; the live site uses Paymob test mode (details in 0.3).

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-PAY-01 | P1 | Checkout, choose **Pay online by card**, review, **Place order and pay**. | You are sent to the payment page (Paymob live; practice page locally). The order exists as **Waiting for payment** and holds its slot. | ☐ |
| V-PAY-02 | P1 | Pay with the test card. | You return to the order page which says "Confirming your payment…" then, within seconds, **Received** and "Payment received, thank you". A confirmation email arrives. | ☐ |
| V-PAY-03 | P1 | In Paymob's dashboard, check the transaction. | One successful payment for the order total. | ☐ |
| V-PAY-04 | P2 | While "Confirming your payment…" shows, do not reload. | The page keeps checking by itself (about every 3 seconds) and updates without a click. | ☐ |
| V-PAY-05 | P2 | Use a declined test card (wrong CVV or Paymob's decline test). | The payment page says it failed. Returning to the order page: **Waiting for payment** with **Pay by card** available. The order is **not** cancelled. | ☐ |
| V-PAY-06 | P2 | After a decline, click **Pay by card** and pay with a good card. | A fresh payment page opens; paying confirms the order. Only one payment is ever recorded as paid. | ☐ |
| V-PAY-07 | P2 | Open the payment page and close it without paying. Open the order link. | "This order is waiting for payment"; **Pay by card** reopens (or reuses) the payment page. | ☐ |
| V-PAY-08 | P2 | Return from the payment page with `success=false` or `cancelled=1` in the address. | "Your payment was not completed" and a way to pay again. It never shows "Payment received". | ☐ |
| V-PAY-09 | P3 | Edit the return address to say `paid=1` without paying. | The page still says it is waiting; it only changes when the provider's signed confirmation arrives. | ☐ |
| V-PAY-10 | P2 | Do not pay for 35 minutes. | The order is cancelled ("The payment was not completed in time."), the slot is freed, and an email says so. | ☐ |
| V-PAY-11 | P2 | Open the cancelled unpaid order and click for payment. | "The time to pay for this order has run out." | ☐ |
| V-PAY-12 | P3 | Pay on a payment page that was opened before the order expired, after it expired. | The money is **refunded automatically** and an email explains; the order stays cancelled. | ☐ |
| V-PAY-13 | P3 | Pay the same order twice (two payment pages open). | The second payment is refunded; the order stays paid once. | ☐ |
| V-PAY-14 | P3 | A second customer takes the slot while the first is on the payment page. | The slot was already held by the first order, so the second customer sees it as unavailable. | ☐ |
| V-PAY-15 | P2 | Place two card orders from two accounts at once for the last slot. | Only one is created; the other is refused before any payment page opens. | ☐ |
| V-PAY-16 | P3 | Paymob cannot be reached (turn the keys off in a test deployment) and you place a card order. | The order is cancelled, the slot freed, and "We could not open the payment page. Please try again." A retry works. | ☐ |
| V-PAY-17 | P2 | Wrong payment keys or a callback secret (test deployment). | Orders stay "Waiting for payment" after paying; the server log shows the signature problem (this is the signal to fix settings). | ☐ |
| V-PAY-18 | P3 | Copy a real callback address and send a made-up request to it. | Refused (400, invalid signature). Nothing changes. | ☐ |
| V-PAY-19 | P3 | Send the same genuine callback twice (Paymob does this at times). | The order is confirmed once and one email is sent. | ☐ |

## 8. Visitor: tracking, changing and cancelling an order

Use the guest link from the confirmation email (it ends with `?t=…`). Keep it private: anyone with it can change or cancel the order.

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-TRK-01 | P1 | Open the link from the email. | The order page: code, placed time, status, progress, delivery or pickup details, items with messages, totals, payment line. | ☐ |
| V-TRK-02 | P1 | Check the progress for a delivery order and a pickup order. | Delivery: Received, Accepted, Being prepared, Ready, Out for delivery, Delivered. Pickup: …Ready, Picked up. Done steps ticked, the current step marked, the rest empty. | ☐ |
| V-TRK-03 | P1 | Open the page without the `?t=…` part while signed out. | "We could not find that order." (the same message for a wrong code or a wrong link). | ☐ |
| V-TRK-04 | P2 | Change one character of the token. | The same "could not find" page. | ☐ |
| V-TRK-05 | P2 | Open the page and, as staff, accept the order. Wait up to 30 seconds. | The status updates by itself. | ☐ |
| V-TRK-06 | P2 | Let staff mark the order late. | A red notice "This order is running late" with the note. | ☐ |
| V-TRK-07 | P2 | Let staff decline or cancel it. | "This order was declined/cancelled" with the reason. No change or cancel buttons. | ☐ |
| V-TRK-08 | P2 | Open a delivered or collected order. | The timeline complete, no change or cancel section. | ☐ |
| V-TRK-09 | P1 | On a received order, read **Change or cancel this order**. | The deadline ("until 12 Nov 2026, 14:00"), the policy text, and two actions: **Change date, time or address** and **Cancel this order…**. | ☐ |
| V-TRK-10 | P1 | Click **Change date, time or address**. | The change page shows the current time, the date and time choosers, the area and address (delivery) and notes; it says items stay as ordered. | ☐ |
| V-TRK-11 | P1 | Change only the notes and save. | Back on the order page: "Your order was updated", the new notes, an "order changed" email. The order's date and time are unchanged and not re-checked. | ☐ |
| V-TRK-12 | P1 | Change the time to another available slot the same day. | Saved. The old slot is freed, the new one taken (check the queue's day counts or try booking the old slot with another order). | ☐ |
| V-TRK-13 | P2 | Change to another date and pick a time. | Saved; the prep sheet and queue move to the new day. | ☐ |
| V-TRK-14 | P2 | Choose a date but no time. | "Choose a time for the new date." | ☐ |
| V-TRK-15 | P2 | Choose a full slot. | "That time slot is fully booked." (or the reason), nothing changes, the original booking stays. | ☐ |
| V-TRK-16 | P2 | Choose a date the cake cannot be made for (inside its lead time). | A clear refusal; nothing changes. | ☐ |
| V-TRK-17 | P2 | Cash order: change to an area with a different fee. | Saved; the delivery fee and total follow the new area. | ☐ |
| V-TRK-18 | P2 | Paid card order: the area list. | Only areas with the **same delivery fee** are offered. Forcing a different one: "That area has a different delivery fee. Choose an area with the same fee, or cancel and order again." | ☐ |
| V-TRK-19 | P3 | Open the change page for a pickup order. | No address or area fields. | ☐ |
| V-TRK-20 | P3 | Save without changing anything. | "Nothing was changed." | ☐ |
| V-TRK-21 | P3 | Change to an area whose minimum is above the order's subtotal. | Refused: delivery needs a larger order. | ☐ |
| V-TRK-22 | P1 | Click **Cancel this order…**, then **Yes, cancel my order** (cash order). | Status Cancelled with "You cancelled this order."; the slot is freed; a cancellation email. | ☐ |
| V-TRK-23 | P2 | Add a reason ("Plans changed") while cancelling. | The reason appears on the order and in the email. | ☐ |
| V-TRK-24 | P2 | Click **Keep my order** after opening the cancel box. | The box closes; nothing changes. | ☐ |
| V-TRK-25 | P2 | Paid card order, policy **full refund**: cancel. | The page first says "Your card payment of EGP … will be refunded in full." After cancelling the payment shows **refunded**; Paymob shows the refund; the email says so. | ☐ |
| V-TRK-26 | P2 | Policy **80%**: cancel a paid order of 1,000. | "800.00 … will be refunded, as our policy says"; the payment shows **partly refunded**; Paymob shows 800. | ☐ |
| V-TRK-27 | P2 | Policy **no refund**: cancel a paid order. | "Under our policy, an order paid by card is not refunded when you cancel it." The order is cancelled, the payment stays paid, the slot is freed, the email says there is no refund. | ☐ |
| V-TRK-28 | P2 | Change or cancel **after** the deadline (the minute after "until …"). | "The time to change or cancel this order has passed. Please contact the bakery." The page says the same instead of showing buttons. | ☐ |
| V-TRK-29 | P3 | Change or cancel exactly **at** the deadline minute. | Still allowed (the deadline is inclusive). | ☐ |
| V-TRK-30 | P2 | Ask staff to start preparing, then try to cancel from the old page. | "This order can no longer be changed because the bakery has started on it or it is closed." | ☐ |
| V-TRK-31 | P3 | Click **Yes, cancel my order** twice quickly. | One cancellation; the slot is freed once. | ☐ |
| V-TRK-32 | P3 | Cancel while staff decline the same order at the same moment. | One of them wins; the order ends in a single consistent state; capacity is freed exactly once. | ☐ |
| V-TRK-33 | P3 | A refund fails (Paymob down) while cancelling a paid order. | The order is **not** cancelled; an error says so ("…nothing was changed"). Trying again later works. | ☐ |
| V-TRK-34 | P3 | Owner changes the window to 2 hours; open the page again. | The deadline moves to 2 hours before the slot and buttons appear or disappear accordingly. | ☐ |
| V-TRK-35 | P3 | Owner sets window 0 hours. | Customers can change until the slot starts. | ☐ |
| V-TRK-36 | P3 | Another customer (signed in) tries to cancel your order with your code but no token. | "We could not find that order." | ☐ |

## 9. Visitor: register, sign in, password reset

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| V-AUTH-01 | P1 | **Sign in** then **Create account**. Fill name, email, a 10+ character password. | You are signed in and land on My account; the header shows your first name. | ☐ |
| V-AUTH-02 | P2 | Register with a password of 9 characters. | "Password must be at least 10 characters." | ☐ |
| V-AUTH-03 | P3 | A password longer than 72 bytes (including emojis). | Refused ("too long"); never silently cut. | ☐ |
| V-AUTH-04 | P2 | Register with an email already used, also in capitals. | "An account with this email already exists." | ☐ |
| V-AUTH-05 | P2 | Register with an invalid email, an empty name. | Errors on the right fields, linked to them for screen readers. | ☐ |
| V-AUTH-06 | P1 | Sign in with the right email and password. | Signed in; lands on My account (or the page you were trying to open). | ☐ |
| V-AUTH-07 | P2 | Wrong password; unknown email. | The same message for both: "Email or password is incorrect." Focus goes to the error summary. | ☐ |
| V-AUTH-08 | P2 | Click **Show password**. | The password becomes visible and the button shows it is pressed. | ☐ |
| V-AUTH-09 | P2 | Open `/account` signed out. | Sent to Sign in; after signing in you reach the account page. | ☐ |
| V-AUTH-10 | P2 | While signed in open `/login`. | You are sent to your account, not shown the form. | ☐ |
| V-AUTH-11 | P1 | **Forgot your password?**, enter your email. | "If an account exists for that email, a reset link is on its way." The same words for an unknown email. | ☐ |
| V-AUTH-12 | P1 | Open the reset link, choose a new password. | Password changed; you can sign in with the new one and not the old one. | ☐ |
| V-AUTH-13 | P2 | Use the same reset link a second time. | Refused (links work once). | ☐ |
| V-AUTH-14 | P3 | Use a reset link after 30 minutes. | Refused as expired. | ☐ |
| V-AUTH-15 | P3 | Open a reset link with a made-up token. | Refused. | ☐ |
| V-AUTH-16 | P3 | Try 11 wrong sign-ins within a minute. | The 11th is slowed down with a "too many requests" response; waiting a minute lets you try again. | ☐ |
| V-AUTH-17 | P2 | Owner switches your account off; you click anything while signed in. | You are signed out at once and see the sign-in page. Signing in again is refused. | ☐ |
| V-AUTH-18 | P3 | Leave the site signed in for over an hour, then click. | The session has expired: you are sent to Sign in. The cart is kept (you were not signing out). | ☐ |
| V-AUTH-19 | P3 | Sign out in one tab, then reload the other. | The other tab shows you signed out (the session is shared between tabs). | ☐ |
## 10. Customer (signed in)

Sign in as `customer1`. Place at least one cash order and one card order while signed in first (sections 6 and 7), so history and tracking have something to show.

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| C-ACC-01 | P1 | Click your first name in the header. | A menu opens: your name and email, **My account**, **My orders**, **Sign out** (no Manage shop, no Prep sheet). | ☐ |
| C-ACC-02 | P2 | Close it with Escape, then by clicking outside, then by following a link. | Each closes it; Escape returns focus to the button; following a link opens the page without a page reload. | ☐ |
| C-ACC-03 | P1 | Open **My account**. | Heading "My account", tabs **Profile**, **My orders**, **Saved addresses**, your email, name and phone fields. | ☐ |
| C-ACC-04 | P1 | Change the name and phone and **Save details**. | "Your details were saved." The header shows the new first name. | ☐ |
| C-ACC-05 | P2 | Clear the phone and save. | Saved with no phone. | ☐ |
| C-ACC-06 | P2 | Name left empty; phone "call me". | Refused with messages on the fields. | ☐ |
| C-ACC-07 | P2 | Try to change your email or role (the form has no field; also not through other means). | Not possible. | ☐ |
| C-ACC-08 | P1 | **Change your password** with the correct current password and a new 10+ character one. | "Your password was changed." The fields clear. Signing out and in with the new password works, with the old one not. | ☐ |
| C-ACC-09 | P2 | Wrong current password. | "We could not change your password" and the message on the Current password field. | ☐ |
| C-ACC-10 | P2 | New password equal to the current one; shorter than 10 characters. | "Choose a different password."; the length message. | ☐ |
| C-ADDR-01 | P1 | **Saved addresses**, **Add an address**: name "Home", an area, street and building, tick "Use this address first at checkout", save. | "“Home” was added." It shows with "(default)". | ☐ |
| C-ADDR-02 | P2 | Add a second address with the default box ticked. | The new one becomes default; the first loses the label. Only one default exists. | ☐ |
| C-ADDR-03 | P2 | **Edit** an address, change the street. | "“Home” was saved." | ☐ |
| C-ADDR-04 | P2 | **Delete** an address. | A confirmation ("Yes, delete Home" / "Keep it"); after confirming it disappears with a message. | ☐ |
| C-ADDR-05 | P2 | Save with an empty street; empty name; no area. | Errors on those fields; nothing saved. | ☐ |
| C-ADDR-06 | P2 | Save an address in an area the owner later deactivates, then edit it. | You must pick an active area to save. | ☐ |
| C-ADDR-07 | P3 | Add 10 addresses, then an 11th. | "You can save up to 10 addresses. Delete one first." | ☐ |
| C-ADDR-08 | P3 | Optional fields (floor, apartment, landmark) with only spaces. | Saved as empty, not as spaces. | ☐ |
| C-ADDR-09 | P1 | Start a delivery checkout. | The default address and its area are filled in on arrival. A "Use a saved address" list offers the others; choosing one fills the area and fields. | ☐ |
| C-ADDR-10 | P3 | Type your own street over the filled one, move between steps and back. | Your typing stays. The default is never pasted over it again. | ☐ |
| C-ADDR-11 | P2 | Sign in as `customer2`. | Sees none of customer1's addresses (an empty list). | ☐ |
| C-ORD-01 | P1 | **My orders**. | Your orders, newest first, each with code, items, delivery or pickup date and time, total and a status badge. | ☐ |
| C-ORD-02 | P1 | Click an order. | Its tracking page opens without needing the private link. | ☐ |
| C-ORD-03 | P2 | A guest order made with your email earlier. | Not in the list (guest orders are never linked). | ☐ |
| C-ORD-04 | P2 | With 11 or more orders. | Pages of 10 with Previous and Next. | ☐ |
| C-ORD-05 | P2 | New account with no orders. | "You have not placed an order with this account yet." with a menu link. | ☐ |
| C-ORD-06 | P1 | Change and cancel one of your own orders from its page (cases V-TRK-09 to V-TRK-33). | Same results as for a guest, without needing the link. | ☐ |
| C-ORD-07 | P2 | As `customer2`, open `customer1`'s order address directly. | "We could not find that order." | ☐ |
| C-ORD-08 | P2 | As `customer2`, try to change or cancel `customer1`'s order. | Refused as not found. | ☐ |
| C-CART-01 | P1 | Signed in, add two items, then **Sign out** from the menu. | You land on Sign in at once. The header cart shows 0. | ☐ |
| C-CART-02 | P1 | Sign in again. | The two items are back in the cart. | ☐ |
| C-CART-03 | P2 | Signed out, add a different item as a guest, then sign in. | The guest item is **merged** with the saved cart; the same item adds up the quantity. | ☐ |
| C-CART-04 | P2 | Sign in on a second browser. | The same cart appears there. | ☐ |
| C-CART-05 | P2 | Sign out, sign in as `customer2`. | An empty cart, never customer1's items. | ☐ |
| C-CART-06 | P3 | Let customer1's session expire (over an hour) and sign in as `customer2` in the same browser. | customer2 does not inherit customer1's leftover cart. | ☐ |
| C-CART-07 | P3 | Place an order. | The cart is emptied here and on the account (a reload after signing in shows it empty). | ☐ |
| C-CART-08 | P3 | Network down while adding items, then back up. | The cart still works locally; the next change saves. No data lost, no error screen. | ☐ |
| C-CART-09 | P3 | Cut the network at the moment you sign in. | You sign in but nothing overwrites the saved cart with an empty one (check after reconnecting by reloading). | ☐ |
| C-SEC-01 | P1 | Click **Sign out** with a real click (mouse and keyboard). | Signs out, lands on Sign in, the cart empties. Works on a phone too. | ☐ |
| C-SEC-02 | P2 | After signing out press the browser Back button. | You do not see your account data; signed-out pages ask you to sign in. | ☐ |
| C-SEC-03 | P2 | As a customer open `/staff/orders`, `/admin/products`, `/admin/team`. | "You do not have access to this page". No data is shown. | ☐ |
| C-SEC-04 | P3 | Try those same areas through the API directly (browser tools, with your token). | 403 Forbidden for each; 401 with no token. | ☐ |

## 11. Staff

Sign in as `staff`. Have at least four orders for the test day: a delivery and a pickup, one paid by card (paid) and one cash, with a cake message on one.

### 11.1 Access

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| S-ACC-01 | P1 | Sign in as staff. | The header shows **Orders** next to Menu. The account menu has My account, My orders, Prep sheet, Manage shop, Sign out. | ☐ |
| S-ACC-02 | P1 | Click **Orders**. | The order queue opens. | ☐ |
| S-ACC-03 | P2 | **Manage shop**. | Only the Schedule and Delivery zones screens (read only: no add, edit or delete buttons). No Products, Categories, Occasions, Payments, Policies, Shop details or Team. | ☐ |
| S-ACC-04 | P2 | Open `/admin/products`, `/admin/payments`, `/admin/policies`, `/admin/shop`, `/admin/team` by address. | "You do not have access to this page". | ☐ |
| S-ACC-05 | P3 | Try those owner endpoints through the API with the staff token. | 403 Forbidden. | ☐ |
| S-ACC-06 | P2 | A signed-in customer opens `/staff/orders`. | "You do not have access to this page". | ☐ |

### 11.2 The queue

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| S-Q-01 | P1 | Open the queue. | Heading "Order queue"; day set to today; stage buttons with counts (All, New, Accepted, Preparing, Ready, Out for delivery, Finished); a table with Time, Order, Customer, Type, Items, Total, Status. | ☐ |
| S-Q-02 | P1 | Change **Day** to another date. | The list and the counts follow that day's orders (delivery or pickup date, not the day it was placed). | ☐ |
| S-Q-03 | P2 | **Today**, **All days**. | Today resets the day; All days lists every day's orders, each row also showing its date. | ☐ |
| S-Q-04 | P2 | Click each stage button. | Only orders in that stage; the pressed button is highlighted; the count matches the rows. | ☐ |
| S-Q-05 | P2 | **Finished**. | Delivered, collected, declined and cancelled orders. | ☐ |
| S-Q-06 | P2 | Delivery or pickup selector. | Only that kind. | ☐ |
| S-Q-07 | P1 | Search by order code (lower case too), customer name, phone, email. | Matching orders only. A search with no match: "No orders match these filters." | ☐ |
| S-Q-08 | P3 | Search "%" or "_". | Taken as plain text (not as "match anything"). | ☐ |
| S-Q-09 | P2 | Orders are in time order. | Sorted by day, then time slot. | ☐ |
| S-Q-10 | P2 | A late order. | Shows a "Late" tag in text, and the page says "N orders are marked late." | ☐ |
| S-Q-11 | P1 | A card order **not yet paid**. | It is **not** in the queue (nor counted). It appears after the customer pays. | ☐ |
| S-Q-12 | P2 | Leave the queue open while a customer places an order. | Within about 30 seconds the new order appears and the counts update without a reload. | ☐ |
| S-Q-13 | P3 | More than 25 orders. | Paged with Previous and Next; a search or filter resets to page 1. | ☐ |
| S-Q-14 | P3 | Open `/staff/orders?q=BK-…` (the prep sheet's order links). | The queue opens on all days with the code in the search box. | ☐ |
| S-Q-15 | P3 | Open `/staff` and `/staff/` . | Redirects to the queue. | ☐ |
| S-Q-16 | P3 | Phone width. | The table scrolls inside its own box if needed; the page itself does not scroll sideways. | ☐ |

### 11.3 One order

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| S-ORD-01 | P1 | Open a delivery order. | Code, status, a "What next" section, delivery details (date, slot, address, landmark, notes), customer (phone and email as working links), payment line, items with messages, delivery fee and total, history, running-late and message forms. | ☐ |
| S-ORD-02 | P1 | A **received** order: look at "What next". | **Accept order**, **Decline order…** and **Cancel order…** (and **Cash collected** for cash). Nothing else. | ☐ |
| S-ORD-03 | P1 | **Accept order**. | "Order is now: Accepted." The buttons change to **Start preparing** and **Cancel order…**. The customer gets an "accepted" email. The customer's page updates. | ☐ |
| S-ORD-04 | P1 | Walk a **delivery** order: Start preparing, Mark ready, Send out for delivery, Mark delivered. | Each step succeeds in that order; history lists each with its time; a status email goes out each time; at the end "This order is finished" and no buttons. | ☐ |
| S-ORD-05 | P1 | Walk a **pickup** order: Start preparing, Mark ready, Mark collected. | There is no "out for delivery" step; the end status is Picked up. | ☐ |
| S-ORD-06 | P2 | Look for ways to skip a step (received to ready, accepted to delivered) through the buttons or API. | Not offered; the API answers "cannot move from … to …" (409). | ☐ |
| S-ORD-07 | P2 | Accept an order twice (double click, or in two tabs). | The second is refused or a no-op; the history has one "accepted" entry; one email. | ☐ |
| S-ORD-08 | P1 | **Decline order…** with an empty reason. | "Tell the customer why." Nothing is sent. | ☐ |
| S-ORD-09 | P1 | Decline with a reason ("We are fully booked that day."). | "Order declined and the customer was told." Status Declined; the reason on the order; the slot and product units are freed; the customer's email carries the reason. | ☐ |
| S-ORD-10 | P1 | Decline a **paid card** order. | The form says the refund is automatic. After confirming: payment shows **Refunded**, the Paymob dashboard shows the refund (a 201 reply), the email mentions the refund. | ☐ |
| S-ORD-11 | P2 | Decline a cash order. | No refund step; payment status unchanged ("Not paid yet"). | ☐ |
| S-ORD-12 | P1 | **Cancel order…** an accepted order with a reason. | Cancelled; capacity freed; email with the reason. | ☐ |
| S-ORD-13 | P2 | Cancel a preparing, ready and out-for-delivery order. | Allowed with a reason (a staff action, always a **full** refund for card orders, regardless of the owner's policy for customers). | ☐ |
| S-ORD-14 | P2 | Staff cancel with the policy set to "no refund". | Still refunded in full. | ☐ |
| S-ORD-15 | P3 | A refund is refused or the provider is down when you decline a paid order. | The error "The card refund did not go through, so nothing was changed. Provider said: …"; the order stays as it was; trying again later works. | ☐ |
| S-ORD-16 | P3 | In Paymob's dashboard refund a paid test order by hand first, then decline that order here. | Known limitation: Paymob refuses a second refund, so you see "The card refund did not go through… Provider said: …already fully refunded" and the order stays as it was. The payment record must be sorted out by hand before closing the order. | ☐ |
| S-ORD-17 | P2 | **Mark late** with an empty note; with a note. | The button is disabled without text. With text: the red "Late: …" line, a "running late" email, the order's tag in the queue. | ☐ |
| S-ORD-18 | P2 | Update the late note. | The new note replaces the old and another email is sent. | ☐ |
| S-ORD-19 | P2 | **Remove the late flag**. | Flag gone; no email. | ☐ |
| S-ORD-20 | P2 | Finish or close a late order. | The late flag clears itself. | ☐ |
| S-ORD-21 | P3 | Try to mark a delivered or declined order late. | Not possible ("Only an order that is still open can be marked late"). | ☐ |
| S-ORD-22 | P1 | **Contact the customer**: send a message. | "Message emailed to …". It appears under "Sent messages" with the time. The customer gets the email. | ☐ |
| S-ORD-23 | P3 | Send a message of 1,000 characters, then 1,001; an empty one. | 1,000 accepted; 1,001 and empty refused. | ☐ |
| S-ORD-24 | P1 | A cash order: **Cash collected**. | "Cash payment recorded."; payment becomes Paid; the button disappears. | ☐ |
| S-ORD-25 | P3 | Cash collected twice; on a card order; on a declined order. | Refused or not offered each time. | ☐ |
| S-ORD-26 | P2 | Double-click any action button. | One request is sent; one change in history. | ☐ |
| S-ORD-27 | P3 | Two staff accept or decline the same order at the same moment. | One wins; the other is refused; capacity is freed once only (never below zero). | ☐ |
| S-ORD-28 | P3 | The customer changes the time while staff reject the order. | One consistent end state; capacity correct afterwards. | ☐ |
| S-ORD-29 | P3 | Open an unpaid (waiting for payment) card order by its address `/staff/orders/<id>`. | "We could not find that order." Staff cannot act on it. | ☐ |
| S-ORD-30 | P3 | Open an order id that does not exist. | "We could not find that order" with a link back to the queue. | ☐ |
| S-ORD-31 | P3 | Check the phone and email links. | `tel:` and `mailto:` open the right app. | ☐ |

### 11.4 Prep sheet

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| S-PREP-01 | P1 | Open **Prep sheet** for a day with orders. | "N items to make for M orders." A table of product, size, quantity to make and number of orders; a list of messages to write on cakes with their time and order code. | ☐ |
| S-PREP-02 | P2 | Compare with the queue. | Quantities equal the sum of the orders' items for that day. Declined, cancelled and unpaid card orders are **not** counted. | ☐ |
| S-PREP-03 | P2 | Decline an order, reload the sheet. | Its items and cake message drop out. | ☐ |
| S-PREP-04 | P2 | Change an order's day, check both days' sheets. | The order moves from one sheet to the other. | ☐ |
| S-PREP-05 | P2 | A day with no orders. | "Nothing to make on this day." | ☐ |
| S-PREP-06 | P3 | Click an order code in the messages list. | The queue opens showing that order. | ☐ |
| S-PREP-07 | P2 | **Print this sheet** (print preview). | The header, footer and controls are hidden; the table and messages print cleanly on one or two pages. | ☐ |
| S-PREP-08 | P3 | Orders at the edges of the day (first and last slot). | Messages are listed in time order. | ☐ |

## 12. Owner

Sign in as `owner`. The owner can do everything staff can (repeat S-ACC-01 to S-ORD-31 quickly) and also the following. Open **Manage shop**: nine areas in the bar (Products, Categories, Occasions, Schedule, Delivery zones, Payments and emails, Cancellation and refunds, Shop details, Team).

### 12.1 Categories, occasions and products

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| O-CAT-01 | P1 | **Categories**: add one. | It appears here and on the public menu. | ☐ |
| O-CAT-02 | P2 | Rename it. | Shown with the new name; its web address (slug) stays the same. | ☐ |
| O-CAT-03 | P2 | Add a second with the same name. | The address gets a distinct slug; no clash. | ☐ |
| O-CAT-04 | P2 | Empty name; 100+ characters. | Refused with a field message. | ☐ |
| O-CAT-05 | P2 | Archive a category with products. | Its products vanish from the public menu (still editable here); restoring brings them back. | ☐ |
| O-CAT-06 | P2 | **Occasions**: add, rename, archive, restore. | Same behaviour; occasions appear as filters on the menu. | ☐ |
| O-PRD-01 | P1 | **Products** list. | A table with photo, name (link), category, "From" price, status badges, **Archive**. A search box and filters (category, show Active/Archived). | ☐ |
| O-PRD-02 | P1 | **New product**: name, category, description, ingredients, at least one size with a price. | Created; visible on the menu. | ☐ |
| O-PRD-03 | P2 | Create with no size. | Refused ("needs a size"). | ☐ |
| O-PRD-04 | P2 | Prices: "0", "-5", "abc", "1.234", "1,5", "650.5", "650". | 0, negatives, letters, 3+ decimals and commas are refused in the browser before saving; 650.5 and 650 are saved as 650.50 and 650.00. | ☐ |
| O-PRD-05 | P2 | Add, rename and re-price a size. Remove the **last** remaining size. | Edits work. The last active size cannot be removed. | ☐ |
| O-PRD-06 | P2 | Switch a size off. | It disappears from the product page. If it was the only one the product leaves the menu. | ☐ |
| O-PRD-07 | P1 | Upload a photo **with** a description (alt text). | The photo shows on the product and in lists. | ☐ |
| O-PRD-08 | P1 | Upload with an **empty** description. | Refused: "Describe the photo" (alt text is required). No upload happens. | ☐ |
| O-PRD-09 | P2 | Upload a non-image (a PDF), a corrupt image, a very large file. | Each refused with a clear message. | ☐ |
| O-PRD-10 | P2 | Upload a photo taken on a phone (with location data). | The picture is converted and the location data is stripped. | ☐ |
| O-PRD-11 | P2 | Edit a photo's description and position; delete a photo. | Saved; deleting removes it from the product and from storage. | ☐ |
| O-PRD-12 | P3 | Add photos until the limit. | The limit message appears; no more are added. | ☐ |
| O-PRD-13 | P1 | **Archive** a product. | Announced; leaves the menu and carts flag it; still in the owner list under Archived; **Restore** brings it back. | ☐ |
| O-PRD-14 | P2 | Switch a product **unavailable**. | Not sold, not on the menu; carts flag it. | ☐ |
| O-PRD-15 | P2 | Set a **lead time** (for example 48 hours). | The product page and checkout respect it (see V-CO-39, V-CO-40). | ☐ |
| O-PRD-16 | P2 | Set a **daily capacity** (3). | A fourth unit on the same day cannot be ordered. Blank means no limit. | ☐ |
| O-PRD-17 | P2 | Set **days sold** (for example Thursday to Saturday). | Other weekdays are not offered in checkout. Clearing all days is refused or means every day. | ☐ |
| O-PRD-18 | P2 | Tick **Featured** on four products. | They are the four favourites on the home page (the first four). | ☐ |
| O-PRD-19 | P3 | Attach occasions to a product and remove one. | The menu's occasion filter follows. | ☐ |
| O-PRD-20 | P3 | Edit a product that is in an open order. | The existing order keeps the old name, size and price (a snapshot). | ☐ |
| O-PRD-21 | P3 | Server error while saving (stop the server briefly). | The error shows on the form; what you typed is kept. | ☐ |

### 12.2 Schedule and delivery

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| O-SCH-01 | P1 | **Schedule**: set hours for each day and **Save opening hours**. | Seven days saved; the footer and the home page show them. | ☐ |
| O-SCH-02 | P2 | Opening time equal to or after closing time. | Refused in the browser; nothing is sent. | ☐ |
| O-SCH-03 | P2 | Tick a day **Closed**. | No slots for that day in checkout; the footer says Closed. | ☐ |
| O-SCH-04 | P1 | Add a **time slot** (day, start, end, delivery/pickup/both, order limit). | Listed under its day and offered in checkout. | ☐ |
| O-SCH-05 | P2 | Add a slot that overlaps another. | An overlap message from the server. | ☐ |
| O-SCH-06 | P2 | End before start; outside opening hours. | Refused; a slot outside opening hours is never offered. | ☐ |
| O-SCH-07 | P2 | Edit a slot's limit; switch it off; delete it (asks first). | Limit applies to new orders only; off slots are hidden; delete confirms. | ☐ |
| O-SCH-08 | P3 | Lower a slot's limit below its current bookings. | New orders are refused; existing ones are untouched. | ☐ |
| O-SCH-09 | P2 | Add a **closed date** (holiday). | Listed under closed dates; checkout offers no slots that day. | ☐ |
| O-SCH-10 | P2 | Add a closed date in the past; the same date twice. | Past refused ("Choose today or a later date"); a duplicate refused. | ☐ |
| O-SCH-11 | P2 | Remove a closed date. | Bookable again. | ☐ |
| O-SCH-12 | P3 | Remove all slots for a weekday. | That weekday offers no times; the date list skips it. | ☐ |
| O-SCH-13 | P3 | No opening hours at all. | Nothing is bookable (the shop counts as closed). | ☐ |
| O-ZON-01 | P1 | **Delivery zones**: add a zone with a fee and a minimum. | Listed; shown on the public delivery page and in checkout. | ☐ |
| O-ZON-02 | P2 | A free zone (fee 0). | Shows "Free delivery"; the order shows "Free". | ☐ |
| O-ZON-03 | P2 | Fee "abc", "-1", "1.234". | Refused before saving. | ☐ |
| O-ZON-04 | P2 | Deactivate a zone. | It leaves checkout and the public page; past orders and saved addresses still show its name. | ☐ |
| O-ZON-05 | P3 | A saved address in a deactivated zone is used at checkout. | "We do not deliver to that area." until another area is chosen. | ☐ |

### 12.3 Payments, emails and policies

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| O-PAY-01 | P1 | Open **Payments and emails**. | Provider status ("Paymob (test mode)" or "Not set up"), "Available to customers", the callback address to paste into Paymob, and no secrets anywhere. | ☐ |
| O-PAY-02 | P1 | Switch card off and save. | Checkout hides card (and shows it disabled); the shop reports cash only. | ☐ |
| O-PAY-03 | P1 | Switch cash off (card on). | Checkout offers only card. | ☐ |
| O-PAY-04 | P2 | Switch both off. | Refused: "at least one method must stay on". | ☐ |
| O-PAY-05 | P2 | Try to place a cash order after cash is switched off (a page opened earlier). | "Cash on delivery is not available right now. Please pay by card." | ☐ |
| O-PAY-06 | P2 | A server with no payment keys. | The page says card is not set up; customers can pay cash only. | ☐ |
| O-MAIL-01 | P1 | **Send me a test email**. | "A test email was sent to …" and it arrives; on a server with no email key the message says emails are only written to the log. | ☐ |
| O-MAIL-02 | P2 | Test email when the sender is not verified. | "The test email could not be sent" with the provider's reason. | ☐ |
| O-MAIL-03 | P1 | **Email wording**: choose "Order confirmed". | Its description, a list of insertable details (`{{ order_code }}` etc.), subject and body. | ☐ |
| O-MAIL-04 | P1 | Edit the wording, preview, save; place a new order. | The preview renders with sample data; the next real email uses the new wording. | ☐ |
| O-MAIL-05 | P2 | Use a detail that does not belong to that email (`{{ reason }}` in "Order confirmed"). | Refused when saving, naming the problem. | ☐ |
| O-MAIL-06 | P2 | Broken syntax (`{{ order_code`), a loop with no end, an include, an attempt to reach Python internals. | Each refused; nothing saved; no server error. | ☐ |
| O-MAIL-07 | P2 | **Restore the original** wording. | The standard text is back. | ☐ |
| O-MAIL-08 | P2 | Switch an email **off** (for example "Message from the bakery"). | That email is no longer sent; others still are. | ☐ |
| O-MAIL-09 | P1 | **Email log**: look at recent emails. | Newest first with recipient, template, subject, status, attempts, time. A filter by status (sent, pending, failed). | ☐ |
| O-MAIL-10 | P2 | Make the sender fail (wrong key), place an order. | The order still succeeds; the email shows pending, then failed after its attempts, with the error. | ☐ |
| O-MAIL-11 | P2 | Fix the sender and press **Retry** on a failed email. | It is sent and shows sent. | ☐ |
| O-MAIL-12 | P3 | Restart the server with emails pending. | They are still sent afterwards (nothing lost). | ☐ |
| O-POL-01 | P1 | **Cancellation and refunds**: window 24, **Refund in full**, save. | "The policy was saved…"; the "What customers read" box matches. | ☐ |
| O-POL-02 | P1 | Choose **Refund a percentage**, 80, save. | The wording says 80%; customers see 80% on a paid order (V-TRK-26). | ☐ |
| O-POL-03 | P2 | Percentage 0, 100, 150 or letters. | Refused with "Enter a percentage between 1 and 99…". | ☐ |
| O-POL-04 | P2 | **No refund**. | Customers' cancellations of paid orders keep the money (V-TRK-27). Staff cancellations still refund in full. | ☐ |
| O-POL-05 | P2 | Window 0 and 720; then -1 and 1000. | 0 to 720 accepted; outside refused. | ☐ |
| O-POL-06 | P2 | Add extra wording ("Custom cakes cannot be cancelled."). | Appended to the policy at checkout and on the order page. | ☐ |
| O-POL-07 | P3 | Change the policy while a customer has the checkout open. | The checkout and order page show the new text after the next page change or tab focus. | ☐ |

### 12.4 Shop details and team

| ID | P | Scenario and steps | Expected | ☐ |
|---|---|---|---|---|
| O-SHOP-01 | P1 | **Shop details**: name, phone, WhatsApp, email, address, pickup place and instructions. Save. | "Saved. Customers see the new details straight away." | ☐ |
| O-SHOP-02 | P1 | Check as a visitor. | Header and footer use the new name; the footer shows address, working phone, WhatsApp and email links; the pickup text appears at checkout (pickup), on the order page and in order emails ("Collect from: …"). | ☐ |
| O-SHOP-03 | P2 | Clear the name. | The default name returns. Blank fields are emptied (not stored as spaces). | ☐ |
| O-SHOP-04 | P2 | Phone "call us"; WhatsApp "abc"; email "nope"; address over 300 characters; name over 80. | Refused on the right field. | ☐ |
| O-SHOP-05 | P3 | Clear the address. | The footer falls back to "Road 9, Maadi" and "Cairo, Egypt". | ☐ |
| O-TEAM-01 | P1 | Open **Team**. | A table of staff and owners with role, status, last sign-in and actions; your own row says "This is your account" with no actions. | ☐ |
| O-TEAM-02 | P1 | **Add a team member**: name, email, role Staff, a temporary password. | "… was added. Tell them their email and temporary password…" The form clears (the password is not kept). | ☐ |
| O-TEAM-03 | P1 | Sign in as that person in another window. | They reach the queue and prep sheet only (S-ACC cases). They can change their password under My account. | ☐ |
| O-TEAM-04 | P2 | Add with a short password; a bad role; an empty name; an invalid email. | Each refused with a field message. | ☐ |
| O-TEAM-05 | P2 | Add with an email already used (also by a customer). | "An account with this email already exists." | ☐ |
| O-TEAM-06 | P2 | **Make owner** for the new person; sign in as them. | They can open all owner screens. **Make staff** reverses it. | ☐ |
| O-TEAM-07 | P1 | **Remove** a member (confirm). | "… was removed and can no longer sign in." They show as Removed. Their open session ends at their next click. Signing in is refused. | ☐ |
| O-TEAM-08 | P2 | **Switch back on**. | They can sign in again. | ☐ |
| O-TEAM-09 | P2 | Try to change your own role, switch yourself off, remove yourself. | Refused ("You cannot change your own role…"). | ☐ |
| O-TEAM-10 | P2 | With two owners, remove the other owner; then try to demote or remove the last remaining one. | The first is allowed; the last active owner can never be removed or demoted. | ☐ |
| O-TEAM-11 | P3 | Two owners remove each other at the same moment. | One removal wins; at least one active owner always remains. | ☐ |
| O-TEAM-12 | P3 | A customer's id is used in the team address (API). | Not found; customers cannot be managed here. | ☐ |
| O-TEAM-13 | P3 | A removed staff member's emails, orders history. | History they created stays (their actions remain in order histories). | ☐ |

## 13. Cross-cutting checks

### 13.1 The nine emails

Place the right action, then check each arrives, to the customer's address, with the shop name, correct details and a working tracking link (open it).

| ID | P | Trigger | Expected content | ☐ |
|---|---|---|---|---|
| X-MAIL-01 | P1 | Cash order placed; card order paid | **Order confirmed**: items with messages, total, "Delivery/Pickup: date and time", address or pickup place, payment line, tracking link. Cash is sent at once; card only after payment. | ☐ |
| X-MAIL-02 | P1 | Staff accept | **Order accepted**. | ☐ |
| X-MAIL-03 | P1 | Staff decline | **Order declined** with the reason; mentions a refund for paid orders. | ☐ |
| X-MAIL-04 | P1 | Each later stage | **Order status update** saying "Being prepared", "Ready", "Out for delivery", "Delivered" or "Collected". | ☐ |
| X-MAIL-05 | P2 | Staff mark late | **Running late** with the note. | ☐ |
| X-MAIL-06 | P1 | Staff cancel; customer cancel; unpaid order expires; late payment refunded | **Order cancelled** with the matching reason (and the refund sentence for paid orders). | ☐ |
| X-MAIL-07 | P1 | Customer changes the order | **Order updated** with the new details. | ☐ |
| X-MAIL-08 | P1 | Staff send a message | **A message about your order** with the text. | ☐ |
| X-MAIL-09 | P1 | Forgot password | **Reset your password** with a link valid 30 minutes. | ☐ |
| X-MAIL-10 | P2 | Pickup order | The email says "Collect from: …" with the owner's pickup place. | ☐ |
| X-MAIL-11 | P3 | A customer name or message with `<b>`, quotes and non-English letters. | Shown as plain text, nothing breaks. | ☐ |
| X-MAIL-12 | P3 | The sender is Gmail. | Check spam if an email does not arrive; the email log shows it as sent. | ☐ |

### 13.2 Money and capacity stay correct

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-DATA-01 | P1 | Place an order, cancel it, place again for the same last slot. | The slot and units were freed by the cancel; the second order succeeds. | ☐ |
| X-DATA-02 | P2 | After a decline, a customer cancel, an expiry and a change, compare the day's bookings (try to book one more than the limit). | Counts equal the live orders; no leak and no negative. | ☐ |
| X-DATA-03 | P2 | Every refund. | The order's payment status, the payment's refunded amount and Paymob's dashboard agree. | ☐ |
| X-DATA-04 | P2 | Open an order's history. | Every change is listed in order with the time, the reason and who did it. | ☐ |
| X-DATA-05 | P3 | Rename or re-price a product, archive a zone, then open old orders. | Old orders still show their original names, prices, fee and zone. | ☐ |
| X-DATA-06 | P3 | Order totals. | Subtotal + delivery fee = total, in piastres, with no rounding differences (try odd prices such as 99.99). | ☐ |

### 13.3 Time and the Cairo clock

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-TIME-01 | P2 | Set your computer to another time zone and open the site. | All times (slots, hours, deadlines) still show Cairo time. | ☐ |
| X-TIME-02 | P3 | Around midnight Cairo: what is "today" in the queue and in the date lists. | Today follows Cairo's date, not yours. | ☐ |
| X-TIME-03 | P3 | A slot starting exactly now. | Not offered (already started). | ☐ |
| X-TIME-04 | P3 | A change deadline falling on the daylight-saving change day (when Egypt changes its clock). | The deadline stays exactly the window before the slot's start. | ☐ |
| X-TIME-05 | P3 | An order for Friday (different hours). | Only slots inside Friday's hours are offered. | ☐ |

### 13.4 Security and access

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-SEC-01 | P1 | As a guest open `/account`, `/staff/orders`, `/admin/products`. | Sent to Sign in. | ☐ |
| X-SEC-02 | P1 | Role matrix: customer, staff, owner each open every area. | Customer: none of staff or owner. Staff: queue, prep sheet, read-only schedule and zones. Owner: all. | ☐ |
| X-SEC-03 | P1 | Look at the page source and the network traffic. | No payment secret keys, no email key, no password hashes anywhere. | ☐ |
| X-SEC-04 | P2 | Type `<script>alert(1)</script>`, `"><img src=x>` and `' OR 1=1 --` into every text field (names, notes, messages, addresses, search, product names). | Always shown as plain text. No alert, no error page, no wrong data. | ☐ |
| X-SEC-05 | P2 | Very long inputs (10,000 characters) in each field. | Refused with a length message or cut at the limit; no crash. | ☐ |
| X-SEC-06 | P2 | A made-up order code and a real one without the token. | The same "could not find" answer, so codes cannot be guessed. | ☐ |
| X-SEC-07 | P2 | Rapid actions (more than 10 orders a minute; 11 sign-ins). | Slowed down with a rate-limit message; recovers after a minute. | ☐ |
| X-SEC-08 | P2 | Use the site from a different web address than the configured one (a wrong origin). | The browser's cross-site check refuses the API calls (this is the CORS protection). | ☐ |
| X-SEC-09 | P3 | After a staff member is removed, use their old token on the API. | 401: the session is over. | ☐ |
| X-SEC-10 | P3 | The practice payment address on the live site. | Does not exist (it only works on the practice provider). | ☐ |
| X-SEC-11 | P3 | The old Stripe address. | Does not exist. | ☐ |
| X-SEC-12 | P3 | Paymob's callback address with no signature. | Refused (400). | ☐ |

### 13.5 Accessibility

Run on the home page, menu, product, cart, checkout (each step), an order page, sign in, account, the queue and an order, and one owner screen.

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-A11Y-01 | P1 | Use only the keyboard to place an order from the home page to the order page. | Everything reachable; focus always visible; no keyboard trap; the skip link works. | ☐ |
| X-A11Y-02 | P1 | Screen reader (VoiceOver, NVDA or TalkBack) through the same flow. | Page titles and headings read; fields announced with labels and hints; errors announced and focused; status changes announced; the timeline reads done, current, not yet. | ☐ |
| X-A11Y-03 | P2 | Browser zoom 200% then 400%. | No overlap, no content lost, no two-direction scrolling on the main pages. | ☐ |
| X-A11Y-04 | P2 | Display: Extra large text on every page above. | Nothing cut off or overlapping; menus still fit. | ☐ |
| X-A11Y-05 | P2 | Display: High contrast on every page above. | All text readable, every control has a visible edge, links underlined. | ☐ |
| X-A11Y-06 | P2 | Reduce motion. | No sliding, fading or zooming anywhere. | ☐ |
| X-A11Y-07 | P2 | Switch the screen to greyscale. | Statuses (Received, Late, Cancelled) can still be told apart by words and icons. | ☐ |
| X-A11Y-08 | P2 | Forms: submit each with mistakes. | A summary takes focus; each field shows its own message linked to it; messages say how to fix the problem. | ☐ |
| X-A11Y-09 | P2 | Run Lighthouse (Accessibility) on six key pages. | 100, or each remaining item explained. | ☐ |
| X-A11Y-10 | P3 | Tap targets on a phone. | Every control is at least about 44 pixels tall and not crowded. | ☐ |
| X-A11Y-11 | P3 | Open each menu (Display, account, Filters) with Enter and Space and close with Escape. | Works; focus returns to the button. | ☐ |

### 13.6 Devices and browsers

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-DEV-01 | P1 | Chrome, Safari, Firefox and Edge, current versions: the main order flow (sections 6 and 7). | Same behaviour and look. | ☐ |
| X-DEV-02 | P1 | iPhone (Safari) and Android (Chrome): home, menu, filters, product, cart, checkout, order page, sign in and out. | Usable one-handed; nothing overflows; the phone bar behaves. | ☐ |
| X-DEV-03 | P2 | Widths 320, 390, 768, 1024, 1440. | Layouts adapt; no sideways scrolling; header stays tidy. | ☐ |
| X-DEV-04 | P2 | Rotate a phone while on checkout. | Your answers stay; the layout reflows. | ☐ |
| X-DEV-05 | P3 | Back, forward and reload on every step of checkout and an order page. | No lost data; no duplicate orders; the page recovers. | ☐ |
| X-DEV-06 | P3 | Private window with browser storage blocked. | The site still works for browsing; the cart lasts until reload (the site must not crash). | ☐ |
| X-DEV-07 | P3 | Print the prep sheet and an order page. | Clean print without header, footer or buttons. | ☐ |

### 13.7 Resilience

| ID | P | Scenario | Expected | ☐ |
|---|---|---|---|---|
| X-RES-01 | P2 | Slow network (throttle to Slow 3G). | Pages show loading states; buttons disable while saving; nothing doubles. | ☐ |
| X-RES-02 | P2 | Go offline mid-session, then back online. | Messages like "We could not …" appear, no crash; actions work again afterwards. | ☐ |
| X-RES-03 | P2 | Restart the server while an order is on the payment page. | After it restarts the payment confirmation still arrives and the order confirms; unpaid expiry still works. | ☐ |
| X-RES-04 | P3 | Stop the email service, place and cancel orders. | Orders and cancels all succeed; emails retry and show in the log. | ☐ |
| X-RES-05 | P3 | Many orders (100+) on one day. | The queue, prep sheet and history stay fast and paged. | ☐ |

### 13.8 Deployment smoke test (after each deploy)

| ID | P | Check | Expected | ☐ |
|---|---|---|---|---|
| X-DEP-01 | P1 | Open `<backend address>/healthz`. | `{"status":"ok"}`. | ☐ |
| X-DEP-02 | P1 | Load the site from its public web address. | No errors in the browser console; data loads (so cross-site settings are right). | ☐ |
| X-DEP-03 | P1 | The deploy log. | "Applying migrations" finished; no errors; the app started. | ☐ |
| X-DEP-04 | P1 | New tables and columns work (orders, carts, addresses, policies, shop details). | Saving a policy, an address and a cart works. | ☐ |
| X-DEP-05 | P1 | Place and pay a test card order (section 7). | Confirms within seconds (proves the callback address and secret are right). | ☐ |
| X-DEP-06 | P1 | A refund from the queue. | Succeeds in Paymob (proves the refund path). | ☐ |
| X-DEP-07 | P1 | **Send me a test email**. | Arrives (proves the email sender). | ☐ |
| X-DEP-08 | P2 | Upload a product photo. | Shows on the menu from the storage address (proves photo storage). | ☐ |
| X-DEP-09 | P2 | Leave a card order unpaid for 36 minutes. | It is cancelled and the slot freed (proves the background jobs run). | ☐ |
| X-DEP-10 | P2 | Production safety: the practice payment provider is refused; the app refuses to start without photo storage. | The live site never shows the practice payment page. | ☐ |
| X-DEP-11 | P3 | The demo accounts (if enabled). | `staff@demo.thebaker` and `customer@demo.thebaker` sign in with the demo password and have the right access. | ☐ |
| X-DEP-12 | P3 | Changing the signing secret (only to test!). | Everyone is signed out and old guest tracking links stop working (so never change it casually). | ☐ |

## 14. The 30-minute smoke path

Run this after every change before anything else. If any step fails, stop and fix it first.

| Step | Test IDs | ☐ |
|---|---|---|
| 1. Home loads and Order now opens the menu | V-HOME-01, V-HOME-02 | ☐ |
| 2. Search, a category, Filters, a product | V-MENU-01, 02, 03, 07, V-PROD-01 | ☐ |
| 3. Add to cart, change a quantity | V-PROD-03, V-CART-01, 02 | ☐ |
| 4. Full cash checkout and the confirmation email | V-CO-01 to V-CO-09, X-MAIL-01 | ☐ |
| 5. Card checkout and payment | V-PAY-01, V-PAY-02 | ☐ |
| 6. Change an order, then cancel it | V-TRK-11, V-TRK-22 | ☐ |
| 7. Register, sign in, sign out | V-AUTH-01, V-AUTH-06, C-SEC-01 | ☐ |
| 8. Saved address used at checkout; cart returns after sign in | C-ADDR-09, C-CART-01, C-CART-02 | ☐ |
| 9. Staff: accept, prepare, message | S-ORD-03, S-ORD-04, S-ORD-22 | ☐ |
| 10. Decline a paid card order (refund) | S-ORD-10 | ☐ |
| 11. Prep sheet | S-PREP-01 | ☐ |
| 12. Owner screens open and a save works | O-POL-01, O-SHOP-01 | ☐ |
| 13. Team: add staff, remove | O-TEAM-02, O-TEAM-07 | ☐ |
| 14. A phone pass on the home page and checkout | V-HOME-15, V-CO-48 | ☐ |

## 15. Defect log

Copy one row per problem. Keep the test ID so it can be found again.

| # | Test ID | Where (page, user, device) | What you did | What you expected | What happened | Severity (blocker, major, minor) | Status |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

## 16. Sign-off

| Area | Tester | Date | P1 passed | P2 passed | P3 passed | Open defects | Result |
|---|---|---|---|---|---|---|---|
| Visitor (sections 1 to 9) | | | / | / | / | | |
| Customer (section 10) | | | / | / | / | | |
| Staff (section 11) | | | / | / | / | | |
| Owner (section 12) | | | / | / | / | | |
| Cross-cutting (section 13) | | | / | / | / | | |
| Smoke path (section 14) | | | / | n/a | n/a | | |

**Release rule:** every P1 passes, no open blocker or major defect, every P2 either passes or has an accepted, documented reason. P3 findings are logged and decided case by case.
