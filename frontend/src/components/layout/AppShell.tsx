import { Link, Outlet, useNavigate } from "react-router";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { WEEKDAYS, formatTime, hhmm } from "../../lib/dates";
import { useStore } from "../../lib/store";
import { s } from "../../lib/strings";
import { DisplayMenu } from "./DisplayMenu";

export function AppShell() {
  const { user, logout, can } = useAuth();
  const { opening_hours } = useStore();
  const { count, clear: clearCart } = useCart();
  const navigate = useNavigate();

  /** Signing out ends the session, empties the cart (it belongs to whoever is using this browser, and the
   *  next person to sign in must not inherit it) and goes straight to the sign-in page. */
  function signOut() {
    logout();
    clearCart();
    navigate("/login", { replace: true });
  }
  const link = "inline-flex min-h-11 items-center rounded-md px-3 font-semibold underline-offset-4 hover:underline";

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-ink"
      >
        {s.skipToContent}
      </a>
      <header className="sticky top-0 z-10 border-b-2 border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link to="/" className="font-display text-2xl font-bold">
            {s.brand}
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            <Link to="/menu" className={link}>
              {s.nav.menu}
            </Link>
            {can("orders_queue") && (
              <Link to="/staff/orders" className={link}>
                {s.nav.orders}
              </Link>
            )}
            {(can("catalog_admin") || can("schedule_admin") || can("settings")) && (
              <Link to="/admin" className={link}>
                {s.nav.manage}
              </Link>
            )}
            {user ? (
              <>
                <Link to="/account" className={link}>
                  {s.nav.account}
                </Link>
                <button type="button" onClick={signOut} className={`${link} cursor-pointer`}>
                  {s.nav.signOut}
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className={link}>
                  {s.nav.signIn}
                </Link>
                <Link to="/register" className={link}>
                  {s.nav.register}
                </Link>
              </>
            )}
            <Link to="/cart" className={link} aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
              <span aria-hidden="true">Cart ({count})</span>
            </Link>
            <DisplayMenu />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto min-h-[70vh] max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t-2 border-line px-4 py-8 print:hidden">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-2">
          {opening_hours.length > 0 && (
            <div>
              <h2 className="mb-2 font-display text-xl font-bold">
                Opening hours
              </h2>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                {[...opening_hours]
                  .sort((a, b) => a.weekday - b.weekday)
                  .map((h) => (
                    <div key={h.weekday} className="contents">
                      <dt className="font-semibold">{WEEKDAYS[h.weekday]}</dt>
                      <dd>{h.is_closed ? "Closed" : `${formatTime(hhmm(h.opens_at))} to ${formatTime(hhmm(h.closes_at))}`}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          <div>
            <h2 className="mb-2 font-display text-xl font-bold">
              Delivery
            </h2>
            <p>
              <Link to="/delivery" className="underline">
                Delivery areas and fees
              </Link>
            </p>
            <p className="mt-4 text-muted">{s.brand} · Demo store, no real orders.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
