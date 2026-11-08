import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextAreaField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { ErrorSummary } from "../auth/ErrorSummary";
import { StatusBadge } from "./StatusBadge";

interface Item {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_archived: boolean;
  description?: string | null;
}

/** Categories and occasions share one screen: same actions, categories also have a description. */
export default function AdminTaxonomyPage({ kind }: { kind: "categories" | "occasions" }) {
  const singular = kind === "categories" ? "category" : "occasion";
  const title = kind === "categories" ? "Categories" : "Occasions";
  usePageTitle(title);
  const list = useApi<Item[]>(`/admin/${kind}`);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage({ kind: "success", text: success });
      list.reload();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  return (
    <>
      <h1 className="mb-6 font-display text-3xl font-bold">{title}</h1>
      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>

      <section aria-labelledby="add-heading" className="mb-10 max-w-lg rounded-lg border-2 border-line bg-surface p-4">
        <h2 id="add-heading" className="mb-3 font-display text-xl font-bold">
          Add a {singular}
        </h2>
        <ItemForm
          withDescription={kind === "categories"}
          submitLabel={`Add ${singular}`}
          onSave={async (body) => {
            await api.post(`/admin/${kind}`, body);
            setMessage({ kind: "success", text: `The ${singular} was added.` });
            list.reload();
          }}
          resetOnSave
        />
      </section>

      {list.data && (
        <ul className="grid gap-3">
          {list.data.map((item) => (
            <li key={item.id} className="rounded-lg border-2 border-line bg-surface p-4">
              {editing === item.id ? (
                <ItemForm
                  withDescription={kind === "categories"}
                  initial={item}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    await api.patch(`/admin/${kind}/${item.id}`, body);
                    setEditing(null);
                    setMessage({ kind: "success", text: `${body.name} was updated.` });
                    list.reload();
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">
                      {item.name} {item.is_archived && <StatusBadge kind="off">Archived</StatusBadge>}
                    </p>
                    {item.description && <p className="text-muted">{item.description}</p>}
                    <p className="text-sm text-muted">Display order: {item.sort_order}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditing(item.id)} className="min-h-11 rounded-md border-2 border-line px-3 font-semibold">
                      Edit{" "}<span className="sr-only">{item.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => run(() => api.post(`/admin/${kind}/${item.id}/${item.is_archived ? "restore" : "archive"}`), `${item.name} was ${item.is_archived ? "restored" : "archived"}.`)}
                      className="min-h-11 rounded-md border-2 border-line px-3 font-semibold"
                    >
                      {item.is_archived ? "Restore" : "Archive"}
                      {" "}<span className="sr-only">{item.name}</span>
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface FormBody {
  name: string;
  description?: string;
  sort_order: number;
}

function ItemForm({ initial, withDescription, submitLabel, onSave, onCancel, resetOnSave }: {
  initial?: Item;
  withDescription: boolean;
  submitLabel: string;
  onSave: (body: FormBody) => Promise<void>;
  onCancel?: () => void;
  resetOnSave?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [order, setOrder] = useState(String(initial?.sort_order ?? 0));
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    await onSave({ name, ...(withDescription ? { description } : {}), sort_order: Number(order) || 0 });
    if (resetOnSave) {
      setName("");
      setDescription("");
      setOrder("0");
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorSummary error={error} summaryRef={summaryRef} />
      <TextField label="Name" value={name} required onChange={(e) => setName(e.target.value)} error={error?.fields.name} />
      {withDescription && <TextAreaField label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} error={error?.fields.description} />}
      <TextField label="Display order" type="number" hint="Lower numbers come first." value={order} onChange={(e) => setOrder(e.target.value)} error={error?.fields.sort_order} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-11 rounded-md border-2 border-line px-5 font-semibold">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
