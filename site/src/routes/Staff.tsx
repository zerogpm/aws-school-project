import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AuthError, completeNewPassword, signIn } from "../auth/directAuth";
import { isAuthConfigured } from "../auth/config";
import { useAuth } from "../auth/authState";

const INPUT =
  "mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-ink outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20";

const BUTTON =
  "w-full rounded-md bg-forest-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-forest-600 disabled:cursor-not-allowed disabled:opacity-60";

export default function Staff() {
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Set when Cognito answers a sign-in with NEW_PASSWORD_REQUIRED. Not an edge
  // case: every account the office creates starts in FORCE_CHANGE_PASSWORD, so
  // this is the path every teacher takes exactly once.
  const [challenge, setChallenge] = useState<{ username: string; session: string } | null>(
    null,
  );

  const configured = isAuthConfigured();

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const result = await signIn(email.trim(), password);
      if (result.kind === "newPassword") {
        setChallenge({ username: result.username, session: result.session });
        setPassword("");
        return;
      }
      setSession(result.session);
      navigate("/admin", { replace: true });
    } catch (err: unknown) {
      // Cognito keeps this vague on purpose - prevent_user_existence_errors
      // means a wrong password and an unknown address read the same, so this
      // page cannot be used to find out which teachers work here.
      setError(err instanceof AuthError ? err.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setError("");
    setBusy(true);

    try {
      setSession(
        await completeNewPassword(challenge.username, newPassword, challenge.session),
      );
      navigate("/admin", { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof AuthError ? err.message : "Could not set that password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-forest-700">
            Staff only
          </p>
          <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight text-ink">
            {challenge ? "Choose a new password." : "Sign in to the staff area."}
          </h1>
          <p className="mt-5 max-w-md text-muted">
            {challenge
              ? "Your account was created with a temporary password. Pick your own before carrying on."
              : "Publish the timetable, open interview windows, view rosters, and upload media."}
          </p>
          <p className="mt-8 max-w-md text-sm text-muted">
            Accounts are created by the office &mdash; there is no
            self-registration. If you cannot get in, the office can reset your
            password.
          </p>
        </div>

        <div className="md:pt-16">
          {!configured && (
            <p className="mb-6 rounded-md border border-line bg-forest-50 px-4 py-3 text-sm text-muted">
              This build has no user pool configured. Deploy <code>02-auth</code>,
              which passes the pool details into the bundle at build time.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mb-6 rounded-md border border-line bg-white px-4 py-3 text-sm text-ink"
            >
              {error}
            </p>
          )}

          {challenge ? (
            <form onSubmit={handleNewPassword} className="space-y-5" noValidate>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-ink">
                  New password
                </label>
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={INPUT}
                />
                <p className="mt-1.5 text-xs text-muted">
                  At least 12 characters, with an uppercase letter, a lowercase
                  letter and a number.
                </p>
              </div>
              <button type="submit" disabled={busy} className={BUTTON}>
                {busy ? "Saving…" : "Set password and continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-5" noValidate>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink">
                  School email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@maplewood.example"
                  className={INPUT}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-ink">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={INPUT}
                />
              </div>

              <button type="submit" disabled={!configured || busy} className={BUTTON}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
