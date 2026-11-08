import { useRef, useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { api, ApiError } from "../../lib/api";
import { getToken } from "../../lib/session";
import type { AdminProduct, ProductImage } from "../../lib/types";

const API = `${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/api/v1`;
const MAX_BYTES = 5 * 1024 * 1024;

export function ImagesEditor({ product, onChanged }: { product: AdminProduct; onChanged: () => void }) {
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage({ kind: "success", text: success });
      onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage({ kind: "error", text: "Choose a photo to upload." });
    if (!alt.trim()) return setMessage({ kind: "error", text: "Describe the photo for people who cannot see it (alt text)." });
    if (file.size > MAX_BYTES) return setMessage({ kind: "error", text: "Photos can be at most 5 MB." });
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("alt_text", alt);
      const res = await fetch(`${API}/admin/products/${product.id}/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` }, // no Content-Type: the browser sets the boundary
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new ApiError(res.status, payload?.error?.code ?? "error", payload?.error?.message ?? "Upload failed.");
      }
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
      setMessage({ kind: "success", text: "Photo added." });
      onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "We could not reach the server." });
    } finally {
      setUploading(false);
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const a = product.images[i];
    const b = product.images[i + dir];
    // Renumber the whole list so ties and gaps cannot cause surprises.
    const order = product.images.map((img) => img.id);
    order[i] = b.id;
    order[i + dir] = a.id;
    return run(async () => {
      for (const [index, id] of order.entries()) {
        await api.patch(`/admin/products/${product.id}/images/${id}`, { sort_order: index });
      }
    }, `Moved ${a.alt_text} ${dir < 0 ? "earlier" : "later"}.`);
  };

  return (
    <section aria-labelledby="photos-heading" className="mb-12 max-w-2xl">
      <h2 id="photos-heading" className="mb-3 font-display text-2xl font-bold">
        Photos
      </h2>
      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>

      <ul className="grid gap-3">
        {product.images.map((img, i) => (
          <PhotoRow key={`${img.id}-${img.alt_text}`} image={img} index={i} count={product.images.length} productId={product.id} run={run} move={move} />
        ))}
      </ul>
      {product.images.length === 0 && <p className="mb-4 text-muted">No photos yet. Customers see a blank tile until you add one.</p>}

      <form onSubmit={upload} noValidate className="mt-6 rounded-lg border-2 border-line bg-surface p-4">
        <h3 className="mb-2 font-bold">Add a photo</h3>
        <div className="mb-5">
          <label htmlFor="photo-file" className="mb-1 block font-semibold">
            Photo file
          </label>
          <p className="mb-1 text-sm text-muted">JPEG, PNG or WebP, up to 5 MB.</p>
          <input id="photo-file" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="min-h-11 w-full" />
        </div>
        <TextField label="Describe the photo (alt text)" hint="For screen reader users, for example “A three-layer chocolate cake with dark ganache”." value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
        <Button type="submit" disabled={uploading}>
          {uploading ? "Uploading…" : "Upload photo"}
        </Button>
      </form>
    </section>
  );
}

function PhotoRow({ image, index, count, productId, run, move }: {
  image: ProductImage;
  index: number;
  count: number;
  productId: number;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  move: (i: number, dir: -1 | 1) => Promise<void>;
}) {
  const [alt, setAlt] = useState(image.alt_text);
  const [confirming, setConfirming] = useState(false);
  const url = `/admin/products/${productId}/images/${image.id}`;
  const btn = "min-h-11 rounded-md border-2 border-line px-3 font-semibold disabled:opacity-50";
  return (
    <li className="grid gap-4 rounded-lg border-2 border-line bg-surface p-4 sm:grid-cols-[8rem_1fr]">
      <img src={image.url} alt={image.alt_text} className="size-32 rounded-md object-cover" />
      <div>
        <TextField label={`Alt text for photo ${index + 1}`} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={!alt.trim() || alt === image.alt_text} onClick={() => void run(() => api.patch(url, { alt_text: alt }), "Alt text saved.")}>
            Save alt text{" "}<span className="sr-only">for photo {index + 1}</span>
          </button>
          <button type="button" className={btn} disabled={index === 0} onClick={() => void move(index, -1)}>
            Move earlier{" "}<span className="sr-only">photo {index + 1}</span>
          </button>
          <button type="button" className={btn} disabled={index === count - 1} onClick={() => void move(index, 1)}>
            Move later{" "}<span className="sr-only">photo {index + 1}</span>
          </button>
          {confirming ? (
            <>
              <button type="button" className="min-h-11 rounded-md border-2 border-danger px-3 font-semibold text-danger" onClick={() => void run(() => api.delete(url), "Photo deleted.")}>
                Confirm delete{" "}<span className="sr-only">photo {index + 1}</span>
              </button>
              <button type="button" className={btn} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className={btn} onClick={() => setConfirming(true)}>
              Delete{" "}<span className="sr-only">photo {index + 1}</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
