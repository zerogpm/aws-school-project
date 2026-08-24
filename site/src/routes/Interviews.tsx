import { useState } from "react";
import BookingForm from "../components/BookingForm";
import ManageBooking from "../components/ManageBooking";

const NOTES = [
  "One slot per teacher per family.",
  "If a slot is full you can join the waitlist and we will email you if it opens.",
  "To change a time, cancel the one you have and book again - it frees immediately.",
];

export default function Interviews() {
  // One counter, owned by the page, bumped whenever either panel changes a
  // booking. The panels stay independent - neither imports the other - and
  // neither can show a stale copy of the evening.
  const [changedAt, setChangedAt] = useState(0);
  const changed = () => setChangedAt((n) => n + 1);

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="lg:sticky lg:top-24">
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

        <div className="space-y-8">
          {/* Named regions, because the column has two "Student number" fields
              and nothing else distinguishes them for a screen reader. */}
          <section
            aria-labelledby="request-a-time"
            className="rounded-lg border border-line bg-white p-6 sm:p-8"
          >
          <h2 id="request-a-time" className="font-serif text-xl font-semibold text-forest-900">
            Request a time
          </h2>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            October 14 &amp; 15 &middot; 5:00 &ndash; 8:00 pm
          </p>
          <BookingForm refreshSignal={changedAt} onChanged={changed} />
          </section>

          <section
            aria-labelledby="change-or-cancel"
            className="rounded-lg border border-line bg-white p-6 sm:p-8"
          >
            <h2 id="change-or-cancel" className="font-serif text-xl font-semibold text-forest-900">
              Change or cancel a booking
            </h2>
            <p className="mt-1.5 mb-6 text-sm text-muted">
              There is no account to sign in to, so the reference from your
              confirmation is what identifies the booking. Cancelling frees the time
              immediately; to move to a different one, cancel and then book again
              above.
            </p>
            <ManageBooking onChanged={changed} />
          </section>
        </div>
      </div>
    </section>
  );
}
