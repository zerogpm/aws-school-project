import { useAuth } from "../auth/authState";

// What a signed-in teacher will eventually do here. Each one is a later
// episode: the storage exists, the API that writes to it does not yet.
const TASKS = [
  {
    title: "Upload documents",
    body: "Newsletters, permission forms and the year calendar, straight to S3 under docs/ with a presigned URL.",
    stage: "04-booking",
  },
  {
    title: "Upload photos and video",
    body: "Event media under photos/ and video/, which age into cheaper storage on their own.",
    stage: "04-booking",
  },
  {
    title: "Publish the timetable",
    body: "Replace the published semester timetable the whole school reads.",
    stage: "03-data",
  },
  {
    title: "Open interview windows",
    body: "Set the evening parents can book against, and see who has booked.",
    stage: "04-booking",
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
        <h2 className="font-serif text-xl font-semibold">What you can do here</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {TASKS.map((task) => (
            <li
              key={task.title}
              className="rounded-lg border border-line p-5"
            >
              <h3 className="font-medium text-ink">{task.title}</h3>
              <p className="mt-2 text-sm text-muted">{task.body}</p>
              <p className="mt-3 text-xs uppercase tracking-wide text-muted">
                Arrives in {task.stage}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
