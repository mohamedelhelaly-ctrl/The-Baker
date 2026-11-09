import { useState } from "react";
import { Link } from "react-router";
import { Pagination } from "../../components/ui/Pagination";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDateShort, formatSlotRange } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { STATUS_LABEL } from "../../lib/orders";
import type { OrderSummary, Page } from "../../lib/types";
import { StatusBadge } from "../admin/StatusBadge";

/** Past and current orders, newest first. Each one opens its tracking page. */
export default function OrdersPage() {
  usePageTitle("My orders");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Page<OrderSummary>>(`/me/orders?page=${page}`);

  return (
    <>
      <h2 className="mb-4 font-display text-2xl font-bold">My orders</h2>
      {error && <p role="alert" className="text-danger">We could not load your orders. Please try again.</p>}
      {loading && !data && <output>Loading…</output>}
      {data && data.items.length === 0 && (
        <p className="max-w-prose">
          You have not placed an order with this account yet.{" "}
          <Link to="/menu" className="underline">
            Browse the menu
          </Link>
          . Orders placed as a guest are not listed here.
        </p>
      )}
      {data && data.items.length > 0 && (
        <ul className="grid gap-3">
          {data.items.map((o) => (
            <li key={o.code} className="rounded-md border-2 border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link to={`/track/${o.code}`} className="text-lg font-bold underline">
                  Order {o.code}
                </Link>
                <StatusBadge kind={o.status === "rejected" || o.status === "cancelled" ? "off" : o.status === "delivered" || o.status === "picked_up" ? "ok" : "warn"}>
                  {STATUS_LABEL[o.status]}
                </StatusBadge>
              </div>
              <p className="mt-1">{o.summary}</p>
              <p className="mt-1 text-muted">
                {o.fulfilment_type === "delivery" ? "Delivery" : "Pickup"} on {formatDateShort(o.fulfilment_date)}, {formatSlotRange(o.slot_starts_at, o.slot_ends_at)}
              </p>
              <p className="mt-1 font-semibold">{formatMoney(o.total, o.currency)}</p>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} totalPages={data.total_pages} onChange={setPage} />}
    </>
  );
}
