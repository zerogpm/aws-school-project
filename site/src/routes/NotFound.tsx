import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-28">
      <p className="font-serif text-6xl font-bold text-forest-900">404</p>
      <h1 className="mt-4 font-serif text-2xl font-semibold text-forest-900">
        That page does not exist
      </h1>
      <p className="mt-3 max-w-lg text-muted">
        The link may be out of date. Everything families need is on the home
        page.
      </p>
      <Link
        to="/"
        className="mt-8 inline-block rounded-md bg-forest-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-forest-900"
      >
        Back to the home page
      </Link>
    </section>
  );
}
