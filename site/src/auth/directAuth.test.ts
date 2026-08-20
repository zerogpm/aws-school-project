import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, readStored, SessionExpiredError, storeTokens } from "./cognito";
import { AuthError, completeNewPassword, refreshSession, signIn, signOut } from "./directAuth";

const REGION = "ca-central-1";
const CLIENT_ID = "abc123clientid";
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;

function idTokenFor(claims: Record<string, unknown>) {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
}

function authResult(overrides: Record<string, unknown> = {}) {
  return {
    AuthenticationResult: {
      IdToken: idTokenFor({ email: "teacher@maplewood.example" }),
      AccessToken: "access-token",
      RefreshToken: "refresh-token",
      ExpiresIn: 3600,
      ...overrides,
    },
  };
}

function mockIdp(payload: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
}

/** The X-Amz-Target header, which is how this API names its operation. */
function targetOf(spy: ReturnType<typeof mockIdp>, call = 0) {
  const headers = spy.mock.calls[call][1]?.headers as Record<string, string>;
  return headers["X-Amz-Target"];
}

function bodyOf(spy: ReturnType<typeof mockIdp>, call = 0) {
  return JSON.parse(String(spy.mock.calls[call][1]?.body));
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

describe("signIn", () => {
  it("posts USER_PASSWORD_AUTH to the regional endpoint", async () => {
    const spy = mockIdp(authResult());

    await signIn("teacher@maplewood.example", "hunter2hunter2");

    expect(spy.mock.calls[0][0]).toBe(ENDPOINT);
    expect(targetOf(spy)).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(bodyOf(spy).AuthFlow).toBe("USER_PASSWORD_AUTH");
    expect(bodyOf(spy).AuthParameters.USERNAME).toBe("teacher@maplewood.example");
  });

  it("sends no client secret, because a public client has none", async () => {
    const spy = mockIdp(authResult());
    await signIn("teacher@maplewood.example", "hunter2hunter2");
    expect(bodyOf(spy).SecretHash).toBeUndefined();
  });

  it("stores the session on success", async () => {
    mockIdp(authResult());

    const result = await signIn("teacher@maplewood.example", "hunter2hunter2");

    expect(result.kind).toBe("signedIn");
    expect(getSession()?.email).toBe("teacher@maplewood.example");
  });

  // The path every invited teacher takes exactly once.
  it("reports the forced password change instead of pretending to be signed in", async () => {
    mockIdp({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "challenge-session" });

    const result = await signIn("teacher@maplewood.example", "TempPass123!");

    expect(result).toEqual({
      kind: "newPassword",
      username: "teacher@maplewood.example",
      session: "challenge-session",
    });
    expect(getSession()).toBeNull();
  });

  it("surfaces Cognito's deliberately vague rejection", async () => {
    mockIdp(
      { __type: "NotAuthorizedException", message: "Incorrect username or password." },
      400,
    );

    await expect(signIn("teacher@maplewood.example", "wrong")).rejects.toThrow(
      "Incorrect username or password.",
    );
  });

  it("names the error code so a caller can tell failures apart", async () => {
    mockIdp({ __type: "NotAuthorizedException", message: "nope" }, 400);

    await expect(signIn("a@b.co", "wrong")).rejects.toMatchObject({
      name: "AuthError",
      code: "NotAuthorizedException",
    });
  });

  it("refuses a challenge it does not implement rather than failing silently", async () => {
    mockIdp({ ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s" });

    await expect(signIn("a@b.co", "pw")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("completeNewPassword", () => {
  it("answers the challenge and stores the resulting session", async () => {
    const spy = mockIdp(authResult());

    const session = await completeNewPassword(
      "teacher@maplewood.example",
      "BrandNewPass1",
      "challenge-session",
    );

    expect(targetOf(spy)).toBe("AWSCognitoIdentityProviderService.RespondToAuthChallenge");
    expect(bodyOf(spy).Session).toBe("challenge-session");
    expect(bodyOf(spy).ChallengeResponses.NEW_PASSWORD).toBe("BrandNewPass1");
    expect(session.email).toBe("teacher@maplewood.example");
    expect(getSession()).not.toBeNull();
  });

  it("passes a policy rejection back to the form", async () => {
    mockIdp(
      { __type: "InvalidPasswordException", message: "Password did not conform with policy" },
      400,
    );

    await expect(
      completeNewPassword("a@b.co", "short", "challenge-session"),
    ).rejects.toThrow(/did not conform/i);
  });
});

describe("refreshSession", () => {
  function storeExpired(refreshToken = "refresh-token") {
    storeTokens({
      IdToken: idTokenFor({ email: "teacher@maplewood.example" }),
      AccessToken: "old",
      RefreshToken: refreshToken,
      ExpiresIn: -1,
    });
  }

  it("renews with REFRESH_TOKEN_AUTH", async () => {
    storeExpired();
    const spy = mockIdp(authResult({ RefreshToken: undefined, AccessToken: "fresh" }));

    const session = await refreshSession();

    expect(bodyOf(spy).AuthFlow).toBe("REFRESH_TOKEN_AUTH");
    expect(bodyOf(spy).AuthParameters.REFRESH_TOKEN).toBe("refresh-token");
    expect(session.accessToken).toBe("fresh");
  });

  it("carries the refresh token forward, because Cognito does not reissue it", async () => {
    storeExpired();
    mockIdp(authResult({ RefreshToken: undefined }));

    expect((await refreshSession()).refreshToken).toBe("refresh-token");
  });

  it("makes the renewed session live again", async () => {
    storeExpired();
    mockIdp(authResult({ RefreshToken: undefined }));

    expect(getSession()).toBeNull();
    await refreshSession();
    expect(getSession()).not.toBeNull();
  });

  it("gives up and clears storage when the refresh token is rejected", async () => {
    storeExpired();
    mockIdp({ __type: "NotAuthorizedException", message: "Refresh Token has expired" }, 400);

    await expect(refreshSession()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(readStored()).toBeNull();
  });

  it("refuses without calling out when there is no refresh token", async () => {
    storeExpired("");
    const spy = vi.spyOn(globalThis, "fetch");

    await expect(refreshSession()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("revokes the refresh token server-side and clears storage", async () => {
    storeTokens({
      IdToken: idTokenFor({ email: "teacher@maplewood.example" }),
      AccessToken: "a",
      RefreshToken: "refresh-token",
      ExpiresIn: 3600,
    });
    const spy = mockIdp({});

    await signOut();

    expect(targetOf(spy)).toBe("AWSCognitoIdentityProviderService.RevokeToken");
    expect(bodyOf(spy).Token).toBe("refresh-token");
    expect(readStored()).toBeNull();
  });

  it("still signs out locally when revocation fails", async () => {
    storeTokens({
      IdToken: idTokenFor({ email: "teacher@maplewood.example" }),
      AccessToken: "a",
      RefreshToken: "refresh-token",
      ExpiresIn: 3600,
    });
    mockIdp({ __type: "InternalErrorException", message: "boom" }, 500);

    await expect(signOut()).resolves.toBeUndefined();
    expect(readStored()).toBeNull();
  });
});
