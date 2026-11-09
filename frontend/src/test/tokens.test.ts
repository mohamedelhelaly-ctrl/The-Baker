import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom cannot compute colour contrast, so the design tokens are checked directly (WCAG 1.4.3, 1.4.11).
const css = readFileSync("src/index.css", "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const normal = tokens(css.split(":root[data-contrast")[0]);
const high = { ...normal, ...tokens(css.split(':root[data-contrast="high"]')[1].split("}")[0]) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["ink", "bg"], ["ink", "surface"], ["ink-muted", "bg"], ["ink-muted", "surface"],
  ["primary-ink", "primary"], ["primary-ink", "primary-hover"],
  ["danger", "danger-bg"], ["danger", "bg"], ["danger", "surface"],
  ["success", "success-bg"], ["success", "bg"],
  ["ink", "tint"], ["ink-muted", "tint"], ["primary", "tint"], ["primary", "surface"], ["primary", "bg"],
];
const UI_PAIRS: [string, string][] = [["border", "bg"], ["border", "surface"], ["focus", "bg"], ["focus", "surface"]];

describe.each([["normal", normal], ["high contrast", high]])("%s theme", (_, t) => {
  it.each(TEXT_PAIRS)("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI_PAIRS)("%s against %s is at least 3:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
