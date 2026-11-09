export type ButtonVariant = "primary" | "secondary" | "quiet";

/** Class names for a button look, so links and buttons can share it: `<Link className={buttonClass("secondary")}>`. */
export function buttonClass(variant: ButtonVariant = "primary", extra = ""): string {
  return `btn btn-${variant} ${extra}`.trim();
}
