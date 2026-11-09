import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "react-router";
import { describe, expect, it } from "vitest";
import { useStore } from "./lib/store";
import { mockFetch, renderApp } from "./test/render";

function Probe() {
  const { policy_text } = useStore();
  return (
    <>
      <p>Policy: {policy_text}</p>
      <Link to="/elsewhere">Go elsewhere</Link>
    </>
  );
}

describe("shop information stays current", () => {
  const withPolicy = (text: string) => ({ name: "The Baker", currency: "EGP", currency_exponent: 2, opening_hours: [], payment_methods: ["cod"], cancellation_window_hours: 24, policy_text: text });

  it("picks up a policy the owner changed after this page was first opened", async () => {
    let current = "Refunded in full.";
    mockFetch({ "/store": { body: () => withPolicy(current) } });
    renderApp(<Probe />);
    expect(await screen.findByText("Policy: Refunded in full.")).toBeInTheDocument();
    current = "80% is refunded.";
    await userEvent.setup().click(screen.getByRole("link", { name: "Go elsewhere" }));
    expect(await screen.findByText("Policy: 80% is refunded.")).toBeInTheDocument();
  });

  it("looks again when the visitor comes back to the tab", async () => {
    let current = "Refunded in full.";
    mockFetch({ "/store": { body: () => withPolicy(current) } });
    renderApp(<Probe />);
    await screen.findByText("Policy: Refunded in full.");
    current = "80% is refunded.";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("Policy: 80% is refunded.")).toBeInTheDocument();
  });

  it("keeps showing what it had when the shop cannot be reached", async () => {
    mockFetch({ "/store": { body: withPolicy("Refunded in full.") } });
    renderApp(<Probe />);
    await screen.findByText("Policy: Refunded in full.");
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    await userEvent.setup().click(screen.getByRole("link", { name: "Go elsewhere" }));
    expect(screen.getByText("Policy: Refunded in full.")).toBeInTheDocument();
  });
});
