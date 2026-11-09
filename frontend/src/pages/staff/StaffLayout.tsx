import { NavLink, Navigate, Outlet, useLocation } from "react-router";

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-4 font-semibold ${isActive ? "bg-primary text-primary-ink" : "border-2 border-line"}`;

/** Shell for the staff screens (module: orders_queue). */
export default function StaffLayout() {
  const { pathname } = useLocation();
  if (pathname.replace(/\/$/, "") === "/staff") return <Navigate to="/staff/orders" replace />;
  return (
    <>
      <nav aria-label="Staff" className="mb-8 flex flex-wrap gap-2 print:hidden">
        <NavLink to="/staff/orders" className={link}>
          Order queue
        </NavLink>
        <NavLink to="/staff/prep-sheet" className={link}>
          Prep sheet
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
