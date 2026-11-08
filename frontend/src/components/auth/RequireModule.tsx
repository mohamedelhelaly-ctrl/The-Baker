import { Outlet } from "react-router";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";

/** Hides pages the role cannot use. The server enforces access; this is only for UX. */
export function RequireModule({ module }: { module: string }) {
  const { can } = useAuth();
  if (!can(module)) {
    return (
      <>
        <h1 className="font-display text-3xl">{s.errors.forbiddenTitle}</h1>
      </>
    );
  }
  return <Outlet />;
}
