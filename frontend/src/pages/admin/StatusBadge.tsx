/** Status is shown as icon + text, never colour alone (WCAG 1.4.1). `info` is a calm "in progress". */
export function StatusBadge({ kind, children }: { kind: "ok" | "warn" | "off" | "info"; children: string }) {
  const style = {
    ok: "border-success bg-success-bg text-success",
    warn: "border-danger bg-danger-bg text-danger",
    off: "border-hairline bg-tint text-muted",
    info: "border-primary bg-tint text-primary",
  }[kind];
  const icon = { ok: "✓", warn: "!", off: "–", info: "●" }[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${style}`}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}
