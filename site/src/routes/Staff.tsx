export default function Staff() {
  return (
    <section className="bg-forest-900">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <h1 className="font-serif text-3xl font-semibold text-white">
          Staff sign in
        </h1>
        <p className="mt-4 max-w-xl text-forest-100">
          Publish the timetable, open interview windows, view rosters, and upload
          media. Accounts are created by the office &mdash; there is no
          self-registration.
        </p>
        <p className="mt-8 max-w-xl text-sm text-forest-100/70">
          This redirects to the Cognito hosted UI in episode 02. The pool is
          staff-only, roughly sixty accounts, with admin-create-user enforced.
        </p>
        <button
          type="button"
          disabled
          className="mt-8 rounded-md bg-white/90 px-5 py-3 text-sm font-medium text-forest-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Sign in with Cognito
        </button>
      </div>
    </section>
  );
}
