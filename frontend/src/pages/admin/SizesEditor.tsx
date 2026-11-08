import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { CheckboxField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { api, ApiError } from "../../lib/api";
import { parsePrice, toMajorString } from "../../lib/money";
import { useStore } from "../../lib/store";
import type { AdminProduct, AdminVariant } from "../../lib/types";

export function SizesEditor({ product, onChanged }: { product: AdminProduct; onChanged: () => void }) {
  const { currency, currency_exponent } = useStore();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState({ name: "", price: "" });

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage({ kind: "success", text: success });
      onChanged();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
      return false;
    }
  }

  return (
    <section aria-labelledby="sizes-heading" className="mb-12 max-w-2xl">
      <h2 id="sizes-heading" className="mb-3 font-display text-2xl font-bold">
        Sizes and prices
      </h2>
      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>
      <ul className="grid gap-3">
        {product.variants.map((v) => (
          <SizeRow
            key={`${v.id}-${v.name}-${v.price}-${v.is_active}`}
            productId={product.id}
            variant={v}
            canDelete={product.variants.length > 1}
            run={run}
            fail={(text) => setMessage({ kind: "error", text })}
          />
        ))}
      </ul>

      <form
        className="mt-6 rounded-lg border-2 border-line bg-surface p-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const price = parsePrice(adding.price, currency_exponent);
          if (!adding.name.trim() || price === null) {
            setMessage({ kind: "error", text: `Enter a size name and a price such as 450 or 450.50 (${currency}).` });
            return;
          }
          if (await run(() => api.post(`/admin/products/${product.id}/variants`, { name: adding.name, price }), "Size added.")) {
            setAdding({ name: "", price: "" });
          }
        }}
      >
        <h3 className="mb-2 font-bold">Add a size</h3>
        <div className="grid gap-x-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <TextField label="Size name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <TextField label={`Price (${currency})`} inputMode="decimal" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} />
          <button type="submit" className="mb-5 min-h-11 rounded-md bg-primary px-5 font-semibold text-primary-ink">
            Add size
          </button>
        </div>
      </form>
    </section>
  );
}

function SizeRow({ productId, variant, canDelete, run, fail }: {
  productId: number;
  variant: AdminVariant;
  canDelete: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
  fail: (text: string) => void;
}) {
  const url = `/admin/products/${productId}/variants/${variant.id}`;
  const { currency, currency_exponent } = useStore();
  const [name, setName] = useState(variant.name);
  const [price, setPrice] = useState(toMajorString(variant.price, currency_exponent));
  const [active, setActive] = useState(variant.is_active);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border-2 border-line bg-surface p-4">
      <div className="grid gap-x-3 sm:grid-cols-[1fr_10rem]">
        <TextField label="Size name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label={`Price (${currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <CheckboxField label="Available to order" checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md bg-primary px-4 font-semibold text-primary-ink"
          onClick={() => {
            const minor = parsePrice(price, currency_exponent);
            if (minor === null || !name.trim()) {
              fail(`Enter a size name and a price such as 450 or 450.50 (${currency}).`);
              return;
            }
            void run(() => api.patch(url, { name, price: minor, is_active: active }), `${name} saved.`);
          }}
        >
          Save{" "}<span className="sr-only">{variant.name}</span>
        </button>
        {canDelete &&
          (confirming ? (
            <>
              <button type="button" className="min-h-11 rounded-md border-2 border-danger px-4 font-semibold text-danger" onClick={() => void run(() => api.delete(url), `${variant.name} removed.`)}>
                Confirm remove{" "}<span className="sr-only">{variant.name}</span>
              </button>
              <button type="button" className="min-h-11 rounded-md border-2 border-line px-4 font-semibold" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="min-h-11 rounded-md border-2 border-line px-4 font-semibold" onClick={() => setConfirming(true)}>
              Remove{" "}<span className="sr-only">{variant.name}</span>
            </button>
          ))}
      </div>
    </li>
  );
}
