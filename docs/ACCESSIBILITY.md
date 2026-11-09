# Accessibility audit

The Baker aims for **WCAG 2.2 level AA** (decision D1). The store is meant to work for elderly customers, people with limited mobility, and people who use a screen reader, magnifier or keyboard only.

This document says what is built in, what is checked automatically on every change, and, just as important, **what has not been tested by a person yet**. An automated checker finds roughly a third of real accessibility problems, so the manual checklist at the end is part of the audit, not an extra.

## 1. Checked automatically on every change

| Check | What it catches | Where |
|---|---|---|
| Lint rules (`jsx-a11y`: image alt text, no autofocus, valid links) | Missing alt text, broken anchors, focus stealing | `npm run lint`, in CI |
| axe-core on every screen, about 30 checks | Missing form labels, bad ARIA, duplicate IDs, missing landmarks, empty buttons and links, heading problems | `*.test.tsx`, in CI |
| Contrast of every colour pair in both themes | Text under 4.5:1, borders and focus ring under 3:1, in the normal and the high-contrast theme | `src/test/tokens.test.ts`, in CI |
| One level-one heading per page, skip link first and pointing at the main content | Page structure for screen-reader and keyboard users | `src/a11y.test.tsx` |
| Behavioural tests that find controls **by their accessible name**, as a screen reader would | Controls that have no usable name, or a name that does not say what they do | all UI tests |

Screens covered by axe: home, menu, product, cart, every checkout step, the order page in six states (waiting for payment, running late, cancelled, declined, delivered, changeable), change-order, sign in, register, forgot and reset password, the account pages (profile, orders, addresses), the delivery page, the practice payment page, the 404 and "not allowed" pages, the display menu, and every owner and staff screen (products, product editor, categories, occasions, schedule, delivery zones, payments and emails, cancellation and refunds, shop details, team, order queue, order detail, prep sheet).

## 2. What is built in, by WCAG principle

**Perceivable**
- Every product image has alt text. The owner cannot upload a photo without it (1.1.1).
- Status is never shown by colour alone: it always has an icon or text as well, for example "✓ Active", "⚠ Late", "Received" (1.4.1).
- Colour tokens meet 4.5:1 for text and 3:1 for borders and the focus ring (1.4.3, 1.4.11). A **high-contrast** theme is one click away and also underlines links.
- **Text size** can be raised to 125% or 150% from the Display menu. Layouts use relative units, so they reflow instead of overlapping (1.4.4, 1.4.10).
- Reduced motion is respected, both from the visitor's system setting and from a Display menu switch (2.3.3).

**Operable**
- Everything works with the keyboard alone. A **skip link** is the first tab stop (2.4.1). Focus is always visible, a 3-pixel ring that is never clipped, and the sticky header never covers the focused item (2.4.7, 2.4.11).
- Interactive controls are at least 44 pixels tall, well above the 24-pixel minimum (2.5.8).
- Multi-step checkout moves focus to the step heading, so keyboard and screen-reader users land where the content changed.
- Destructive actions (cancel an order, delete an address, remove a team member) ask first and are never triggered by a single stray click. A double click cannot place an order or cancel it twice.

**Understandable**
- Every form field has a visible label that is linked to it. Hints and errors are linked with `aria-describedby`, and invalid fields are marked (1.3.1, 3.3.1, 3.3.2).
- When a form fails, an **error summary** takes focus and each field shows its own message. Messages say how to fix the problem ("Enter a valid email address, such as sara@example.com") (3.3.3).
- Fields use the right `autocomplete` values and input types (1.3.5). Saved addresses and contact details are prefilled, so nobody types the same thing twice (3.3.7).
- Dates, times and prices are formatted in full words and symbols, in one language (English).

**Robust**
- Native elements are used wherever possible (buttons, links, tables with captions and header cells, fieldsets with legends).
- Changes that happen without a page load, such as "Order is now: Accepted" or "Your details were saved", are announced through live regions.
- The order queue, prep sheet and team list are real tables with `scope` headers and a caption.

## 3. Known limitations (honest list)

1. **No screen-reader or real-device testing has been done by a person.** Section 4 is the checklist to do that. Until it is done, claims about the screen-reader experience rest on automated checks and on the use of standard elements.
2. **Contrast is verified on the design tokens, not on rendered pages.** The test environment cannot compute colours. Check the live site with a browser tool (Lighthouse, or the axe DevTools extension) for colours that come from images or from combinations the tokens test does not list.
3. **Zoom and reflow at 400% and on a phone** are designed for (responsive layout, relative units) but not measured. Wide tables (the order queue, the team list) scroll sideways on a narrow screen.
4. **Native date pickers** are used for the queue day and the prep-sheet day. Their accessibility depends on the browser.
5. **Placeholder product images** are generated tiles. Their alt text says what the product is, but they carry no extra information. Real photos need real descriptions, which the owner must write.
6. **English only, left to right.** There is no Arabic or right-to-left layout (decision D5). Strings are centralised so a translation could be added.
7. **No authentication step beyond a password.** There is no CAPTCHA or timed challenge, so nothing in sign-in depends on solving a puzzle (3.3.8 is met by default).
8. The practice payment page and the Paymob page are separate sites. The Paymob checkout is outside this project's control.

## 4. Manual test checklist (to run before showing the project)

Run each item once on a laptop and once on a phone. Tick it off or write what failed.

**Keyboard only (no mouse)**
- [ ] From the home page, reach the menu, add a cake to the cart, check out with cash on delivery, and see the confirmation, using only Tab, Shift+Tab, Enter, Space and the arrow keys.
- [ ] The first Tab stop is "Skip to main content" and it works.
- [ ] You can always see where focus is.
- [ ] Nothing traps focus. Esc or Tab gets out of every menu.

**Screen reader** (VoiceOver on Mac or iPhone, NVDA on Windows, or TalkBack on Android)
- [ ] The page title and the main heading are read when a page opens.
- [ ] On the menu, each product is announced with its name and price, and the search box has a name.
- [ ] In checkout, each field is announced with its label and hint. A deliberate mistake (an empty required field) is announced as an error and focus goes to the summary.
- [ ] The order page announces the current status and the progress list ("done", "current", "not yet").
- [ ] As staff: moving an order to the next stage announces the result without moving focus away.

**Display settings**
- [ ] Display menu, text size "Extra large": no text is cut off and nothing overlaps on the menu, cart, checkout and order queue.
- [ ] Display menu, high contrast: every page stays readable and every button has a visible edge.
- [ ] Reduce motion: nothing slides, fades or bounces.

**Zoom and phone**
- [ ] Browser zoom at 200%, then 400%: you can still complete a purchase without scrolling in two directions on the main pages.
- [ ] On a phone in portrait: nothing is cut off, buttons are easy to hit with a thumb.

**Colour**
- [ ] Run Lighthouse (Chrome DevTools, Accessibility) on home, menu, a product, cart, checkout and an order page: score 100, or each remaining item is understood.
- [ ] Switch the screen to greyscale: status (Received, Late, Cancelled) can still be told apart.
