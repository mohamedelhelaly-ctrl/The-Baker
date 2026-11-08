import "@testing-library/jest-dom/vitest";
import * as axeMatchers from "vitest-axe/matchers";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";

expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-contrast");
});

// jsdom has no canvas; axe's colour checks are skipped here (contrast is verified in tokens.test.ts).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
