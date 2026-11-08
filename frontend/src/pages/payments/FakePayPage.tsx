import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import type { Order } from "../../lib/types";

/**
 * Stands in for the card provider's hosted page when the demo payment provider is active
 * (development and demos). No card details are collected and no money moves.
 */
export default function FakePayPage() {
  usePageTitle("Demo payment");
  const { code = "" } = useParams();
  const token = useSearchParams()[0].get("t") ?? "";
  const navigate = useNavigate();
  const { data: order, error } = useApi<Order>(`/orders/${encodeURIComponent(code)}?t=${encodeURIComponent(token)}`);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function finish(outcome: "paid" | "expired") {
    setPending(true);
    setProblem(null);
    try {
      await api.post(`/payments/fake/${encodeURIComponent(code)}/complete?t=${encodeURIComponent(token)}`, { outcome });
      navigate(`/track/${code}?t=${token}&${outcome === "paid" ? "paid" : "cancelled"}=1`, { replace: true });
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "Something went wrong.");
      setPending(false);
    }
  }

  if (error) {
    return (
      <section>
        <h1 className="font-display text-3xl font-bold">We could not find that order</h1>
        <p className="mt-4">
          <Link to="/menu" className="underline">
            Back to the menu
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="mb-4 font-display text-3xl font-bold">Demo payment page</h1>
      <Alert kind="success" title="This is a practice payment">
        No real card is used and no money moves. In the live shop this step happens on the payment provider's secure page.
      </Alert>
      {problem && <Alert kind="error">{problem}</Alert>}
      {order && (
        <p className="mb-6 text-lg">
          Order <strong>{order.code}</strong> · Amount to pay <strong>{formatMoney(order.total, order.currency)}</strong>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={pending || !order} onClick={() => finish("paid")}>
          Pay now (test)
        </Button>
        <button type="button" disabled={pending} onClick={() => finish("expired")} className="min-h-11 rounded-md border-2 border-line px-5 font-semibold">
          Cancel payment
        </button>
      </div>
    </section>
  );
}
