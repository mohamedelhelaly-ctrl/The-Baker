/** Prices arrive as integer minor units (piastres). Format them, never do float maths on them. */
export function formatMoney(minor: number, currency = "EGP", exponent = 2, locale = "en-EG"): string {
  const value = minor / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
  } catch {
    return `${value.toFixed(exponent)} ${currency}`;
  }
}

/** "450" or "450.50" -> 45050. Returns null when the text is not a valid positive amount. */
export function parsePrice(text: string, exponent = 2): number | null {
  const match = new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`).exec(text.trim());
  if (!match) return null;
  const [whole, frac = ""] = text.trim().split(".");
  const minor = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, "0") || 0);
  return minor > 0 ? minor : null;
}

export function toMajorString(minor: number, exponent = 2): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}

export function leadTimeText(hours: number): string {
  if (hours <= 0) return "Available for same-day orders";
  if (hours < 24) return `Order at least ${hours} hour${hours === 1 ? "" : "s"} ahead`;
  const days = Math.ceil(hours / 24);
  return `Order at least ${days} day${days === 1 ? "" : "s"} ahead`;
}
