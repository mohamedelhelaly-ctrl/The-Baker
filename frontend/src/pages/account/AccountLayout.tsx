import { NavLink, Outlet } from "react-router";

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-4 font-semibold ${isActive ? "bg-primary text-primary-ink" : "border-2 border-line"}`;

/** Shell for the signed-in customer's pages: profile, saved addresses, order history. */
export default function AccountLayout() {
  return (
    <section>
      <h1 className="mb-4 font-display text-3xl font-bold">My account</h1>
      <nav aria-label="Account" className="mb-8 flex flex-wrap gap-2">
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
