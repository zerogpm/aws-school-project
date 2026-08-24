// The booking API, as the front end sees it.
//
// Everything that knows a URL or a status code lives here, so the form is a
// form and this is the only file that changes when the API does.
//
// Errors are returned, not thrown. A booking fails for four distinct reasons
// and the parent can act on each of them differently - "that time was just
// taken" means pick another, "no student with that number" means check the
// report card. Collapsing those into one catch block would throw away the work
// create-booking does to tell them apart.

/**
 * Which evening this page is advertising.
 *
 * Hardcoded because listing windows is a staff route - the public API has no
 * "what is open right now" endpoint, and adding one is a decision for a later
 * episode rather than something to smuggle in here. The page already hardcodes
 * the dates in its body copy; this is the same fact, in the same place.
 */
export const INTERVIEW_WINDOW = "autumn-2026";

/**
 * Where the API lives.
 *
 * Injected at build time by scripts/deploy-site.sh from the Terraform outputs.
 * In `vite dev` there is no build step and no Terraform, so it falls back to the
 * local wrapper - the one `./app.sh --start` puts on :3000.
 *
 * 127.0.0.1 and never localhost: on Windows localhost resolves to ::1 first and
 * the local API binds IPv4, so the request is refused with an error that says
 * nothing about IPv6.
 *
 * The fallback is deliberately scoped to DEV. A production bundle built without
 * VITE_API_URL returns "" and the form explains itself, rather than shipping a
 * page that quietly tries to reach a laptop.
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.replace(/\/+$/, "") ?? "";
  if (configured) return configured;

  return import.meta.env.DEV ? "http://127.0.0.1:3000" : "";
}

export function isApiConfigured(): boolean {
  return apiBaseUrl() !== "";
}

/** A slot as the public route returns it. Four keys, and never a student number. */
export type PublicSlot = {
  slotId: string;
  teacherName: string;
  startsAt: string;
  available: boolean;
};

export type SlotsResponse = {
  windowId: string;
  label: string;
  opensAt: string;
  closesAt: string;
  slots: PublicSlot[];
};

export type Booking = {
  bookingRef: string;
  windowId: string;
  slotId: string;
  startsAt: string;
  teacherId: string;
  studentNumber: string;
};

/** Ok or a message worth showing. `retry` marks the ones where picking again helps. */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number; retry: boolean };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // A non-JSON body - a proxy error page, or the API not being there at all.
  }

  return "Something went wrong. Please try again.";
}

export async function fetchSlots(
  windowId = INTERVIEW_WINDOW,
): Promise<ApiResult<SlotsResponse>> {
  try {
    const response = await fetch(`${apiBaseUrl()}/windows/${windowId}/slots`);

    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 404
            ? "Booking for this evening is not open yet."
            : await readError(response),
        status: response.status,
        retry: false,
      };
    }

    return { ok: true, value: (await response.json()) as SlotsResponse };
  } catch {
    // fetch rejects only on a transport failure - no server, DNS, CORS.
    return {
      ok: false,
      error: "Could not reach the booking service.",
      status: 0,
      retry: true,
    };
  }
}

export async function createBooking(input: {
  studentNumber: string;
  slotId: string;
  windowId?: string;
}): Promise<ApiResult<Booking>> {
  try {
    const response = await fetch(`${apiBaseUrl()}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentNumber: input.studentNumber,
        windowId: input.windowId ?? INTERVIEW_WINDOW,
        slotId: input.slotId,
      }),
    });

    if (response.status === 201) {
      return { ok: true, value: (await response.json()) as Booking };
    }

    return {
      ok: false,
      error: await readError(response),
      status: response.status,
      // A 409 means the world moved: the slot went, or this family already
      // holds one with that teacher. Reloading the list is the useful next
      // step. A 400 or 404 is about what was typed, and a reload would only
      // wipe it.
      retry: response.status === 409,
    };
  } catch {
    return {
      ok: false,
      error: "Could not reach the booking service.",
      status: 0,
      retry: false,
    };
  }
}

/**
 * Give a slot back.
 *
 * There are no parent accounts, so the reference is the credential: an
 * unguessable v4 uuid that only the parent who booked was ever shown. The
 * student number is required with it, so a reference forwarded in an email is
 * not on its own enough to cancel someone else's interview.
 *
 * Changing a time is cancel-then-book. The API has no reschedule, and adding
 * one would mean holding two slots for an instant or releasing the old one
 * before the new is certain - both worse than two explicit steps the parent can
 * see.
 */
export async function cancelBooking(input: {
  bookingRef: string;
  studentNumber: string;
}): Promise<ApiResult<{ bookingRef: string }>> {
  try {
    const response = await fetch(
      `${apiBaseUrl()}/bookings/${encodeURIComponent(input.bookingRef.trim())}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: input.studentNumber }),
      },
    );

    if (response.ok) {
      return { ok: true, value: (await response.json()) as { bookingRef: string } };
    }

    return {
      ok: false,
      error:
        response.status === 404
          ? "No booking with that reference. Check it against your confirmation."
          : await readError(response),
      status: response.status,
      retry: false,
    };
  } catch {
    return {
      ok: false,
      error: "Could not reach the booking service.",
      status: 0,
      retry: false,
    };
  }
}

export type FamilyBooking = {
  bookingRef: string;
  slotId: string;
  teacherName: string;
  startsAt: string;
};

/**
 * Everything this family booked for the evening.
 *
 * Keyed on a reference *plus* the student number, never the number alone. The
 * number is on every report card and is guessable in shape; the reference is an
 * unguessable v4 uuid that only reached the family who booked. Holding one
 * proves membership, so listing the rest of their evening reveals nothing they
 * did not already have.
 */
export async function lookupBookings(input: {
  bookingRef: string;
  studentNumber: string;
}): Promise<ApiResult<FamilyBooking[]>> {
  try {
    const response = await fetch(`${apiBaseUrl()}/bookings/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingRef: input.bookingRef.trim(),
        studentNumber: input.studentNumber,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 404
            ? "No booking with that reference. Check it against your confirmation."
            : await readError(response),
        status: response.status,
        retry: false,
      };
    }

    const body = (await response.json()) as { bookings: FamilyBooking[] };
    return { ok: true, value: body.bookings };
  } catch {
    return { ok: false, error: "Could not reach the booking service.", status: 0, retry: true };
  }
}

/** "Tue 14 Oct - 5:00 pm", in the school's timezone rather than the browser's. */
export function formatSlotTime(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    // The school is in Canada and so is the data. A parent in another timezone
    // must still see the time they are expected to arrive.
    timeZone: "America/Toronto",
  }).format(date);
}
