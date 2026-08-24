import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Admin from "./Admin";
import { AuthProvider } from "../auth/AuthContext";
import ProtectedRoute from "../auth/ProtectedRoute";

const CLIENT_ID = "abc123clientid";

// The real composition: the provider owns the session and ProtectedRoute does
// the gating, exactly as main.tsx wires it. Testing Admin bare would prove
// something that never ships.
function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route path="/staff" element={<h1>Staff sign in</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function signIn(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem(
    "staff.session",
    JSON.stringify({
      idToken: "t",
      accessToken: "a",
      refreshToken: "r",
      // Beyond the provider's five-minute renewal margin, so mounting does not
      // immediately try to renew.
      expiresAt: Date.now() + 30 * 60_000,
      email: "teacher@maplewood.example",
      groups: [],
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_COGNITO_REGION", "ca-central-1");
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", CLIENT_ID);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Admin page", () => {
  it("sends a signed-out visitor back to the sign-in page", async () => {
    renderAdmin();
    expect(await screen.findByRole("heading", { name: /staff sign in/i })).toBeInTheDocument();
  });

  it("sends a visitor whose session expired back to the sign-in page", async () => {
    signIn({ expiresAt: Date.now() - 1 });
    // The provider tries to renew before giving up; a rejected refresh token is
    // terminal, which is what puts the visitor back on the sign-in page.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid_grant", { status: 400 }),
    );

    renderAdmin();

    expect(await screen.findByRole("heading", { name: /staff sign in/i })).toBeInTheDocument();
  });

  it("renews a nearly-expired session instead of bouncing the teacher", async () => {
    const b64 = (v: unknown) =>
      btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // Inside the renewal margin: still valid, but due for renewal.
    signIn({ expiresAt: Date.now() + 60_000 });

    // Routed by URL, not a blanket mockResolvedValue: the page also lists
    // published documents on mount, and a single canned response would be
    // consumed by whichever call happened to go first.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/documents")) {
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          AuthenticationResult: {
            IdToken: `${b64({ alg: "RS256" })}.${b64({ email: "renewed@maplewood.example" })}.sig`,
            AccessToken: "fresh",
            ExpiresIn: 3600,
          },
        }),
        { status: 200 },
      );
    });

    renderAdmin();

    expect(await screen.findByText(/renewed@maplewood.example/)).toBeInTheDocument();
  });

  it("greets a signed-in teacher by the address in the token", async () => {
    signIn();
    renderAdmin();
    expect(await screen.findByText(/teacher@maplewood.example/)).toBeInTheDocument();
  });

  it("names the groups a teacher belongs to when the token carries any", async () => {
    signIn({ groups: ["office", "staff"] });
    renderAdmin();
    expect(await screen.findByText(/office, staff/)).toBeInTheDocument();
  });

  it("offers the upload form to a signed-in teacher", async () => {
    signIn();
    renderAdmin();

    // Two promises left. Uploading is no longer one of them - it has its own
    // section above, which is the point of the change.
    await screen.findByRole("heading", { name: /publish a document/i });
    expect(screen.getByRole("heading", { name: /publish the timetable/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /open interview windows/i })).toBeInTheDocument();
  });

  it("says what is actually built rather than naming an episode", async () => {
    // Three of these cards said "arrives in 04-booking" while 04 shipped
    // booking. A stage name goes stale silently; a status claim about today
    // goes stale loudly, which is the point of the change.
    signIn();
    renderAdmin();

    expect(await screen.findByText(/API only - no page yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Planned$/i)).toHaveLength(1);
    expect(screen.queryByText(/arrives in/i)).not.toBeInTheDocument();
  });

  it("revokes the refresh token server-side and returns to the public site", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      origin: "http://localhost:3000",
      assign,
    } as unknown as Location);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    signIn();
    renderAdmin();
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    // Revocation matters: enable_token_revocation is what makes signing out
    // actually invalidate the refresh token instead of waiting weeks for it
    // to expire on its own.
    const revoke = fetchSpy.mock.calls.find(
      (call) =>
        (call[1]?.headers as Record<string, string> | undefined)?.["X-Amz-Target"] ===
        "AWSCognitoIdentityProviderService.RevokeToken",
    );
    expect(revoke, "no RevokeToken call was made").toBeDefined();
    expect(sessionStorage.getItem("staff.session")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/");
  });
});
