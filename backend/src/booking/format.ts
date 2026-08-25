// Turning a stored instant into something a parent can read.
//
// Every time in this system is stored as an ISO instant in UTC - the slot sort
// key is built from it, so it has to sort lexicographically and it has to be
// unambiguous. That is the right shape for a datastore and the wrong shape for
// a sentence: "2026-10-14T21:40:00.000Z" in an email asks a parent to do
// timezone arithmetic to find out when to arrive at their own child's school.
//
// So the conversion happens at the edge that has a human on the other end, and
// nothing about what is stored changes.
//
// site/src/api/interviews.ts has its own formatSlotTime for the booking grid.
// The duplication is deliberate: the two packages share no build, and a shared
// module between them would be a package to publish for twelve lines. They must
// agree on the timezone, which is why both name it in a comment rather than
// inheriting it from wherever the code happens to be running.

/**
 * The school's timezone, not the reader's and not the server's.
 *
 * A Lambda runs in UTC and a parent may open the mail from anywhere; neither of
 * those is the time they are expected to walk into the building. Hardcoded
 * rather than an env var on purpose - it is a fact about where the school is,
 * not configuration, and a wrong value here is a parent arriving an hour out.
 */
const SCHOOL_TIMEZONE = "America/Toronto";

/**
 * `2026-10-14T21:40:00.000Z` -> `Wednesday, October 14, 2026 at 5:40 p.m. EDT`.
 *
 * The long form, with the year and the zone abbreviation, because an email is
 * not the booking grid. The grid is dense, repeats the date down a column and
 * sits behind a heading that already says which evening it is; a message read
 * once on a phone three weeks later has none of that context. EDT/EST is the
 * cheapest way to end the question for a parent reading in another timezone,
 * and Intl switches between them on the date rather than on today.
 *
 * An unparseable value comes back untouched. The alternative is "Invalid Date"
 * in a message to a parent, and a raw timestamp at least carries the facts.
 */
export function formatSlotTime(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: SCHOOL_TIMEZONE,
    timeZoneName: "short",
  }).format(date);
}
