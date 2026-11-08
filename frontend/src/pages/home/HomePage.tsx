import { useEffect } from "react";
import { s } from "../../lib/strings";

export default function HomePage() {
  useEffect(() => {
    document.title = `${s.brand} · Fresh cakes and bakes`;
  }, []);
  return (
    <section>
      <h1 className="font-display text-4xl font-bold">Fresh from our oven to your table</h1>
      <p className="mt-4 max-w-prose text-lg text-muted">
        Cakes, pastries and breads, made to order in Cairo. The menu is coming soon.
      </p>
    </section>
  );
}
