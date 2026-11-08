import { Link, Outlet } from "react-router";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";
import { DisplayMenu } from "./DisplayMenu";

export function AppShell() {
  const { user, logout } = useAuth();
  const link = "inline-flex min-h-11 items-center rounded-md px-3 font-semibold underline-offset-4 hover:underline";

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-ink"
      >
        {s.skipToContent}
      </a>
      <header className="sticky top-0 z-10 border-b-2 border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link to="/" className="font-display text-2xl font-bold">
            {s.brand}
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            {user ? (
              <>
                <Link to="/account" className={link}>
                  {s.nav.account}
                </Link>
                <button type="button" onClick={logout} className={`${link} cursor-pointer`}>
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
            <DisplayMenu />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto min-h-[70vh] max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t-2 border-line px-4 py-6 text-center text-muted">
        <p>
          {s.brand} · Demo store, no real orders.
        </p>
      </footer>
    </>
  );
}
