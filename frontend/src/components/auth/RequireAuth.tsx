import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";
import { Loading } from "../ui/Loading";

/** Logged-in users only. Remembers where they were going. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
