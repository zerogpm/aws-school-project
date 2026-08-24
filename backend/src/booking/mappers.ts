// What a slot item looks like to each audience.
//
// The same query serves the parent's availability list and the staff roster,
// because they want the same items in the same order. What differs is what may
// leave the building: a booked slot carries a student number and a child's
// name, and the public route must never return either.
//
// Two explicit mappers rather than one function with a boolean, so the public
// shape is written out in full in one place and can be asserted key-for-key.
// mappers.test.ts pins that list, which means a field added to the item later
// fails a test instead of quietly appearing in a public response.
import { parseSlotSk } from "./slots.js";

/** A slot item as stored. Everything but the keys is optional - DynamoDB is schemaless. */
export type SlotItem = Record<string, unknown>;

export type PublicSlot = {
  slotId: string;
  teacherName: string;
  startsAt: string;
  available: boolean;
};

export type StaffSlot = PublicSlot & {
  teacherId: string;
  studentNumber: string | null;
  bookingRef: string | null;
  bookedAt: string | null;
};

/**
 * The slot id the outside world uses: the sort key, verbatim.
 *
 * Not a synthetic id. The client hands it straight back on POST /bookings and
 * the handler uses it as the key with no lookup and no translation table - so
 * there is no id that can drift from the item it names.
 */
export function slotIdOf(item: SlotItem): string {
  return String(item.SK ?? "");
}

/**
 * What a parent sees. Four keys, and never a fifth.
 *
 * `available` is computed rather than stored: a slot is free when nothing has
 * claimed it, which is the same condition the booking transaction asserts with
 * attribute_not_exists(bookedBy). One fact, expressed the same way in both
 * places, instead of a boolean column that can disagree with reality.
 */
export function toPublicSlot(item: SlotItem): PublicSlot {
  return {
    slotId: slotIdOf(item),
    teacherName: String(item.teacherName ?? ""),
    startsAt: startsAtOf(item),
    available: item.bookedBy === undefined || item.bookedBy === null,
  };
}

/**
 * What the office sees: the same slot, plus who holds it.
 *
 * null rather than absent for an unbooked slot, so every row has the same
 * shape and the admin table does not have to test for missing keys.
 */
export function toStaffSlot(item: SlotItem): StaffSlot {
  return {
    ...toPublicSlot(item),
    teacherId: teacherIdOf(item),
    studentNumber: optionalString(item.bookedBy),
    bookingRef: optionalString(item.bookingRef),
    bookedAt: optionalString(item.bookedAt),
  };
}

/**
 * Prefers the stored attribute and falls back to the key.
 *
 * The two cannot disagree - slotSk() built the key from this very value - but
 * the key is the one that is guaranteed present, because it is the key.
 */
function startsAtOf(item: SlotItem): string {
  if (typeof item.startsAt === "string" && item.startsAt) return item.startsAt;
  return parseSlotSk(slotIdOf(item))?.startsAt ?? "";
}

function teacherIdOf(item: SlotItem): string {
  if (typeof item.teacherId === "string" && item.teacherId) return item.teacherId;
  return parseSlotSk(slotIdOf(item))?.teacherId ?? "";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
