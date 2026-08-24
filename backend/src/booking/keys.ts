// Every key in the booking model, built in one place.
//
// Key construction scattered across handlers is how a partition ends up spelled
// two ways - and a mismatched key does not error, it simply finds nothing,
// which reads like data loss rather than like a typo. Template literals inline
// in five handlers is exactly that risk; these seven functions are not.
//
// The slot key lives in slots.ts, with the grid arithmetic that produces it.
import { normaliseStudentNumber } from "./student-number.js";

/** An interview window's partition. Its META item and all its slots live here. */
export const windowPk = (windowId: string): string => `WINDOW#${windowId}`;

/** The window's own item, carrying the label and the opening times. */
export const WINDOW_META_SK = "META";

/**
 * A student's partition: their profile, and one claim per teacher they hold.
 *
 * Normalised, always. This is the single reason normaliseStudentNumber exists -
 * "s00481" and "S00481" must not be two families.
 */
export const studentPk = (studentNumber: string): string =>
  `STUDENT#${normaliseStudentNumber(studentNumber)}`;

/** The student's profile item. Its existence is what "a real student" means. */
export const STUDENT_PROFILE_SK = "PROFILE";

/**
 * The uniqueness guard behind "One slot per teacher per family".
 *
 * A guard item, not data: it exists to be written with attribute_not_exists in
 * the same transaction as the slot claim, so the second attempt by the same
 * family for the same teacher fails atomically rather than after a read that
 * something else invalidated a millisecond later.
 *
 * Scoped to the window as well as the teacher, so a family booking Ms. Okafor
 * in the autumn is not blocked from booking her again in the spring.
 */
export const claimSk = (windowId: string, teacherId: string): string =>
  `CLAIM#${windowId}#${teacherId}`;

/**
 * The guard behind "a family cannot be in two rooms at once".
 *
 * CLAIM# stops the same teacher twice. It says nothing about two *different*
 * teachers at the same moment, which is the more likely mistake: a parent
 * works down the list booking one teacher after another and takes 5:00 twice
 * without noticing, because each booking succeeds on its own.
 *
 * Same shape as claimSk and written in the same transaction, so the check is
 * atomic rather than a read that something else invalidates a millisecond
 * later. Scoped to the window, so the spring evening is unaffected.
 */
export const timeSk = (windowId: string, startsAt: string): string =>
  `TIME#${windowId}#${startsAt}`;

/**
 * A booking's own partition, keyed by the reference the parent is given.
 *
 * This exists so cancellation can find the slot from the reference alone. The
 * reference is a v4 uuid and doubles as the capability to cancel, since there
 * are no parent accounts to authenticate against.
 */
export const bookingPk = (ref: string): string => `BOOKING#${ref}`;

export const BOOKING_META_SK = "META";
