// The only gate on the public booking route.
//
// There are no parent accounts, by decision in 02 - the pool would otherwise
// carry 800 families instead of 60 staff, and that single choice is what keeps
// Cognito inside the free tier. So a student number is the whole credential,
// and it is deliberately a weak one: it is printed on every report card and a
// determined stranger could guess the format in a minute.
//
// That is survivable because of what a booking can do - claim a twenty minute
// conversation with a teacher - and because API Gateway throttles the route to
// a rate a human can produce and a loop cannot. It would not be survivable if
// this gated anything about the student's record, which is why it never will.
//
// This regex is duplicated in site/src/data.ts, which says of it: "The
// identical check runs server-side in episode 04, because a client-side check
// stops typos, not attackers." This is that check. Two copies, because the
// front end must not import from backend/ - if one moves, move both.
export const STUDENT_NUMBER = /^S\d{5}$/;

/**
 * Trimmed and upper-cased before testing, because the number arrives typed by
 * a parent on a phone: "s00481 " is the same student as "S00481".
 */
export function isValidStudentNumber(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return STUDENT_NUMBER.test(normaliseStudentNumber(value));
}

/**
 * The canonical form, which is what goes in a key.
 *
 * Every write and every lookup goes through here. Skipping it on one path
 * produces STUDENT#s00481 and STUDENT#S00481 as two different partitions - a
 * family that can book the same teacher twice, and a bug that only appears when
 * somebody types in lower case.
 */
export function normaliseStudentNumber(value: string): string {
  return value.trim().toUpperCase();
}
