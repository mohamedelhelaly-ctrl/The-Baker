import { WEEKDAYS, formatTime, hhmm } from "./dates";
import type { HoursEntry } from "./types";

const TZ = "Africa/Cairo";

/** The bakery's own "now": weekday (0 = Monday) and minutes since midnight in Cairo. */
function cairoNow(now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function todayEntry(hours: HoursEntry[], now = new Date()): HoursEntry | undefined {
  return hours.find((h) => h.weekday === cairoNow(now).weekday);
}

/** "Open now, until 9:00 PM" or "Closed, opens Friday at 1:00 PM". Only from hours the owner has set. */
export function openNowLine(hours: HoursEntry[], now = new Date()): string | null {
  if (hours.length === 0) return null;
  const { weekday, minutes } = cairoNow(now);
  const today = hours.find((h) => h.weekday === weekday);
  if (today && !today.is_closed && minutes >= mins(today.opens_at) && minutes < mins(today.closes_at)) return `Open now, until ${formatTime(hhmm(today.closes_at))}`;
  for (let i = 0; i < 8; i++) {
    const day = (weekday + i) % 7;
    const h = hours.find((x) => x.weekday === day);
    if (!h || h.is_closed) continue;
    if (i === 0 && minutes >= mins(h.opens_at)) continue; // today's hours are over
    return `Closed, opens ${i === 0 ? "today" : i === 1 ? "tomorrow" : WEEKDAYS[day]} at ${formatTime(hhmm(h.opens_at))}`;
  }
  return null;
}

/** "Open today 9:00 AM to 9:00 PM", or null on a closed day or with no hours. */
export function todayLine(hours: HoursEntry[], now = new Date()): string | null {
  const t = todayEntry(hours, now);
  return t && !t.is_closed ? `${formatTime(hhmm(t.opens_at))} to ${formatTime(hhmm(t.closes_at))}` : null;
}
