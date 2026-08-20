import { authConfig, idpEndpoint } from "./config";
import {
  clearSession,
  readStored,
  SessionExpiredError,
  storeTokens,
  type Session,
} from "./cognito";

// Cognito's service API speaks AWS JSON 1.1: the operation is a header, not a
// path, and every response is 200-or-error-document. No SDK - this is three
// calls and adding a client for them would outweigh them.
async function idp<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(idpEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // __type looks like "NotAuthorizedException"; the message is the useful
    // half and Cognito already keeps it vague on purpose.
    throw new AuthError(
      String(payload.message ?? "Sign-in failed"),
      String(payload.__type ?? "UnknownError").split("#").pop() ?? "UnknownError",
    );
  }
  return payload as T;
}

export class AuthError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

type AuthResult = {
  AuthenticationResult?: {
    IdToken: string;
    AccessToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
  };
  ChallengeName?: string;
  Session?: string;
};

// A teacher invited by the office starts in FORCE_CHANGE_PASSWORD, so the very
// first sign-in always lands here rather than on tokens. Not an edge case - it
// is the only way anyone's first sign-in can go.
export type NewPasswordRequired = {
  kind: "newPassword";
  username: string;
  session: string;
};

export type SignedIn = { kind: "signedIn"; session: Session };

export async function signIn(
  username: string,
  password: string,
): Promise<SignedIn | NewPasswordRequired> {
  const { clientId } = authConfig();

  const result = await idp<AuthResult>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password },
  });

  if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    return { kind: "newPassword", username, session: result.Session ?? "" };
  }
  if (!result.AuthenticationResult) {
    throw new AuthError(
      `Unsupported sign-in challenge: ${result.ChallengeName ?? "none"}`,
      result.ChallengeName ?? "UnknownChallenge",
    );
  }

  return { kind: "signedIn", session: storeTokens(result.AuthenticationResult) };
}

// Answers the forced-change challenge. The Session string is single-use and
// short-lived, which is why it is threaded through rather than stored.
export async function completeNewPassword(
  username: string,
  newPassword: string,
  challengeSession: string,
): Promise<Session> {
  const { clientId } = authConfig();

  const result = await idp<AuthResult>("RespondToAuthChallenge", {
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    ClientId: clientId,
    Session: challengeSession,
    ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
  });

  if (!result.AuthenticationResult) {
    throw new AuthError("Password was changed but no tokens came back", "NoTokens");
  }
  return storeTokens(result.AuthenticationResult);
}

// Renewal through the same API, so nothing here depends on the hosted UI
// domain existing. Cognito does not reissue the refresh token, so it is carried
// forward by the caller.
export async function renew(refreshToken: string): Promise<Session> {
  const { clientId } = authConfig();

  const result = await idp<AuthResult>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  }).catch((error: unknown) => {
    // A revoked or expired refresh token is terminal, not retryable.
    throw new SessionExpiredError(
      error instanceof Error ? error.message : "Could not renew session",
    );
  });

  if (!result.AuthenticationResult) {
    throw new SessionExpiredError("Renewal returned no tokens");
  }
  return storeTokens({ ...result.AuthenticationResult, RefreshToken: refreshToken });
}

// Reads the stored refresh token and renews with it. Kept here rather than in
// cognito.ts so the storage module has no dependency on the API module.
export async function refreshSession(): Promise<Session> {
  const current = readStored();
  if (!current?.refreshToken) {
    clearSession();
    throw new SessionExpiredError("No refresh token to renew with");
  }

  try {
    return await renew(current.refreshToken);
  } catch (error) {
    clearSession();
    throw error instanceof SessionExpiredError
      ? error
      : new SessionExpiredError("Could not renew session");
  }
}

// No hosted UI to redirect to, so signing out is a revocation plus a local
// clear. RevokeToken kills the refresh token server-side, which is what
// enable_token_revocation on the client makes meaningful - without it the
// token would stay valid until it expired weeks later.
export async function signOut(): Promise<void> {
  const current = readStored();
  clearSession();
  if (!current?.refreshToken) return;

  try {
    await idp("RevokeToken", {
      ClientId: authConfig().clientId,
      Token: current.refreshToken,
    });
  } catch {
    // Best effort. The local tokens are already gone, which is what the person
    // in front of the screen cares about.
  }
}
