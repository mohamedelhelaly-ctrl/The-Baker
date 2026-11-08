/** Status is shown as icon + text, never colour alone (WCAG 1.4.1). */
export function StatusBadge({ kind, children }: { kind: "ok" | "warn" | "off"; children: string }) {
  const style = { ok: "border-success text-success", warn: "border-danger text-danger", off: "border-line text-muted" }[kind];
  const icon = { ok: "✓", warn: "!", off: "–" }[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-sm font-semibold ${style}`}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}
