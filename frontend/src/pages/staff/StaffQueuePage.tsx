import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Pagination } from "../../components/ui/Pagination";
import { useApi } from "../../hooks/useApi";
import { useDebounce } from "../../hooks/useDebounce";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDateShort, formatSlotRange, todayIso } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { STATUS_LABEL } from "../../lib/orders";
import type { OrderStatus, Page, QueueSummary, StaffOrderRow } from "../../lib/types";
import { StatusBadge } from "../admin/StatusBadge";

const REFRESH_MS = 30_000;
const FINISHED: OrderStatus[] = ["delivered", "picked_up", "rejected", "cancelled"];

const TABS: { value: string; label: string; statuses: OrderStatus[] | null }[] = [
  { value: "", label: "All", statuses: null },
  { value: "received", label: "New", statuses: ["received"] },
  { value: "accepted", label: "Accepted", statuses: ["accepted"] },
  { value: "preparing", label: "Preparing", statuses: ["preparing"] },
  { value: "ready", label: "Ready", statuses: ["ready"] },
  { value: "out_for_delivery", label: "Out for delivery", statuses: ["out_for_delivery"] },
  { value: "finished", label: "Finished", statuses: FINISHED },
];

function badgeKind(status: OrderStatus): "ok" | "warn" | "off" {
  if (status === "received") return "warn"; // needs a decision
  if (status === "rejected" || status === "cancelled") return "off";
  return "ok";
}

export default function StaffQueuePage() {
  usePageTitle("Order queue");
  const fromLink = useSearchParams()[0].get("q") ?? ""; // e.g. from the prep sheet: look up one order on any day
  const [day, setDay] = useState("");
  const [tab, setTab] = useState("");
  const [fulfilment, setFulfilment] = useState("");
  const [search, setSearch] = useState(fromLink);
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim());

  const params = new URLSearchParams({ page: String(page) });
  if (day) params.set("date", day);
  if (tab) params.set("status", tab);
  if (fulfilment) params.set("fulfilment", fulfilment);
  if (q) params.set("q", q);
  const list = useApi<Page<StaffOrderRow>>(`/staff/orders?${params}`);
  const summary = useApi<QueueSummary>(`/staff/orders/summary${day ? `?date=${day}` : ""}`);

  // New orders arrive while the page is open, so look again every so often.
  const { reload: reloadList } = list;
  const { reload: reloadSummary } = summary;
  useEffect(() => {
    const id = setInterval(() => {
      reloadList();
      reloadSummary();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reloadList, reloadSummary]);

  const count = (statuses: OrderStatus[] | null) =>
    summary.data ? (statuses ? statuses : (Object.keys(summary.data.counts) as OrderStatus[])).reduce((n, st) => n + (summary.data!.counts[st] ?? 0), 0) : null;
  const change = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const control = "min-h-11 rounded-md border-2 border-line bg-surface px-3 py-2";
  const rows = list.data?.items ?? [];

  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Order queue</h1>
      <p className="mb-6 max-w-prose text-muted">
        Orders to prepare for the chosen day. Open an order to accept it, move it along, or contact the customer. Card orders appear here once they are paid.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="queue-day" className="mb-1 block font-semibold">
            Day
          </label>
          <div className="flex gap-2">
            <input id="queue-day" type="date" className={control} value={day} onChange={(e) => change(() => setDay(e.target.value))} />
            <button type="button" className={`${control} font-semibold`} onClick={() => change(() => setDay(todayIso()))}>
              Today
            </button>
            <button type="button" className={`${control} font-semibold`} aria-pressed={day === ""} onClick={() => change(() => setDay(""))}>
              All days
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="queue-type" className="mb-1 block font-semibold">
            Delivery or pickup
          </label>
          <select id="queue-type" className={control} value={fulfilment} onChange={(e) => change(() => setFulfilment(e.target.value))}>
            <option value="">Both</option>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="queue-search" className="mb-1 block font-semibold">
            Search
          </label>
          <input
            id="queue-search"
            type="search"
            className={`${control} w-full`}
            placeholder="Order code, name, phone or email"
            value={search}
            onChange={(e) => change(() => setSearch(e.target.value))}
          />
        </div>
      </div>

      <fieldset className="mb-6 flex flex-wrap gap-2">
        <legend className="sr-only">Show orders that are</legend>
        {TABS.map((t) => {
          const n = count(t.statuses);
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => change(() => setTab(t.value))}
              className={`min-h-11 rounded-md border-2 px-4 font-semibold ${tab === t.value ? "border-primary bg-primary text-primary-ink" : "border-line"}`}
            >
              {t.label}
              {n !== null && ` (${n})`}
            </button>
          );
        })}
      </fieldset>
      {summary.data && summary.data.delayed > 0 && (
        <p className="mb-4 font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {summary.data.delayed} {summary.data.delayed === 1 ? "order is" : "orders are"} marked late.
        </p>
      )}

      {list.error && <p role="alert" className="text-danger">We could not load the orders. Please try again.</p>}
      {list.loading && !list.data && <output>Loading…</output>}
      {list.data && rows.length === 0 && <p className="rounded-md border-2 border-line p-4">No orders match these filters.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-start">
            <caption className="sr-only">
              Orders, {list.data!.total} in total, page {list.data!.page} of {list.data!.total_pages}
            </caption>
            <thead>
              <tr className="border-b-2 border-line text-start">
                {["Time", "Order", "Customer", "Type", "Items", "Total", "Status"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 text-start">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-line align-top">
                  <td className="px-2 py-3">
                    {day === "" && <span className="block text-sm text-muted">{formatDateShort(o.fulfilment_date)}</span>}
                    {formatSlotRange(o.slot_starts_at, o.slot_ends_at)}
                  </td>
                  <td className="px-2 py-3">
                    <Link to={`/staff/orders/${o.id}`} className="font-semibold underline">
                      {o.code}
                      <span className="sr-only">, open order</span>
                    </Link>
                  </td>
                  <td className="px-2 py-3">
                    {o.contact_name}
                    <span className="block text-sm text-muted">{o.contact_phone}</span>
                  </td>
                  <td className="px-2 py-3">
                    {o.fulfilment_type === "delivery" ? "Delivery" : "Pickup"}
                    {o.zone_name && <span className="block text-sm text-muted">{o.zone_name}</span>}
                  </td>
                  <td className="px-2 py-3">{o.item_count}</td>
                  <td className="px-2 py-3">
                    {formatMoney(o.total, o.currency)}
                    <span className="block text-sm text-muted">{o.payment_status === "paid" ? "Paid" : o.payment_method === "cod" ? "Cash" : "Card"}</span>
                  </td>
                  <td className="px-2 py-3">
                    <StatusBadge kind={badgeKind(o.status)}>{STATUS_LABEL[o.status]}</StatusBadge>
                    {o.is_delayed && (
                      <span className="mt-1 block">
                        <StatusBadge kind="warn">Late</StatusBadge>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.total_pages} onChange={setPage} />}
    </>
  );
}
