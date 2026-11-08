import { Link } from "react-router";
import { s } from "../../lib/strings";

export default function NotFoundPage() {
  return (
    <section>
      <h1 className="font-display text-3xl font-bold">{s.errors.notFoundTitle}</h1>
      <p className="mt-4">{s.errors.notFoundBody}</p>
      <p className="mt-4">
        <Link to="/" className="underline">
          {s.nav.home}
        </Link>
      </p>
    </section>
  );
}
