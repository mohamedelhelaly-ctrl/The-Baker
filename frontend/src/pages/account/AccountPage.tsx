import { useEffect } from "react";
import { useAuth } from "../../lib/auth";

export default function AccountPage() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = "My account · The Baker";
  }, []);
  return (
    <section>
      <h1 className="font-display text-3xl font-bold">My account</h1>
      <p className="mt-4">
        Signed in as <strong>{user?.full_name}</strong> ({user?.email}).
      </p>
    </section>
  );
}
