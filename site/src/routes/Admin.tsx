import { useAuth } from "../auth/authState";
import DocumentUpload from "../components/DocumentUpload";

// What a signed-in teacher can do here, and what is still a promise.
//
// `status` rather than a stage name, because a stage name goes stale the moment
// that episode ships something else - three of these said "arrives in
// 04-booking" while 04 was busy being the booking episode. Status is a claim
// about today, so it is wrong loudly rather than quietly.
type TaskStatus = "ready" | "api-only" | "planned";

const STATUS_LABEL: Record<TaskStatus, string> = {
  ready: "Available now",
  "api-only": "API only - no page yet",
  planned: "Planned",
};

const TASKS: { title: string; body: string; status: TaskStatus }[] = [
  {
    title: "Open interview windows",
    body: "Set the evening parents can book against, and see who has booked. The API exists - POST /windows and GET /windows/{id}/bookings - but nothing on this page calls it yet.",
    status: "api-only",
  },
  {
    title: "Publish the timetable",
    body: "Replace the published semester timetable the whole school reads. The single table can hold it; nothing writes it.",
    status: "planned",
  },
];

export default function Admin() {
  // ProtectedRoute has already established there is a live session, and the
  // provider keeps it renewed - so no guard, no redirect effect and no stale
  // copy read at mount time.
  const { session, signOut } = useAuth();
  if (!session) return null;

  return (
    <section>
      <div className="border-b border-line bg-forest-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-white">
              Staff admin
            </h1>
            <p className="mt-2 text-sm text-forest-100">
              Signed in as {session.email}
              {session.groups.length > 0 && ` \u00b7 ${session.groups.join(", ")}`}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-md border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <section aria-labelledby="documents" className="rounded-lg border border-line p-6">
          <h2 id="documents" className="font-serif text-xl font-semibold text-forest-900">
            Publish a document
          </h2>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            Newsletters, permission forms and the year calendar. Office staff only &mdash; the
            API refuses anyone else, so this page not showing it is a convenience, not the
            protection.
          </p>
          <DocumentUpload />
        </section>

        <h2 className="mt-12 font-serif text-xl font-semibold">Still to come</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {TASKS.map((task) => (
            <li
              key={task.title}
              className="rounded-lg border border-line p-5"
            >
              <h3 className="font-medium text-ink">{task.title}</h3>
              <p className="mt-2 text-sm text-muted">{task.body}</p>
              <p
                className={`mt-3 text-xs uppercase tracking-wide ${
                  task.status === "ready" ? "text-forest-700" : "text-muted"
                }`}
              >
                {STATUS_LABEL[task.status]}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
