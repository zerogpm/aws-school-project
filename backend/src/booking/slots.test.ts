import { describe, expect, it } from "vitest";
import { generateSlots, parseSlotSk, slotSk, type Teacher } from "./slots.js";

const OKAFOR: Teacher = { id: "okafor", name: "Ms. Okafor - Mathematics" };
const LEVESQUE: Teacher = { id: "levesque", name: "Mr. Levesque - Science" };

const evening = {
  opensAt: "2026-10-14T17:00:00.000Z",
  closesAt: "2026-10-14T20:00:00.000Z",
  slotMinutes: 20,
  teachers: [OKAFOR, LEVESQUE],
};

describe("slotSk", () => {
  it("puts the time first, so a window's slots sort chronologically", () => {
    const keys = [
      slotSk("2026-10-14T19:40:00.000Z", "okafor"),
      slotSk("2026-10-14T17:00:00.000Z", "levesque"),
      slotSk("2026-10-14T18:20:00.000Z", "okafor"),
    ];

    // Plain string sort - which is what DynamoDB does to a sort key. Getting
    // this wrong means every reader has to sort in the handler instead.
    expect([...keys].sort()).toEqual([
      "SLOT#2026-10-14T17:00:00.000Z#levesque",
      "SLOT#2026-10-14T18:20:00.000Z#okafor",
      "SLOT#2026-10-14T19:40:00.000Z#okafor",
    ]);
  });
});

describe("parseSlotSk", () => {
  it("round-trips a key built by slotSk", () => {
    const sk = slotSk("2026-10-14T17:00:00.000Z", "okafor");
    expect(parseSlotSk(sk)).toEqual({
      startsAt: "2026-10-14T17:00:00.000Z",
      teacherId: "okafor",
    });
  });

  it("keeps a teacher id containing a separator intact", () => {
    expect(parseSlotSk("SLOT#2026-10-14T17:00:00.000Z#a#b")?.teacherId).toBe("a#b");
  });

  it("returns undefined for anything that is not a slot key", () => {
    for (const sk of ["META", "SLOT#", "SLOT#onlytime", "", "CLAIM#w1#okafor"]) {
      expect(parseSlotSk(sk), sk).toBeUndefined();
    }
  });
});

describe("generateSlots", () => {
  it("produces one slot per teacher per step", () => {
    // Three hours at twenty minutes is nine steps, two teachers each.
    const slots = generateSlots(evening);
    expect(slots).toHaveLength(18);
  });

  it("starts at opensAt and stops before closesAt", () => {
    const slots = generateSlots(evening);
    const times = [...new Set(slots.map((slot) => slot.startsAt))];

    expect(times[0]).toBe("2026-10-14T17:00:00.000Z");

    // The last slot starts at 19:40 and runs to 20:00. A slot starting at
    // 20:00 would end after the teachers have gone home.
    expect(times.at(-1)).toBe("2026-10-14T19:40:00.000Z");
    expect(times).toHaveLength(9);
  });

  it("carries the teacher name, so the parent's list needs no second lookup", () => {
    const slots = generateSlots(evening);
    expect(slots[0]).toEqual({
      sk: "SLOT#2026-10-14T17:00:00.000Z#okafor",
      teacherId: "okafor",
      teacherName: "Ms. Okafor - Mathematics",
      startsAt: "2026-10-14T17:00:00.000Z",
    });
  });

  it("emits UTC keys whatever the local timezone is", () => {
    // toISOString always normalises to Z. A key built from a local-time string
    // would name a different item after the same code ran on a machine in
    // another timezone - or on Lambda, which is always UTC.
    const slots = generateSlots({ ...evening, opensAt: "2026-10-14T13:00:00-04:00" });
    expect(slots[0].startsAt).toBe("2026-10-14T17:00:00.000Z");
  });

  it("drops a trailing partial step rather than creating a short slot", () => {
    const slots = generateSlots({
      ...evening,
      closesAt: "2026-10-14T17:50:00.000Z",
      teachers: [OKAFOR],
    });

    // Fifty minutes holds two whole twenty-minute slots, not two and a half.
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      "2026-10-14T17:00:00.000Z",
      "2026-10-14T17:20:00.000Z",
    ]);
  });

  it("rejects the malformed requests a member of staff can actually send", () => {
    const cases: [string, Partial<typeof evening>][] = [
      ["not an ISO timestamp", { opensAt: "next tuesday" }],
      ["closes before it opens", { closesAt: "2026-10-14T16:00:00.000Z" }],
      ["closes exactly when it opens", { closesAt: evening.opensAt }],
      ["zero length slots", { slotMinutes: 0 }],
      ["fractional slots", { slotMinutes: 7.5 }],
      ["no teachers", { teachers: [] }],
      ["the same teacher twice", { teachers: [OKAFOR, OKAFOR] }],
    ];

    for (const [name, override] of cases) {
      expect(() => generateSlots({ ...evening, ...override }), name).toThrow();
    }
  });

  it("refuses a grid big enough to be a typo", () => {
    // One-minute slots across three hours for two teachers is 360 items. Push
    // it past the guard: a whole day at one minute is 2880 steps.
    expect(() =>
      generateSlots({
        ...evening,
        closesAt: "2026-10-15T17:00:00.000Z",
        slotMinutes: 1,
      }),
    ).toThrow(/2000 slots/);
  });
});
