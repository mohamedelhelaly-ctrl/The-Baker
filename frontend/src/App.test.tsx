import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, renderApp } from "./test/render";

const me = {
  id: 1, email: "sara@example.com", full_name: "Sara Ali", phone: null, role: "customer",
  permissions: { account: { read: true, write: true }, orders_queue: { read: false, write: false } },
};

describe("accessibility of auth pages", () => {
  for (const [name, route] of [
    ["login", "/login"],
    ["register", "/register"],
    ["forgot password", "/forgot-password"],
    ["reset password", "/reset-password?token=abc"],
    ["home", "/"],
  ] as const) {
    it(`${name} has no axe violations`, async () => {
      const { container } = renderApp(<App />, route);
      await screen.findByRole("heading", { level: 1 });
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("has a skip link and a single h1", async () => {
    renderApp(<App />, "/login");
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("sign in", () => {
  it("signs in, loads permissions and lands on the account page", async () => {
    const calls = mockFetch({
      "/auth/login": { body: { access_token: "tok", token_type: "bearer", user: me } },
      "/auth/me": { body: me },
    });
    renderApp(<App />, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "sara@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "My account" })).toBeInTheDocument();
    expect(localStorage.getItem("baker.token")).toBe("tok");
    const meCall = calls.find((c) => c.url.endsWith("/auth/me"))!;
    expect((meCall.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("shows a focused error summary on a wrong password and keeps the user on the page", async () => {
    mockFetch({
      "/auth/login": { status: 401, body: { error: { code: "invalid_credentials", message: "Email or password is incorrect." } } },
    });
    renderApp(<App />, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "sara@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-wrong-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });
});

describe("register", () => {
  it("links field errors to inputs with aria-describedby", async () => {
    mockFetch({
      "/auth/register": {
        status: 422,
        body: { error: { code: "validation_error", message: "Please check the highlighted fields.", fields: { password: "Password must be at least 10 characters." } } },
      },
    });
    renderApp(<App />, "/register");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Full name"), "Sara");
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const field = await screen.findByLabelText("Password");
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    const describedBy = field.getAttribute("aria-describedby")!;
    expect(describedBy.split(" ").some((id) => document.getElementById(id)?.textContent?.includes("at least 10"))).toBe(true);
  });
});

describe("route guards", () => {
  it("redirects signed-out visitors from /account to sign in", async () => {
    renderApp(<App />, "/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("clears a stale token and redirects when the session has expired", async () => {
    localStorage.setItem("baker.token", "stale");
    mockFetch({ "/auth/me": { status: 401, body: { error: { code: "invalid_token", message: "Your session has expired." } } } });
    renderApp(<App />, "/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("baker.token")).toBeNull();
  });

  it("keeps signed-in users away from the sign-in page", async () => {
    localStorage.setItem("baker.token", "tok");
    mockFetch({ "/auth/me": { body: me } });
    renderApp(<App />, "/login");
    expect(await screen.findByRole("heading", { name: "My account" })).toBeInTheDocument();
  });
});

describe("display preferences", () => {
  it("toggles high contrast and text size on <html> and remembers them", async () => {
    renderApp(<App />, "/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Display" }));
    await user.click(screen.getByLabelText("High contrast"));
    await user.click(screen.getByLabelText("Large"));
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(document.documentElement.dataset.textSize).toBe("125");
    expect(localStorage.getItem("baker.display")).toContain('"highContrast":true');
  });

  it("closes the Display panel with Escape and returns focus to its button", async () => {
    renderApp(<App />, "/");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Display" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("High contrast")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
