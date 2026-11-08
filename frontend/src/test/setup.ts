import "@testing-library/jest-dom/vitest";
import * as axeMatchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";

expect.extend(axeMatchers);

// Tests must never reach a real server (a dev backend on localhost would make them flaky).
beforeEach(() => {
  globalThis.fetch = (() => Promise.reject(new TypeError("network disabled in tests"))) as typeof fetch;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-contrast");
});

// jsdom has no canvas; axe's colour checks are skipped here (contrast is verified in tokens.test.ts).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
