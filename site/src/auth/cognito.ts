// Session storage and token shaping. The calls that produce tokens live in
// directAuth.ts; this file only decides how they are held.

// sessionStorage, not localStorage: the tokens die with the tab. A staff laptop
// in a shared office is the threat being designed around, not a sophisticated
// attacker - neither store survives XSS, and there is no backend here to hold
// an httpOnly cookie.
const SESSION_KEY = "staff.session";

export type Session = {
  idToken: string;
  accessToken: string;
  // Cognito returns this once, at sign-in, and never again - renewal reissues
  // the id and access tokens but not this. Dropping it would strand a teacher
  // at the 60-minute mark holding a credential good for 30 days.
  refreshToken: string;
  expiresAt: number;
  email: string;
  groups: string[];
};

// Thrown when a session cannot be recovered. Distinct from a network or API
// failure so a caller's generic catch does not render a connection error
// underneath a "your session ended" message.
export class SessionExpiredError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

// The payload is read, not verified. The tokens arrived over TLS straight from
// Cognito, so the browser already knows where they came from, and they are only
// used here to print a name and show or hide a link. Every decision that
// actually matters happens at the API, which verifies the signature against the
// pool's JWKS. Never trust this on the server side.
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed token: no payload segment");
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
}

// Cognito's AuthenticationResult, PascalCase as the service returns it.
export type AuthenticationResult = {
  IdToken: string;
  AccessToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
};

export function storeTokens(result: AuthenticationResult): Session {
  const claims = decodeJwtPayload(result.IdToken);

  const session: Session = {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? "",
    expiresAt: Date.now() + Number(result.ExpiresIn ?? 0) * 1000,
    email: typeof claims.email === "string" ? claims.email : "",
    groups: Array.isArray(claims["cognito:groups"])
      ? (claims["cognito:groups"] as string[])
      : [],
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// Reads whatever is stored without judging its expiry - renewal needs an
// expired session, because that is where the refresh token lives.
export function readStored(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session.idToken ? session : null;
  } catch {
    // Corrupt or hand-edited. Drop it rather than crash the page.
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

// Returns null rather than an expired session, so callers cannot forget to
// check. Expiry is read from the token, not trusted from a flag we set.
//
// An expired session is left in storage rather than deleted, because its
// refresh token is what renewal needs. clearSession is the only thing that
// throws it away.
export function getSession(): Session | null {
  const session = readStored();
  if (!session) return null;
  return session.expiresAt > Date.now() ? session : null;
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
