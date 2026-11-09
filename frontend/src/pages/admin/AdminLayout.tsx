import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-4 font-semibold ${isActive ? "bg-primary text-primary-ink" : "border-2 border-line"}`;

/** Shop management shell. Each link only shows if the role can open that area (the server still enforces it). */
export default function AdminLayout() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const catalog = can("catalog_admin");
  const schedule = can("schedule_admin");
  const settings = can("settings");
  const team = can("team");

  if (!catalog && !schedule && !settings && !team) {
    return <h1 className="font-display text-3xl">{s.errors.forbiddenTitle}</h1>;
  }
  if (pathname.replace(/\/$/, "") === "/admin") {
    return <Navigate to={catalog ? "/admin/products" : schedule ? "/admin/schedule" : "/admin/payments"} replace />;
  }
  return (
    <>
      <nav aria-label="Shop management" className="mb-8 flex flex-wrap gap-2">
        {catalog && (
          <>
            <NavLink to="/admin/products" className={link}>
              Products
            </NavLink>
            <NavLink to="/admin/categories" className={link}>
              Categories
            </NavLink>
            <NavLink to="/admin/occasions" className={link}>
              Occasions
            </NavLink>
          </>
        )}
        {schedule && (
          <>
            <NavLink to="/admin/schedule" className={link}>
              Schedule
            </NavLink>
            <NavLink to="/admin/delivery-zones" className={link}>
              Delivery zones
            </NavLink>
          </>
        )}
        {settings && (
          <>
            <NavLink to="/admin/payments" className={link}>
              Payments and emails
            </NavLink>
            <NavLink to="/admin/policies" className={link}>
              Cancellation and refunds
            </NavLink>
            <NavLink to="/admin/shop" className={link}>
              Shop details
            </NavLink>
          </>
        )}
        {team && (
          <NavLink to="/admin/team" className={link}>
            Team
          </NavLink>
        )}
      </nav>
      <Outlet />
    </>
  );
}
