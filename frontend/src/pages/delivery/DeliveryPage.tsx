import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useMoney } from "../../lib/store";
import type { DeliveryZone } from "../../lib/types";

export default function DeliveryPage() {
  usePageTitle("Delivery areas and fees");
  const money = useMoney();
  const zones = useApi<DeliveryZone[]>("/delivery-zones");
  return (
    <section>
      <h1 className="mb-2 font-display text-3xl font-bold">Delivery areas and fees</h1>
      <p className="mb-6 max-w-prose text-muted">
        We deliver to these areas. You always see the delivery fee and your total before you pay. You can also collect your order from the bakery.
      </p>
      {zones.error && <p role="alert">We could not load the delivery areas. Please try again.</p>}
      {zones.data && zones.data.length === 0 && <p>Delivery is not available right now. Pickup is.</p>}
      {zones.data && zones.data.length > 0 && (
        <table className="w-full max-w-2xl border-collapse">
          <caption className="sr-only">Delivery areas, fees and minimum orders</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="p-2 text-start">Area</th>
              <th scope="col" className="p-2 text-start">Delivery fee</th>
              <th scope="col" className="p-2 text-start">Minimum order</th>
            </tr>
          </thead>
          <tbody>
            {zones.data.map((z) => (
              <tr key={z.id} className="border-b border-line">
                <th scope="row" className="p-2 text-start">{z.name}</th>
                <td className="p-2">{z.fee === 0 ? "Free" : money(z.fee)}</td>
                <td className="p-2">{z.min_order_amount === 0 ? "None" : money(z.min_order_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
