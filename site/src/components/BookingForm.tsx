import { useEffect, useState, type FormEvent } from "react";
import { isValidStudentNumber } from "../data";
import {
  cancelBooking,
  createBooking,
  fetchSlots,
  formatSlotTime,
  isApiConfigured,
  type Booking,
  type PublicSlot,
} from "../api/interviews";

/**
 * Rows per page.
 *
 * Six fits without the panel growing a scrollbar of its own, which is the thing
 * being avoided: a list that scrolls inside a page that also scrolls gives a
 * reader two scrollbars and no sense of how much is left.
 */
const PAGE_SIZE = 6;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; slots: PublicSlot[] }
  | { status: "failed"; error: string };

/**
 * `refreshSignal` is bumped by the page when the cancel panel below gives a
 * slot back. Without it the two panels hold two copies of the same truth: a
 * parent cancels down there, and the list up here still shows the time struck
 * through until they reload - which reads as the cancel having failed.
 */
export default function BookingForm({
  refreshSignal = 0,
  onChanged,
}: {
  refreshSignal?: number;
  onChanged?: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [studentNumber, setStudentNumber] = useState("");
  const [slot, setSlot] = useState("");
  const [teacher, setTeacher] = useState("");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  // Everything booked in this session. There is no "my bookings" endpoint - the
  // route would have to be public and would leak a family's evening to anyone
  // holding a student number - so this is per-session and deliberately modest.
  const [madeHere, setMadeHere] = useState<Booking[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function loadSlots() {
    const result = await fetchSlots();
    setLoad(
      result.ok
        ? { status: "ready", slots: result.value.slots }
        : { status: "failed", error: result.error },
    );
  }

  useEffect(() => {
    void loadSlots();
  }, [refreshSignal]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBooking(null);

    // Checked here as well as on the server. This one stops typos; the server's
    // copy is the one that stops anything else - see src/booking/student-number.ts.
    if (!isValidStudentNumber(studentNumber)) {
      setMessage("Enter a student number in the format S00481.");
      return;
    }
    if (!slot) {
      setMessage("Choose a time slot.");
      return;
    }

    setSubmitting(true);
    setMessage(null);

    const result = await createBooking({ studentNumber, slotId: slot });

    setSubmitting(false);

    if (result.ok) {
      setBooking(result.value);
      setMadeHere((made) => [...made, result.value]);
      setSlot("");
      onChanged?.();
      // The slot this parent just took is now gone for everyone, so the list
      // they are looking at is already out of date.
      void loadSlots();
      return;
    }

    setMessage(result.error);

    // A 409 means somebody else moved first. Reload so the next choice is made
    // against what is actually free rather than against a stale page.
    if (result.retry) void loadSlots();
  }

  async function handleCancel(bookingRef: string, forStudent: string) {
    setSubmitting(true);
    const result = await cancelBooking({ bookingRef, studentNumber: forStudent });
    setSubmitting(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    // Back to the list with the slot freed, which is what "change my time"
    // actually is - there is no reschedule, and two visible steps beat a hidden
    // one that briefly holds two slots.
    setBooking(null);
    setMadeHere((made) => made.filter((one) => one.bookingRef !== bookingRef));
    setSlot("");
    setMessage("That time has been given up. Choose another below.");
    void loadSlots();
    onChanged?.();
  }

  const allSlots = load.status === "ready" ? load.slots : [];

  // Insertion order is the slot order, which is chronological, so the teachers
  // come out in the order they first appear rather than needing a sort.
  const teachers = [...new Set(allSlots.map((option) => option.teacherName))];
  const shown = teacher ? allSlots.filter((option) => option.teacherName === teacher) : allSlots;
  const available = shown.filter((option) => option.available);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));

  // Clamped on the way out rather than corrected in an effect. The list shrinks
  // under the reader - another parent books, the teacher filter changes - and a
  // page index left pointing past the end would render nothing at all, with no
  // error to explain the blank.
  const current = Math.min(page, pageCount - 1);
  const pageSlots = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  if (!isApiConfigured()) {
    return (
      <p role="status" className="text-sm text-muted">
        Booking is not configured for this build.
      </p>
    );
  }

  if (booking) {
    return (
      <div role="status" className="space-y-4">
        <p className="text-sm font-medium text-forest-900">
          Booked &mdash; {formatSlotTime(booking.startsAt)}
        </p>
        <p className="text-sm text-muted">
          Your reference is{" "}
          <span className="font-mono text-ink">{booking.bookingRef}</span>. Keep it:
          it is what you need to change or cancel this booking later.
        </p>

        {madeHere.length > 1 && (
          <div className="rounded-md border border-line bg-forest-50/40 p-3">
            <p className="text-xs font-medium text-ink">
              Booked for {booking.studentNumber} this evening
            </p>
            <ul className="mt-2 space-y-1">
              {[...madeHere]
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                .map((one) => (
                  <li key={one.bookingRef} className="text-xs text-muted">
                    {formatSlotTime(one.startsAt)}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {/* The common case, and it was missing: one child, several teachers
              on the same evening. Keeps the student number, so the parent does
              not retype it once per teacher. */}
          <button
            type="button"
            onClick={() => {
              setBooking(null);
              setSlot("");
              setTeacher("");
              setPage(0);
              setMessage(null);
            }}
            className="rounded-md bg-forest-700 px-4 py-2 text-sm font-medium text-white hover:bg-forest-900"
          >
            Book another teacher
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleCancel(booking.bookingRef, booking.studentNumber)}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:border-forest-600 disabled:opacity-60"
          >
            {submitting ? "Cancelling…" : "Cancel this time"}
          </button>

          <button
            type="button"
            onClick={() => {
              setBooking(null);
              setMadeHere([]);
              setStudentNumber("");
              setSlot("");
              setTeacher("");
              setPage(0);
              setMessage(null);
            }}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-ink"
          >
            Book for another child
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="student-number" className="block text-sm font-medium text-ink">
          Student number
        </label>
        <input
          id="student-number"
          name="student-number"
          value={studentNumber}
          onChange={(event) => setStudentNumber(event.target.value)}
          placeholder="S00481"
          autoComplete="off"
          className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-ink outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20"
        />
        <p className="mt-1.5 text-xs text-muted">
          Printed on your child&rsquo;s report card. No account required.
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Available times</legend>

        {load.status === "loading" && (
          <p className="mt-2 text-sm text-muted">Loading times&hellip;</p>
        )}

        {load.status === "failed" && (
          <p role="alert" className="mt-2 text-sm text-brass">
            {load.error}
          </p>
        )}

        {load.status === "ready" && load.slots.length === 0 && (
          <p className="mt-2 text-sm text-muted">No times have been opened yet.</p>
        )}

        {load.status === "ready" && load.slots.length > 0 && (
          <>
            {/* Teacher first, then time.
                A parent is choosing a person, not a moment - and thirty-six
                rows sorted by time put the same "5:40 p.m." on screen four
                times over, once per teacher, which reads as a duplicate. One
                teacher at a time is nine rows: no inner scrollbar, and the
                repeated element is the useful one. */}
            <div className="mt-2">
              <label htmlFor="teacher" className="block text-xs text-muted">
                Teacher
              </label>
              <select
                id="teacher"
                value={teacher}
                onChange={(event) => {
                  setTeacher(event.target.value);
                  // The chosen slot belonged to the previous teacher, and page
                  // four of the old list is not page four of the new one.
                  setSlot("");
                  setPage(0);
                }}
                className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20"
              >
                <option value="">All teachers</option>
                {teachers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <p className="mt-3 text-xs text-muted">
              {available.length} of {shown.length} times free
            </p>

            <div className="mt-2 space-y-2">
              {pageSlots.map((option) => {
                // A slot this session booked, as opposed to one another family
                // holds. Both are unbookable; only one of them is good news, and
                // showing them identically makes a parent think they lost a slot
                // they actually have.
                const mine = madeHere.some((one) => one.slotId === option.slotId);

                return (
                  <label
                    key={option.slotId}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm ${
                      option.available
                        ? "cursor-pointer border-line bg-white hover:border-forest-600"
                        : mine
                          ? "cursor-not-allowed border-forest-600/40 bg-forest-50"
                          : "cursor-not-allowed border-line bg-forest-50/40 opacity-70"
                    }`}
                  >
                    <input
                      type="radio"
                      name="slot"
                      value={option.slotId}
                      disabled={!option.available}
                      checked={slot === option.slotId}
                      onChange={(event) => setSlot(event.target.value)}
                      className="accent-forest-700"
                    />
                    <span className="flex-1">
                      <span
                        className={`font-medium ${
                          option.available ? "" : "text-muted line-through decoration-muted/60"
                        }`}
                      >
                        {formatSlotTime(option.startsAt)}
                      </span>
                      {/* Only when the list is mixed - repeating the teacher
                          under every row of their own list is noise. */}
                      {!teacher && (
                        <span className="block text-xs text-muted">{option.teacherName}</span>
                      )}
                    </span>

                    {!option.available &&
                      (mine ? (
                        <span className="shrink-0 rounded-full bg-forest-700 px-2.5 py-1 text-xs font-semibold text-white">
                          Your booking
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-brass/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brass">
                          Booked
                        </span>
                      ))}
                  </label>
                );
              })}
            </div>

            {pageCount > 1 && (
              <nav
                aria-label="Times"
                className="mt-4 flex items-center justify-between gap-3"
              >
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:border-forest-600 disabled:opacity-40 disabled:hover:border-line"
                >
                  Earlier
                </button>

                {/* aria-live, so a screen reader hears the page change - the
                    rows above swap silently otherwise. */}
                <span aria-live="polite" className="text-xs text-muted">
                  Page {current + 1} of {pageCount}
                </span>

                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount - 1}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:border-forest-600 disabled:opacity-40 disabled:hover:border-line"
                >
                  Later
                </button>
              </nav>
            )}

            {/* A slot chosen on another page is still submitted, so say so
                rather than letting the button look like it does nothing. */}
            {slot && !pageSlots.some((option) => option.slotId === slot) && (
              <p className="mt-3 text-xs text-muted">
                Chosen: {formatSlotTime(shown.find((o) => o.slotId === slot)!.startsAt)}
              </p>
            )}
          </>
        )}
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-brass">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-forest-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-forest-900 disabled:opacity-60"
      >
        {submitting ? "Requesting…" : "Request this time"}
      </button>
    </form>
  );
}
