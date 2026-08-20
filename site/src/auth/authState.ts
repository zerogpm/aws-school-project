import { createContext, useContext } from "react";
import type { Session } from "./cognito";

export type AuthState = {
  session: Session | null;
  // Starts true so nothing renders a signed-out view before the stored session
  // has been read and, if stale, renewed. Without it every protected page
  // flashes its redirect on load.
  loading: boolean;
  setSession: (session: Session) => void;
  // Clears tokens without leaving the page, so the SPA stays mounted and can
  // explain itself. Full sign-out redirects to Cognito to kill the server-side
  // session too.
  softSignOut: () => void;
  signOut: () => void;
};

// Kept out of AuthContext.tsx so that file exports only a component, which is
// what lets fast refresh work on it.
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider");
  return context;
}
