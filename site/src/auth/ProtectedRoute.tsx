import { Navigate } from "react-router-dom";
import { useAuth } from "./authState";

// Gates a route on a live session. A convenience, not a control: the tokens sit
// in sessionStorage where anyone can edit them, so this only decides what to
// render. The API is what actually refuses.
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  // Render nothing rather than the redirect while the stored session is still
  // being read and renewed. Redirecting here would bounce a signed-in teacher
  // to the sign-in page on every reload.
  if (loading) return null;
  if (!session) return <Navigate to="/staff" replace />;

  return <>{children}</>;
}
