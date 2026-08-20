import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AuthContext } from "./authState";
import { clearSession, getSession, type Session } from "./cognito";
import { refreshSession, signOut as revokeAndClear } from "./directAuth";

// Renew this far before the token actually expires. Long enough that a slow
// network, or a request already in flight, does not straddle the boundary.
const RENEW_MARGIN_MS = 5 * 60 * 1000;
const SESSION_KEY = "staff.session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const softSignOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  // No hosted UI to redirect to any more. Revoke the refresh token server-side
  // so it cannot be reused, then drop back to the public site.
  const signOut = useCallback(() => {
    void revokeAndClear().finally(() => {
      setSession(null);
      window.location.assign("/");
    });
  }, []);

  // Hydrate once. A stored session that has already expired is not a dead end -
  // its refresh token is good for refresh_token_validity_days, so a teacher
  // returning after lunch is renewed rather than bounced.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const live = getSession();
      if (live) {
        if (!cancelled) setSession(live);
      } else if (sessionStorage.getItem(SESSION_KEY)) {
        try {
          const renewed = await refreshSession();
          if (!cancelled) setSession(renewed);
        } catch {
          // Terminal. refreshSession has already cleared storage.
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Arm a single renewal for this token, and re-arm when a new one replaces it.
  // Keyed on the expiry rather than the session object, which would be a new
  // identity on every read and re-arm forever.
  //
  // Deliberately not setInterval: once per token lifetime instead of sixty
  // times an hour, and a tab left open overnight accumulates no backlog.
  const expiresAt = session?.expiresAt ?? 0;
  useEffect(() => {
    if (!expiresAt) return;

    const renew = async () => {
      try {
        setSession(await refreshSession());
      } catch {
        setSession(null);
      }
    };

    const dueIn = Math.max(expiresAt - Date.now() - RENEW_MARGIN_MS, 0);
    const timer = setTimeout(() => void renew(), dueIn);

    // A background tab has its timers throttled, so the scheduled renewal can
    // fire late or not at all. Re-check whenever the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= expiresAt - RENEW_MARGIN_MS) {
        void renew();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt]);

  return (
    <AuthContext.Provider value={{ session, loading, setSession, softSignOut, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
