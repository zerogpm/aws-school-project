import BookingForm from "../components/BookingForm";

const NOTES = [
  "One slot per teacher per family.",
  "If a slot is full you can join the waitlist and we will email you if it opens.",
  "Cancellations free the slot immediately for the next family.",
];

export default function Interviews() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-forest-900">
            Parent-teacher interviews
          </h1>
          <p className="mt-5 text-muted">
            Interviews run twice a year over two evenings. Slots are twenty
            minutes and are booked first come, first served.
          </p>
          <p className="mt-4 text-muted">
            You do not need an account. Your child&rsquo;s student number is the
            only thing required &mdash; it is printed on every report card.
          </p>
          <ul className="mt-7 space-y-3 text-sm text-muted">
            {NOTES.map((note) => (
              <li key={note} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-forest-600"
                />
                {note}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-line bg-white p-6 sm:p-8">
          <h2 className="font-serif text-xl font-semibold text-forest-900">
            Request a time
          </h2>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            October 14 &amp; 15 &middot; 5:00 &ndash; 8:00 pm
          </p>
          <BookingForm />
        </div>
      </div>
    </section>
  );
}
