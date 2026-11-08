import { useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxField, SelectField, TextAreaField } from "../../components/ui/Field";
import { Pagination } from "../../components/ui/Pagination";
import { TextField } from "../../components/ui/TextField";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { api, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/dates";
import type { EmailTemplate, NotificationLogItem, Page, PaymentSettings } from "../../lib/types";
import { StatusBadge } from "./StatusBadge";

type Msg = { kind: "success" | "error"; text: string } | null;
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");
const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const btn = "min-h-11 rounded-md border-2 border-line px-4 font-semibold disabled:opacity-60";

export default function AdminPaymentsPage() {
  usePageTitle("Payments and emails");
  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold">Payments and emails</h1>
      <p className="mb-8 max-w-prose text-muted">Choose how customers can pay, check that emails are working, and edit the wording of the emails customers receive.</p>
      <PaymentMethods />
      <EmailSetup />
      <Templates />
      <EmailLog />
    </>
  );
}

// ------------------------------------------------------------ payment methods
function PaymentMethods() {
  const settings = useApi<PaymentSettings>("/admin/payments");
  if (!settings.data) return <Section id="pay-h" title="Payment methods"><output>Loading…</output></Section>;
  return <PaymentMethodsForm key={`${settings.data.card_enabled}-${settings.data.cod_enabled}`} s={settings.data} onSaved={settings.reload} />;
}

function PaymentMethodsForm({ s, onSaved }: { s: PaymentSettings; onSaved: () => void }) {
  const [card, setCard] = useState(s.card_enabled);
  const [cod, setCod] = useState(s.cod_enabled);
  const [msg, setMsg] = useState<Msg>(null);
  const provider = s.provider === "paymob" ? `Paymob (${s.mode} mode)` : s.provider === "fake" ? "Demo payments (practice only)" : "Not set up";

  return (
    <Section id="pay-h" title="Payment methods">
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>
      <dl className="mb-4 grid max-w-xl grid-cols-[10rem_1fr] gap-y-1">
        <dt className="font-semibold">Card provider</dt>
        <dd>{provider}</dd>
        <dt className="font-semibold">Card payments</dt>
        <dd>{s.card_available ? <StatusBadge kind="ok">Available to customers</StatusBadge> : <StatusBadge kind="off">Not available</StatusBadge>}</dd>
        {s.provider === "paymob" && (
          <>
            <dt className="font-semibold">Callback address</dt>
            <dd className="break-all">
              <code>{`${API_URL}${s.webhook_path}`}</code>
              <span className="block text-sm text-muted">In the Paymob dashboard, open your card integration and paste this into <strong>Webhook URL</strong>. Paymob calls it after every payment to confirm it.</span>
            </dd>
          </>
        )}
      </dl>
      {s.provider === "none" && <p className="mb-4 rounded-md border-2 border-line bg-surface p-3">Card payments are not set up on the server yet, so customers can only pay cash. Setup is done with environment variables, see the README.</p>}
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.patch("/admin/payments", { card_enabled: card, cod_enabled: cod });
            setMsg({ kind: "success", text: "Payment methods saved." });
            onSaved();
          } catch (err) {
            setMsg({ kind: "error", text: errText(err) });
          }
        }}
      >
        <fieldset>
          <legend className="mb-1 font-semibold">Offer these at checkout</legend>
          <CheckboxField label="Cash on delivery or pickup" checked={cod} onChange={(e) => setCod(e.target.checked)} />
          <CheckboxField label="Pay online by card" hint={s.card_available || s.provider !== "none" ? undefined : "Needs the card provider to be set up first."} checked={card} onChange={(e) => setCard(e.target.checked)} />
        </fieldset>
        <Button type="submit">Save payment methods</Button>
      </form>
    </Section>
  );
}

// ------------------------------------------------------------------ email setup
function EmailSetup() {
  const settings = useApi<PaymentSettings>("/admin/payments");
  const [result, setResult] = useState<{ sent: boolean; to: string; error: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const live = settings.data?.email_provider === "resend";
  return (
    <Section id="email-h" title="Email setup">
      <p className="mb-3">
        {settings.data &&
          (live ? (
            <>
              Emails are sent through Resend from <strong>{settings.data.email_from}</strong>.
            </>
          ) : (
            "Email is not connected yet, so emails are only written to the server log and customers do not receive them."
          ))}
      </p>
      <button
        type="button"
        className={btn}
        disabled={sending}
        onClick={async () => {
          setSending(true);
          setResult(null);
          try {
            setResult(await api.post("/admin/email-test"));
          } catch (err) {
            setResult({ sent: false, to: "", error: errText(err) });
          }
          setSending(false);
        }}
      >
        {sending ? "Sending…" : "Send me a test email"}
      </button>
      <div aria-live="polite" className="mt-3">
        {result && (result.sent ? <Alert kind="success">A test email was sent to {result.to}. Check your inbox.</Alert> : <Alert kind="error" title="The test email could not be sent">{result.error}</Alert>)}
      </div>
    </Section>
  );
}

// -------------------------------------------------------------------- templates
function Templates() {
  const list = useApi<EmailTemplate[]>("/admin/notification-templates");
  const [selected, setSelected] = useState<string>("order_confirmed");
  const current = list.data?.find((t) => t.key === selected);
  return (
    <Section id="tpl-h" title="Email wording">
      {list.data && (
        <>
          <SelectField label="Which email" value={selected} onChange={(e) => setSelected(e.target.value)} hint={current?.description}>
            {list.data.map((t) => (
              <option key={t.key} value={t.key}>
                {t.title}
                {t.is_customised ? " (edited)" : ""}
                {t.is_active ? "" : " (off)"}
              </option>
            ))}
          </SelectField>
          {current && <TemplateEditor key={`${current.key}-${current.subject}-${current.body}-${current.is_active}`} t={current} onChanged={list.reload} />}
        </>
      )}
    </Section>
  );
}

function TemplateEditor({ t, onChanged }: { t: EmailTemplate; onChanged: () => void }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [active, setActive] = useState(t.is_active);
  const [msg, setMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMsg({ kind: "success", text: success });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api.patch(`/admin/notification-templates/${t.key}`, { subject, body, is_active: active }), "Email wording saved.");
      }}
    >
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>
      <TextField label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      <TextAreaField label="Message" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mb-5">
        <p className="mb-1 font-semibold">Details you can insert</p>
        <p className="mb-1 text-sm text-muted">Type them with double curly brackets, for example {"{{ customer_name }}"}. Only these work in this email:</p>
        <ul className="flex flex-wrap gap-2">
          {t.variables.map((v) => (
            <li key={v} className="rounded-md border-2 border-line bg-surface px-2 py-0.5 font-mono text-sm">
              {`{{ ${v} }}`}
            </li>
          ))}
        </ul>
      </div>
      <CheckboxField label="Send this email" hint="Switch off to stop sending it." checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Save wording</Button>
        <button
          type="button"
          className={btn}
          onClick={async () => {
            try {
              setPreview(await api.post(`/admin/notification-templates/${t.key}/preview`, { subject, body }));
              setMsg(null);
            } catch (err) {
              setPreview(null);
              setMsg({ kind: "error", text: errText(err) });
            }
          }}
        >
          Preview
        </button>
        {t.is_customised && (
          <button type="button" className={btn} onClick={() => void run(() => api.post(`/admin/notification-templates/${t.key}/reset`), "Restored the original wording.")}>
            Restore original wording
          </button>
        )}
      </div>
      <div aria-live="polite" className="mt-4">
        {preview && (
          <section aria-labelledby="preview-h" className="rounded-lg border-2 border-line bg-surface p-4">
            <h3 id="preview-h" className="mb-2 font-bold">
              Preview with sample details
            </h3>
            <p className="font-semibold">Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.body}</pre>
          </section>
        )}
      </div>
    </form>
  );
}

// -------------------------------------------------------------------- email log
function EmailLog() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<Msg>(null);
  const query = new URLSearchParams({ page: String(page), page_size: "10" });
  if (status) query.set("status", status);
  const log = useApi<Page<NotificationLogItem>>(`/admin/notifications?${query}`);
  const kind = (s: string) => (s === "sent" ? "ok" : s === "failed" ? "warn" : "off");

  return (
    <Section id="log-h" title="Email log">
      <SelectField label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">All emails</option>
        <option value="pending">Waiting to be sent</option>
        <option value="sent">Sent</option>
        <option value="failed">Failed</option>
      </SelectField>
      <div aria-live="polite">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>
      {log.data && log.data.items.length === 0 && <p>No emails to show.</p>}
      {log.data && log.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">Emails sent and queued</caption>
            <thead>
              <tr className="border-b-2 border-line">
                <th scope="col" className="p-2 text-start">When</th>
                <th scope="col" className="p-2 text-start">To</th>
                <th scope="col" className="p-2 text-start">Subject</th>
                <th scope="col" className="p-2 text-start">Status</th>
                <th scope="col" className="p-2 text-start">Action</th>
              </tr>
            </thead>
            <tbody>
              {log.data.items.map((n) => (
                <tr key={n.id} className="border-b border-line align-top">
                  <td className="p-2">{formatDateTime(n.created_at)}</td>
                  <td className="p-2">{n.to_email}</td>
                  <td className="p-2">
                    {n.subject}
                    {n.order_code && <span className="block text-sm text-muted">Order {n.order_code}</span>}
                    {n.last_error && <span className="block text-sm text-danger">{n.last_error}</span>}
                  </td>
                  <td className="p-2">
                    <StatusBadge kind={kind(n.status)}>{n.status === "pending" ? "Waiting" : n.status === "sent" ? "Sent" : "Failed"}</StatusBadge>
                  </td>
                  <td className="p-2">
                    {n.status === "failed" && (
                      <button
                        type="button"
                        className={btn}
                        onClick={async () => {
                          try {
                            await api.post(`/admin/notifications/${n.id}/retry`);
                            setMsg({ kind: "success", text: "The email will be sent again shortly." });
                            log.reload();
                          } catch (err) {
                            setMsg({ kind: "error", text: errText(err) });
                          }
                        }}
                      >
                        Retry{" "}
                        <span className="sr-only">the email to {n.to_email}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={log.data?.total_pages ?? 1} onChange={setPage} />
    </Section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-12 max-w-3xl">
      <h2 id={id} className="mb-3 font-display text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}
