import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Staff from "./Staff";
import { AuthProvider } from "../auth/AuthContext";

const REGION = "ca-central-1";
const CLIENT_ID = "abc123clientid";

function idTokenFor(claims: Record<string, unknown>) {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
}

function mockIdp(payload: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
}

const tokens = {
  AuthenticationResult: {
    IdToken: idTokenFor({ email: "teacher@maplewood.example" }),
    AccessToken: "access",
    RefreshToken: "refresh",
    ExpiresIn: 3600,
  },
};

function renderStaff() {
  return render(
    <MemoryRouter initialEntries={["/staff"]}>
      <AuthProvider>
        <Routes>
          <Route path="/staff" element={<Staff />} />
          <Route path="/admin" element={<h1>Staff admin</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(password = "hunter2hunter2") {
  await userEvent.type(screen.getByLabelText(/school email/i), "teacher@maplewood.example");
  await userEvent.type(screen.getByLabelText(/^password$/i), password);
  await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

beforeEach(() => {
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("VITE_COGNITO_REGION", REGION);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Staff sign-in page", () => {
  it("asks for an email and a password", () => {
    renderStaff();

    expect(screen.getByLabelText(/school email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
  });

  it("says there is no self-registration, because there is not", () => {
    renderStaff();
    expect(screen.getByText(/no\s+self-registration/i)).toBeInTheDocument();
  });

  it("disables sign-in and explains itself when the pool was never configured", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
    vi.stubEnv("VITE_COGNITO_REGION", "");

    renderStaff();

    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
    expect(screen.getByText(/no user pool configured/i)).toBeInTheDocument();
  });

  it("lands on the admin page after a successful sign-in", async () => {
    mockIdp(tokens);

    renderStaff();
    await fillAndSubmit();

    expect(await screen.findByRole("heading", { name: /staff admin/i })).toBeInTheDocument();
  });

  it("shows the reason a sign-in was refused", async () => {
    mockIdp(
      { __type: "NotAuthorizedException", message: "Incorrect username or password." },
      400,
    );

    renderStaff();
    await fillAndSubmit("wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect username or password.",
    );
  });

  it("stays on the sign-in page when the password is wrong", async () => {
    mockIdp({ __type: "NotAuthorizedException", message: "nope" }, 400);

    renderStaff();
    await fillAndSubmit("wrong-password");

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/school email/i)).toBeInTheDocument();
  });

  // Every account the office creates starts in FORCE_CHANGE_PASSWORD, so this
  // is the path every teacher takes on their first sign-in.
  it("asks for a new password when Cognito demands one", async () => {
    mockIdp({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "challenge-session" });

    renderStaff();
    await fillAndSubmit("TempPass123!");

    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /choose a new password/i }),
    ).toBeInTheDocument();
  });

  it("does not leave the temporary password sitting in the form", async () => {
    mockIdp({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "challenge-session" });

    renderStaff();
    await fillAndSubmit("TempPass123!");
    await screen.findByLabelText(/new password/i);

    expect(screen.queryByDisplayValue("TempPass123!")).not.toBeInTheDocument();
  });

  it("signs the teacher in once the new password is accepted", async () => {
    const spy = mockIdp({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: "challenge-session",
    });

    renderStaff();
    await fillAndSubmit("TempPass123!");
    await screen.findByLabelText(/new password/i);

    spy.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
    await userEvent.type(screen.getByLabelText(/new password/i), "BrandNewPass1");
    await userEvent.click(screen.getByRole("button", { name: /set password and continue/i }));

    expect(await screen.findByRole("heading", { name: /staff admin/i })).toBeInTheDocument();
  });

  it("reports a new password the pool will not accept", async () => {
    const spy = mockIdp({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: "challenge-session",
    });

    renderStaff();
    await fillAndSubmit("TempPass123!");
    await screen.findByLabelText(/new password/i);

    spy.mockResolvedValue(
      new Response(
        JSON.stringify({
          __type: "InvalidPasswordException",
          message: "Password did not conform with policy",
        }),
        { status: 400 },
      ),
    );
    await userEvent.type(screen.getByLabelText(/new password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /set password and continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not conform/i);
  });
});
