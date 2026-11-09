import { Link } from "react-router";
import { buttonClass } from "../../components/ui/buttonClass";
import { s } from "../../lib/strings";

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md py-12 text-center">
      <p className="font-display text-6xl font-bold text-primary" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold">{s.errors.notFoundTitle}</h1>
      <p className="mt-3 text-muted">{s.errors.notFoundBody}</p>
      <p className="mt-8">
        <Link to="/" className={buttonClass("primary", "px-8")}>
          {s.nav.home}
        </Link>
      </p>
    </section>
  );
}
