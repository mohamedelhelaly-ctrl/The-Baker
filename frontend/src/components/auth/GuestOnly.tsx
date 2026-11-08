import { Navigate, Outlet } from "react-router";
import { useAuth } from "../../lib/auth";
import { Loading } from "../ui/Loading";

/** Sign-in and registration pages are for signed-out visitors. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/account" replace />;
  return <Outlet />;
}
