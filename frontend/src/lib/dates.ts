/** Weekday numbers follow the API: 0 = Monday ... 6 = Sunday. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "2026-11-09" -> a local Date (no timezone shift, unlike new Date("2026-11-09")). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(parseDate(iso));
}

export function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(parseDate(iso));
}

/** "14:00:00" -> "2:00 PM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

/** "14:00:00" -> "14:00" (the value format of <input type="time">) */
export const hhmm = (time: string): string => time.slice(0, 5);

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
