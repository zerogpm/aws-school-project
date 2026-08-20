import { Link, NavLink, Outlet } from "react-router-dom";
import { NAV } from "./data";
import { useAuth } from "./auth/authState";

export default function App() {
  const { session, loading } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-sm bg-forest-700 font-serif text-lg text-white"
            >
              M
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">
              Maplewood Secondary
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  isActive ? "text-forest-700" : "text-muted hover:text-forest-700"
                }
              >
                {item.label}
              </NavLink>
            ))}
            {/* Rendered as a transparent placeholder while the stored session
                is still being read, so the header does not jump a button width
                once it resolves - and so a signed-in teacher never sees "Staff
                sign in" flash before it corrects itself. */}
            {loading ? (
              <span
                aria-hidden
                className="rounded-md border border-transparent px-3 py-1.5 text-transparent"
              >
                Staff sign in
              </span>
            ) : (
              <NavLink
                to={session ? "/admin" : "/staff"}
                className="rounded-md border border-line px-3 py-1.5 text-ink hover:border-forest-600"
              >
                {session ? "Staff admin" : "Staff sign in"}
              </NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted">
          <p>&copy; 2026 Maplewood Secondary School</p>
          <p>A fictional school, used to demonstrate a real AWS build.</p>
        </div>
      </footer>
    </div>
  );
}
