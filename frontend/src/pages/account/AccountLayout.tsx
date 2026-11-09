import { NavLink, Outlet } from "react-router";

const link = ({ isActive }: { isActive: boolean }) =>
  `-mb-px inline-flex min-h-12 items-center border-b-2 px-4 font-semibold transition ${isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"}`;

/** Shell for the signed-in customer's pages: profile, saved addresses, order history. */
export default function AccountLayout() {
  return (
    <section>
      <h1 className="mb-6 font-display text-4xl font-bold">My account</h1>
      <nav aria-label="Account" className="mb-8 flex flex-wrap border-b border-hairline">
        <NavLink to="/account" end className={link}>
          Profile
        </NavLink>
        <NavLink to="/account/orders" className={link}>
          My orders
        </NavLink>
        <NavLink to="/account/addresses" className={link}>
          Saved addresses
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
