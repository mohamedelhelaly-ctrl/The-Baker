import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatClock, formatDate, todayIso } from "../../lib/dates";
import type { PrepSheet } from "../../lib/types";

/** What the kitchen has to make on one day, with the messages to write on cakes. Printable. */
export default function StaffPrepSheetPage() {
  usePageTitle("Prep sheet");
  const [day, setDay] = useState(todayIso());
  const sheet = useApi<PrepSheet>(day ? `/staff/prep-sheet?date=${day}` : null);
  const data = sheet.data;

  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Prep sheet</h1>
      <div className="mb-6 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="prep-day" className="mb-1 block font-semibold">
            Day
          </label>
          <input id="prep-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="min-h-11 rounded-md border-2 border-line bg-surface px-3 py-2" />
        </div>
        <button type="button" className="min-h-11 rounded-md border-2 border-line px-4 font-semibold" onClick={() => window.print()}>
          Print this sheet
        </button>
      </div>
      {sheet.error && <p role="alert" className="text-danger">We could not load the prep sheet. Please try again.</p>}
      {sheet.loading && !data && <output>Loading…</output>}
      {data && (
        <>
          <p className="mb-4 text-lg">
            <strong>{formatDate(data.date)}</strong>: {data.total_units} {data.total_units === 1 ? "item" : "items"} to make for {data.order_count} {data.order_count === 1 ? "order" : "orders"}.
            Declined, cancelled and unpaid orders are not counted.
          </p>
          {data.lines.length === 0 ? (
            <p className="rounded-md border-2 border-line p-4">Nothing to make on this day.</p>
          ) : (
            <table className="mb-8 w-full max-w-2xl border-collapse">
              <caption className="sr-only">Quantities to make</caption>
              <thead>
                <tr className="border-b-2 border-line">
                  <th scope="col" className="py-2 text-start">Product</th>
                  <th scope="col" className="py-2 text-start">Size</th>
                  <th scope="col" className="py-2 text-end">Make</th>
                  <th scope="col" className="py-2 text-end">Orders</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={`${l.product_name}|${l.variant_name}`} className="border-b border-line">
                    <td className="py-2">{l.product_name}</td>
                    <td className="py-2">{l.variant_name}</td>
                    <td className="py-2 text-end font-bold">{l.quantity}</td>
                    <td className="py-2 text-end">{l.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.messages.length > 0 && (
            <section aria-labelledby="inscr-h">
              <h2 id="inscr-h" className="mb-2 font-display text-xl font-bold">
                Messages to write on cakes
              </h2>
              <ul className="space-y-2">
                {data.messages.map((m, n) => (
                  <li key={n} className="border-b border-line pb-2">
                    <strong>“{m.text}”</strong>
                    <span className="block text-muted">
                      {m.quantity} × {m.product_name} ({m.variant_name}), {formatClock(m.slot_starts_at)}
                    </span>
                    <span className="block">
                      Order{" "}
                      <Link to={`/staff/orders?q=${m.order_code}`} className="underline print:no-underline">
                        {m.order_code}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
