// Slot identity and the grid an interview evening is made of.
//
// Pure functions, no SDK import, no environment. Everything here is decidable
// from its arguments, which is why the tests beside it mock nothing at all -
// the interesting logic in this episode is key construction and time
// arithmetic, and neither needs a database to be wrong.

export type Teacher = {
  id: string;
  name: string;
};

export type GeneratedSlot = {
  /** The sort key this slot lives under, within the window's partition. */
  sk: string;
  teacherId: string;
  teacherName: string;
  startsAt: string;
};

export type SlotGridInput = {
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
  teachers: readonly Teacher[];
};

/**
 * The sort key for one slot: `SLOT#<startsAt>#<teacherId>`.
 *
 * Time first, teacher second, and that order is load-bearing. Sort keys sort as
 * strings, so a leading ISO-8601 timestamp puts the whole evening in
 * chronological order for free - which is the order both the parent's list and
 * the staff roster want, from the same single query, with no sorting in the
 * handler.
 *
 * Reversing it to SLOT#<teacherId>#<startsAt> would group by teacher instead
 * and force every reader to sort. Neither view wants that.
 */
export function slotSk(startsAt: string, teacherId: string): string {
  return `SLOT#${startsAt}#${teacherId}`;
}

/** The prefix every slot in a window shares - the begins_with for the query. */
export const SLOT_PREFIX = "SLOT#";

/**
 * The inverse of slotSk. Returns undefined for anything that is not a slot key.
 *
 * Splits on the first two separators only: a teacher id is matched against
 * whatever remains, so an id containing "#" round-trips rather than silently
 * truncating. Nothing generates such an id today - this costs one line and
 * removes a class of bug from the future.
 */
export function parseSlotSk(sk: string): { startsAt: string; teacherId: string } | undefined {
  if (!sk.startsWith(SLOT_PREFIX)) return undefined;

  const rest = sk.slice(SLOT_PREFIX.length);
  const separator = rest.indexOf("#");
  if (separator === -1) return undefined;

  const startsAt = rest.slice(0, separator);
  const teacherId = rest.slice(separator + 1);
  if (!startsAt || !teacherId) return undefined;

  return { startsAt, teacherId };
}

/**
 * Every slot for an evening: one per teacher per time step.
 *
 * Thrown rather than returned as a Result, because every one of these is a
 * malformed request from a member of staff rather than a runtime condition -
 * the handler catches and turns them into a 400 with the message.
 */
export function generateSlots(input: SlotGridInput): GeneratedSlot[] {
  const { opensAt, closesAt, slotMinutes, teachers } = input;

  const opens = Date.parse(opensAt);
  const closes = Date.parse(closesAt);

  if (Number.isNaN(opens)) throw new Error("opensAt is not a valid ISO-8601 timestamp");
  if (Number.isNaN(closes)) throw new Error("closesAt is not a valid ISO-8601 timestamp");
  if (closes <= opens) throw new Error("closesAt must be after opensAt");

  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    throw new Error("slotMinutes must be a positive whole number");
  }

  if (teachers.length === 0) throw new Error("at least one teacher is required");

  const duplicate = teachers.find(
    (teacher, index) => teachers.findIndex((other) => other.id === teacher.id) !== index,
  );
  if (duplicate) throw new Error(`teacher ${duplicate.id} is listed twice`);

  const step = slotMinutes * 60_000;

  // A guard, not a business rule. The grid is teachers x steps, so a one-minute
  // slot length over a long evening asks for a transaction-sized write of
  // items nobody meant to create - and the mistake is a typo in a number.
  const steps = Math.floor((closes - opens) / step);
  if (steps * teachers.length > 2000) {
    throw new Error("that window would create more than 2000 slots - check slotMinutes");
  }

  const slots: GeneratedSlot[] = [];

  for (let index = 0; index < steps; index++) {
    // Built from the epoch each time rather than by mutating one Date. ISO
    // strings normalise to UTC with a trailing Z, so the keys are stable no
    // matter what timezone the machine running this is in - a slot key that
    // shifted with the server's clock would be a different item after a
    // deploy.
    const startsAt = new Date(opens + index * step).toISOString();

    for (const teacher of teachers) {
      slots.push({
        sk: slotSk(startsAt, teacher.id),
        teacherId: teacher.id,
        teacherName: teacher.name,
        startsAt,
      });
    }
  }

  return slots;
}
