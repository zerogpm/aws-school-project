import { beforeEach, describe, expect, it } from "vitest";
import { clearSession, getSession, readStored, storeTokens } from "./cognito";

// A structurally real JWT. Only the payload is ever read, and only after it
// arrived over TLS from Cognito, so an unsigned one exercises the same path.
function idTokenFor(claims: Record<string, unknown>) {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature-not-checked-here`;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    IdToken: idTokenFor({ email: "teacher@maplewood.example", "cognito:groups": ["office"] }),
    AccessToken: "access-token-value",
    RefreshToken: "refresh-token-value",
    ExpiresIn: 3600,
    ...overrides,
  } as Parameters<typeof storeTokens>[0];
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("storeTokens", () => {
  it("pulls the email and groups out of the id token", () => {
    const session = storeTokens(result());

    expect(session.email).toBe("teacher@maplewood.example");
    expect(session.groups).toEqual(["office"]);
  });

  it("keeps the refresh token, which is only ever issued once", () => {
    expect(storeTokens(result()).refreshToken).toBe("refresh-token-value");
  });

  it("turns the relative lifetime into an absolute expiry", () => {
    const before = Date.now();
    const session = storeTokens(result({ ExpiresIn: 3600 }));

    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    expect(session.expiresAt).toBeLessThan(before + 3600_000 + 5_000);
  });

  it("copes with a token carrying no groups", () => {
    const session = storeTokens(
      result({ IdToken: idTokenFor({ email: "teacher@maplewood.example" }) }),
    );
    expect(session.groups).toEqual([]);
  });

  it("rejects a malformed token rather than storing nonsense", () => {
    expect(() => storeTokens(result({ IdToken: "not-a-jwt" }))).toThrow(/malformed/i);
  });
});

describe("getSession", () => {
  it("returns null when nothing is stored", () => {
    expect(getSession()).toBeNull();
  });

  it("returns a live session", () => {
    storeTokens(result());
    expect(getSession()?.email).toBe("teacher@maplewood.example");
  });

  it("reports no session once the token has expired", () => {
    storeTokens(result({ ExpiresIn: -1 }));
    expect(getSession()).toBeNull();
  });

  it("keeps the expired session in storage, because the refresh token is in it", () => {
    storeTokens(result({ ExpiresIn: -1 }));

    getSession();

    // Deleting here would strand a teacher at the 60-minute mark holding a
    // refresh token good for 30 days.
    expect(readStored()?.refreshToken).toBe("refresh-token-value");
  });

  it("discards unparseable stored data instead of throwing", () => {
    sessionStorage.setItem("staff.session", "{not json");
    expect(getSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes the session entirely, refresh token included", () => {
    storeTokens(result());

    clearSession();

    expect(getSession()).toBeNull();
    expect(readStored()).toBeNull();
  });
});
