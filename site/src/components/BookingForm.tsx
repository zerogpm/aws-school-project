import { useState, type FormEvent } from "react";
import { SLOTS, isValidStudentNumber } from "../data";

export default function BookingForm() {
  const [studentNumber, setStudentNumber] = useState("");
  const [slot, setSlot] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!isValidStudentNumber(studentNumber)) {
      setMessage("Enter a student number in the format S00481.");
      return;
    }
    if (!slot) {
      setMessage("Choose a time slot.");
      return;
    }

    // Wired to API Gateway in episode 04. The booking itself is a conditional
    // write against DynamoDB, so two parents clicking the same slot in the same
    // moment produce one confirmation and one clean rejection.
    setMessage("Booking opens in episode 04 - the API does not exist yet.");
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
        <div className="mt-2 space-y-2">
          {SLOTS.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm ${
                option.full
                  ? "cursor-not-allowed border-line bg-forest-50/50 text-muted"
                  : "cursor-pointer border-line bg-white hover:border-forest-600"
              }`}
            >
              <input
                type="radio"
                name="slot"
                value={option.id}
                disabled={option.full}
                checked={slot === option.id}
                onChange={(event) => setSlot(event.target.value)}
                className="accent-forest-700"
              />
              <span className="flex-1">
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted">{option.teacher}</span>
              </span>
              {option.full && (
                <span className="rounded-full bg-brass/15 px-2 py-0.5 text-xs font-medium text-brass">
                  Waitlist
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-brass">
          {message}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-md bg-forest-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-forest-900"
      >
        Request this time
      </button>
    </form>
  );
}
