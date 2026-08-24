import { useState, type FormEvent } from "react";
import { isValidStudentNumber } from "../data";
import {
  cancelBooking,
  formatSlotTime,
  isApiConfigured,
  lookupBookings,
  type FamilyBooking,
} from "../api/interviews";

/**
 * The way back in for a parent who closed the tab.
 *
 * Two steps, and the split is the security design. Step one takes a reference
 * and a student number and returns *everything* that family booked; step two
 * cancels whichever one they pick.
 *
 * A one-step "cancel this reference" was the first version, and it could only
 * ever cancel the confirmation they still had. A family that booked three
 * teachers and kept one email had no way to reach the other two.
 *
 * The obvious alternative - look up by student number alone - is a leak. The
 * number is on every report card and is S plus five digits, so anyone who
 * guessed one could read a family's evening. A reference is an unguessable v4
 * uuid that only ever reached the family who booked, so requiring both means a
 * stranger with a guessed number still gets nothing.
 */
export default function ManageBooking({ onChanged }: { onChanged?: () => void }) {
  const [bookingRef, setBookingRef] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [bookings, setBookings] = useState<FamilyBooking[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isApiConfigured()) return null;

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setDone(null);

    if (!bookingRef.trim()) {
      setMessage("Enter the reference from your confirmation.");
      return;
    }
    if (!isValidStudentNumber(studentNumber)) {
      setMessage("Enter a student number in the format S00481.");
      return;
    }

    setBusy(true);
    const result = await lookupBookings({ bookingRef, studentNumber });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setBookings(result.value);
    if (result.value.length === 0) {
      setMessage("That booking has already been cancelled.");
    }
  }

  async function handleCancel(one: FamilyBooking) {
    setBusy(true);
    setMessage(null);

    const result = await cancelBooking({ bookingRef: one.bookingRef, studentNumber });

    setBusy(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    // Drop it from the list rather than re-querying: the reference the parent
    // typed may have been the one just cancelled, and a second lookup with a
    // dead reference would 404 and look like a failure.
    const left = bookings?.filter((b) => b.bookingRef !== one.bookingRef) ?? [];
    setBookings(left);
    setDone(`${formatSlotTime(one.startsAt)} has been given up.`);

    // The slot list above is now wrong by exactly one row. Telling the page
    // rather than reaching for the other component keeps them independent.
    onChanged?.();
  }

  function reset() {
    setBookings(null);
    setBookingRef("");
    setStudentNumber("");
    setMessage(null);
    setDone(null);
  }

  if (bookings) {
    return (
      <div className="space-y-4">
        {done && (
          <p role="status" className="text-sm font-medium text-forest-900">
            {done} It is free for another family straight away.
          </p>
        )}

        {bookings.length > 0 ? (
          <>
            <p className="text-sm text-muted">
              Booked for <span className="font-medium text-ink">{studentNumber}</span>. Cancel
              whichever you no longer need &mdash; to move a time, cancel it and book again
              above.
            </p>

            <ul className="divide-y divide-line rounded-md border border-line">
              {bookings.map((one) => (
                <li key={one.bookingRef} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {formatSlotTime(one.startsAt)}
                    </span>
                    <span className="block text-xs text-muted">{one.teacherName}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancel(one)}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-forest-600 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Nothing booked for this student any more.</p>
        )}

        {message && (
          <p role="alert" className="text-sm text-brass">
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          className="text-sm font-medium text-forest-700 underline underline-offset-4 hover:text-forest-900"
        >
          Look up another booking
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleLookup} className="space-y-4" noValidate>
      <div>
        <label htmlFor="booking-ref" className="block text-sm font-medium text-ink">
          Booking reference
        </label>
        <input
          id="booking-ref"
          name="booking-ref"
          value={bookingRef}
          onChange={(event) => setBookingRef(event.target.value)}
          placeholder="459e875f-19f8-4378-afb1-26b614c1a7f3"
          autoComplete="off"
          className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm text-ink outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20"
        />
        <p className="mt-1.5 text-xs text-muted">
          Any one of your confirmations will do &mdash; it finds the rest.
        </p>
      </div>

      <div>
        <label htmlFor="cancel-student-number" className="block text-sm font-medium text-ink">
          Student number
        </label>
        <input
          id="cancel-student-number"
          name="cancel-student-number"
          value={studentNumber}
          onChange={(event) => setStudentNumber(event.target.value)}
          placeholder="S00481"
          autoComplete="off"
          className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-ink outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20"
        />
      </div>

      {message && (
        <p role="alert" className="text-sm text-brass">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:border-forest-600 disabled:opacity-60"
      >
        {busy ? "Looking up…" : "Find my bookings"}
      </button>
    </form>
  );
}
