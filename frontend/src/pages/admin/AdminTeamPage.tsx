import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { SelectField } from "../../components/ui/Field";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/dates";
import type { TeamMember } from "../../lib/types";
import { StatusBadge } from "./StatusBadge";

const ROLE_LABEL = { staff: "Staff", owner: "Owner" } as const;
const btn = "min-h-11 rounded-md border-2 border-line px-4 font-semibold disabled:opacity-60";

/** Owner: create and remove staff and owner accounts (requirement O3.1). */
export default function AdminTeamPage() {
  usePageTitle("Team");
  const { user } = useAuth();
  const team = useApi<TeamMember[]>("/admin/team");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function run(call: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await call();
      setMessage({ kind: "success", text: done });
      setConfirming(null);
      team.reload();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }

  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Team</h1>
      <p className="mb-6 max-w-prose text-muted">
        <strong>Staff</strong> can work the order queue and see the schedule. <strong>Owners</strong> can also manage the menu, the schedule, payments, policies, shop details and the team. A removed account is switched off, not erased, and can be switched back on.
      </p>
      <div aria-live="polite">{message && <Alert kind={message.kind}>{message.text}</Alert>}</div>
      {team.loading && !team.data && <output>Loading…</output>}
      {team.error && <p role="alert" className="text-danger">We could not load the team. Please try again.</p>}
      {team.data && (
        <table className="mb-10 w-full min-w-[40rem] border-collapse">
          <caption className="sr-only">Team members</caption>
          <thead>
            <tr className="border-b-2 border-line">
              {["Name", "Role", "Status", "Last sign-in", "Actions"].map((h) => (
                <th key={h} scope="col" className="px-2 py-2 text-start">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.data.map((m) => {
              const me = m.id === user?.id;
              return (
                <tr key={m.id} className="border-b border-line align-top">
                  <th scope="row" className="px-2 py-3 text-start font-semibold">
                    {m.full_name} {me && <span className="font-normal text-muted">(you)</span>}
                    <span className="block text-sm font-normal text-muted">{m.email}</span>
                  </th>
                  <td className="px-2 py-3">{ROLE_LABEL[m.role]}</td>
                  <td className="px-2 py-3">{m.is_active ? <StatusBadge kind="ok">Active</StatusBadge> : <StatusBadge kind="off">Removed</StatusBadge>}</td>
                  <td className="px-2 py-3">{m.last_login_at ? formatDateTime(m.last_login_at) : "Never"}</td>
                  <td className="px-2 py-3">
                    {me ? (
                      <span className="text-muted">This is your account</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {m.is_active && (
                          <button type="button" className={btn} onClick={() => run(() => api.patch(`/admin/team/${m.id}`, { role: m.role === "staff" ? "owner" : "staff" }), `${m.full_name} is now ${m.role === "staff" ? "an owner" : "staff"}.`)}>
                            {m.role === "staff" ? "Make owner" : "Make staff"}
                            {" "}
                            <span className="sr-only">for {m.full_name}</span>
                          </button>
                        )}
                        {!m.is_active ? (
                          <button type="button" className={btn} onClick={() => run(() => api.patch(`/admin/team/${m.id}`, { is_active: true }), `${m.full_name} can sign in again.`)}>
                            Switch back on{" "}
                            <span className="sr-only">for {m.full_name}</span>
                          </button>
                        ) : confirming === m.id ? (
                          <>
                            <Button type="button" onClick={() => run(() => api.delete(`/admin/team/${m.id}`), `${m.full_name} was removed and can no longer sign in.`)}>
                              Yes, remove{" "}
                              <span className="sr-only">{m.full_name}</span>
                            </Button>
                            <button type="button" className={btn} onClick={() => setConfirming(null)}>
                              Keep them
                            </button>
                          </>
                        ) : (
                          <button type="button" className={btn} onClick={() => setConfirming(m.id)}>
                            Remove{" "}
                            <span className="sr-only">{m.full_name}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <AddMember onAdded={(name) => { setMessage({ kind: "success", text: `${name} was added. Tell them their email and temporary password; they can change it under My account.` }); team.reload(); }} />
    </>
  );
}

function AddMember({ onAdded }: { onAdded: (name: string) => void }) {
  const [f, setF] = useState({ full_name: "", email: "", role: "staff", password: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const { pending, error, summaryRef, onSubmit } = useFormSubmit(async () => {
    await api.post("/admin/team", f);
    onAdded(f.full_name.trim());
    setF({ full_name: "", email: "", role: "staff", password: "" });
  });
  const fields = error?.fields ?? {};
  return (
    <section aria-labelledby="add-h" className="max-w-xl">
      <h2 id="add-h" className="mb-3 font-display text-2xl font-bold">
        Add a team member
      </h2>
      <form noValidate onSubmit={onSubmit}>
        {error && (
          <Alert ref={summaryRef} kind="error" title="We could not add this person">
            {error.message}
          </Alert>
        )}
        <TextField label="Full name" required value={f.full_name} onChange={(e) => set("full_name", e.target.value)} error={fields.full_name} />
        <TextField label="Email" type="email" required value={f.email} onChange={(e) => set("email", e.target.value)} error={fields.email} />
        <SelectField label="Role" value={f.role} onChange={(e) => set("role", e.target.value)}>
          <option value="staff">Staff: works the order queue</option>
          <option value="owner">Owner: manages everything</option>
        </SelectField>
        <TextField
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters. Share it with them privately; they should change it under My account."
          value={f.password}
          onChange={(e) => set("password", e.target.value)}
          error={fields.password}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add team member"}
        </Button>
      </form>
    </section>
  );
}
