import type { Fulfilment, OrderStatus } from "./types";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Waiting for payment",
  received: "Received",
  accepted: "Accepted",
  preparing: "Being prepared",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  picked_up: "Picked up",
  rejected: "Declined",
  cancelled: "Cancelled",
};

/** The happy path an order follows. Rejected and cancelled orders leave it and are shown separately. */
export function progress(fulfilment: Fulfilment): OrderStatus[] {
  return fulfilment === "delivery"
    ? ["received", "accepted", "preparing", "ready", "out_for_delivery", "delivered"]
    : ["received", "accepted", "preparing", "ready", "picked_up"];
}

/** Cart lines as the availability endpoints want them: "variantId:qty,...". */
export function itemsParam(lines: { variantId: number; quantity: number }[]): string {
  const totals = new Map<number, number>();
  for (const l of lines) totals.set(l.variantId, (totals.get(l.variantId) ?? 0) + l.quantity);
  return [...totals].map(([id, qty]) => `${id}:${qty}`).join(",");
}

/** Button text for each next step staff can take (the server decides which are allowed). */
export const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: "Accept order",
  preparing: "Start preparing",
  ready: "Mark ready",
  out_for_delivery: "Send out for delivery",
  delivered: "Mark delivered",
  picked_up: "Mark collected",
  rejected: "Decline order",
  cancelled: "Cancel order",
};

export const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "Not paid yet",
  pending: "Waiting for payment",
  paid: "Paid",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  failed: "Payment failed",
};
