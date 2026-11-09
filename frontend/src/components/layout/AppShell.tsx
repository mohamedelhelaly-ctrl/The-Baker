import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { WEEKDAYS, formatTime, hhmm } from "../../lib/dates";
import { todayLine } from "../../lib/hours";
import { useStore } from "../../lib/store";
import { s } from "../../lib/strings";
import { buttonClass } from "../ui/buttonClass";
import { AccountMenu } from "./AccountMenu";
import { DisplayMenu } from "./DisplayMenu";
import { PhotoCredits } from "./PhotoCredits";

export function AppShell() {
  const { user, logout, can } = useAuth();
  const store = useStore();
  const { opening_hours } = store;
  const { count, clear: clearCart } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isHome = pathname === "/";
  const name = store.name || s.brand;
  const [year] = useState(() => new Date().getFullYear());

  /** Signing out ends the session, empties the cart (it belongs to whoever is using this browser, and the
   *  next person to sign in must not inherit it) and goes straight to the sign-in page. */
  function signOut() {
    logout();
    clearCart();
    navigate("/login", { replace: true });
  }

  const navLink = ({ isActive }: { isActive: boolean }) => `navlink ${isActive ? "navlink-active" : ""}`;
  const hasContact = store.phone || store.whatsapp || store.email || store.address;
  const today = todayLine(opening_hours);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:bg-primary focus:px-5 focus:py-3 focus:text-primary-ink"
      >
        {s.skipToContent}
      </a>
      <header className="sticky top-0 z-30 border-b border-hairline bg-bg print:hidden">
        <div className="wrap page flex flex-wrap items-center justify-between gap-x-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <Link to="/" className="order-1 py-2.5 font-display text-2xl tracking-tight sm:order-2">
            {name}
          </Link>
          <nav aria-label="Main" className="order-3 -ms-2.5 flex w-full items-center sm:order-1 sm:w-auto">
            <NavLink to="/menu" className={navLink}>
              {s.nav.menu}
            </NavLink>
            <NavLink to="/delivery" className={navLink}>
              Delivery
            </NavLink>
            <Link to="/#visit" className="navlink">
              Visit
            </Link>
            {can("orders_queue") && (
              <NavLink to="/staff/orders" className={navLink}>
                {s.nav.orders}
              </NavLink>
            )}
          </nav>
          <div className="order-2 flex items-center justify-end sm:order-3">
            <Link to="/cart" className="navlink" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Z" />
                <path d="M9 8V7a3 3 0 0 1 6 0v1" />
              </svg>
              <span aria-hidden="true" className="hidden sm:inline">Cart</span>
              {count > 0 && (
                <span aria-hidden="true" className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-medium leading-5 text-primary-ink">
                  {count}
                </span>
              )}
            </Link>
            {user ? (
              <AccountMenu onSignOut={signOut} />
            ) : (
              <Link to="/login" className="navlink">
                {s.nav.signIn}
              </Link>
            )}
            <DisplayMenu />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={isHome ? "" : "wrap page min-h-[70vh] py-8 sm:py-10"}>
        <Outlet />
      </main>
      <footer id="closing" className={`closing print:hidden ${isHome ? "closing--home" : ""}`}>
        {isHome && (
          <section aria-labelledby="close-h" className="ground-brand">
            <div className="wrap page flex h-full flex-col justify-center py-16">
              <h2 id="close-h" className="max-w-[18ch] font-display text-4xl leading-tight sm:text-5xl">
                Order a cake for pickup or delivery
              </h2>
              {today && <p className="mt-5 text-lg">Open today {today}</p>}
              <p className="mt-8">
                <Link to="/menu" className="btn btn-inverse px-8">
                  Order a cake
                </Link>
              </p>
            </div>
          </section>
        )}
        <div className="wrap page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="t-label mb-3">Visit</h2>
            <p>{store.address ?? "Cairo, Egypt"}</p>
            {store.pickup_location && <p className="mt-1 text-muted">Collect from: {store.pickup_location}</p>}
          </div>
          {hasContact && (
            <div>
              <h2 className="t-label mb-3">Contact</h2>
              <ul className="grid gap-1">
                {store.phone && (
                  <li>
                    Phone:{" "}
                    <a className="link" href={`tel:${store.phone.replace(/\s/g, "")}`}>
                      {store.phone}
                    </a>
                  </li>
                )}
                {store.whatsapp && (
                  <li>
                    WhatsApp:{" "}
                    <a className="link" href={`https://wa.me/${store.whatsapp.replace(/\D/g, "")}`}>
                      {store.whatsapp}
                    </a>
                  </li>
                )}
                {store.email && (
                  <li>
                    Email:{" "}
                    <a className="link" href={`mailto:${store.email}`}>
                      {store.email}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
          {opening_hours.length > 0 && (
            <div>
              <h2 className="t-label mb-3">Opening hours</h2>
              <dl className="grid max-w-xs grid-cols-[6.5rem_1fr] gap-y-1 text-sm">
                {[...opening_hours]
                  .sort((a, b) => a.weekday - b.weekday)
                  .map((h) => (
                    <div key={h.weekday} className="contents">
                      <dt className="font-medium">{WEEKDAYS[h.weekday]}</dt>
                      <dd>{h.is_closed ? "Closed" : `${formatTime(hhmm(h.opens_at))} to ${formatTime(hhmm(h.closes_at))}`}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          <div>
            <h2 className="t-label mb-3">Shop</h2>
            <ul className="grid gap-1">
              <li>
                <Link to="/menu" className="link">
                  Menu
                </Link>
              </li>
              <li>
                <Link to="/delivery" className="link">
                  Delivery areas and fees
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-hairline">
          <div className="wrap page flex flex-wrap items-center justify-between gap-x-6 py-3 text-sm text-muted">
            <p>
              {name} · {year} · Demo store, no real orders.
            </p>
            {isHome && <PhotoCredits />}
          </div>
        </div>
      </footer>
      {isHome && (
        <nav aria-label="Order" className="actionbar print:hidden">
          <Link to="/menu" className={buttonClass("primary", "w-full")}>
            Order a cake
          </Link>
        </nav>
      )}
    </>
  );
}
