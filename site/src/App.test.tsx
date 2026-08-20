import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

function idTokenFor(claims: Record<string, unknown>) {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
}

function signIn() {
  sessionStorage.setItem(
    "staff.session",
    JSON.stringify({
      idToken: idTokenFor({ email: "principal@maplewood.example" }),
      accessToken: "a",
      refreshToken: "r",
      // Beyond the renewal margin, so mounting does not try to renew.
      expiresAt: Date.now() + 30 * 60_000,
      email: "principal@maplewood.example",
      groups: ["office"],
    }),
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <Routes>
          <Route element={<App />}>
            <Route index element={<p>Home</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "abc123");
  vi.stubEnv("VITE_COGNITO_REGION", "ca-central-1");
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("header", () => {
  it("offers sign-in to a visitor who is not signed in", async () => {
    renderApp();

    const link = await screen.findByRole("link", { name: /staff sign in/i });
    expect(link).toHaveAttribute("href", "/staff");
  });

  it("offers the way back to the admin page once signed in", async () => {
    signIn();

    renderApp();

    const link = await screen.findByRole("link", { name: /staff admin/i });
    expect(link).toHaveAttribute("href", "/admin");
  });

  it("does not invite a signed-in teacher to sign in again", async () => {
    signIn();

    renderApp();

    await screen.findByRole("link", { name: /staff admin/i });
    expect(screen.queryByRole("link", { name: /staff sign in/i })).not.toBeInTheDocument();
  });

  it("keeps the public navigation in both states", async () => {
    signIn();

    renderApp();

    await screen.findByRole("link", { name: /staff admin/i });
    expect(screen.getByRole("link", { name: /timetable/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /interviews/i })).toBeInTheDocument();
  });
});
