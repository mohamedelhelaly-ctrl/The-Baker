import { useRef, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/dates";
import { refundSentence } from "../../lib/orders";
import { useStore } from "../../lib/store";
import type { Order } from "../../lib/types";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";

/** Change or cancel an order, while the owner's window is open and before preparation starts. */
export function ChangeOrCancel({ order, token, onCancelled }: { order: Order; token: string | null; onCancelled: (o: Order) => void }) {
  const { policy_text } = useStore();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false); // a fast double click must send only one request
  const query = token ? `?t=${encodeURIComponent(token)}` : "";

  if (order.status !== "received" && order.status !== "accepted") return null;

  if (!order.can_change) {
    return (
      <section aria-labelledby="change-h" className="mt-8 rounded-md border-2 border-line p-4">
        <h2 id="change-h" className="font-display text-xl font-bold">
          Need to change something?
        </h2>
        <p className="mt-2">The time to change or cancel this order online has passed. Please contact the bakery and we will do our best to help.</p>
      </section>
    );
  }

  async function cancel() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const cancelled = await api.post<Order>(`/orders/${encodeURIComponent(order.code)}/cancel${query}`, { reason: reason.trim() || undefined });
      onCancelled(cancelled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    } finally {
      running.current = false;
    }
  }

  const refund = refundSentence(order);
  return (
    <section aria-labelledby="change-h" className="mt-8 rounded-md border-2 border-line p-4">
      <h2 id="change-h" className="font-display text-xl font-bold">
        Change or cancel this order
      </h2>
      <p className="mt-2">
        You can change or cancel it until <strong>{order.can_modify_until && formatDateTime(order.can_modify_until)}</strong>.
      </p>
      {policy_text && <p className="mt-1 text-muted">{policy_text}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/track/${encodeURIComponent(order.code)}/change${query}`}
          className="inline-flex min-h-11 items-center rounded-md border-2 border-line px-4 font-semibold"
        >
          Change date, time or address
        </Link>
        <button type="button" aria-expanded={asking} className="min-h-11 rounded-md border-2 border-line px-4 font-semibold" onClick={() => setAsking(!asking)}>
          Cancel this order…
        </button>
      </div>
      {asking && (
        <div className="mt-4 max-w-xl">
          {error && <Alert kind="error">{error}</Alert>}
          <p className="mb-3 font-semibold">Are you sure you want to cancel?</p>
          {refund && <p className="mb-3">{refund}</p>}
          <TextField label="Reason (optional)" hint="Helps us improve." maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={cancel}>
              {pending ? "Cancelling…" : "Yes, cancel my order"}
            </Button>
            <button type="button" className="min-h-11 rounded-md border-2 border-line px-4 font-semibold" onClick={() => setAsking(false)}>
              Keep my order
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
