import { NavLink, Outlet } from "react-router";

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-4 font-semibold ${isActive ? "bg-primary text-primary-ink" : "border-2 border-line"}`;

export default function AdminLayout() {
  return (
    <>
      <nav aria-label="Shop management" className="mb-8 flex flex-wrap gap-2">
        <NavLink to="/admin/products" className={link}>
          Products
        </NavLink>
        <NavLink to="/admin/categories" className={link}>
          Categories
        </NavLink>
        <NavLink to="/admin/occasions" className={link}>
          Occasions
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
