import { describe, expect, it } from "vitest";
import { toPublicSlot, toStaffSlot, type SlotItem } from "./mappers.js";

const free: SlotItem = {
  PK: "WINDOW#autumn-2026",
  SK: "SLOT#2026-10-14T17:00:00.000Z#okafor",
  teacherId: "okafor",
  teacherName: "Ms. Okafor - Mathematics",
  startsAt: "2026-10-14T17:00:00.000Z",
};

const booked: SlotItem = {
  ...free,
  bookedBy: "S00481",
  bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
  bookedAt: "2026-10-01T09:15:00.000Z",
};

describe("toPublicSlot", () => {
  it("reports a free slot as available", () => {
    expect(toPublicSlot(free)).toEqual({
      slotId: "SLOT#2026-10-14T17:00:00.000Z#okafor",
      teacherName: "Ms. Okafor - Mathematics",
      startsAt: "2026-10-14T17:00:00.000Z",
      available: true,
    });
  });

  it("reports a booked slot as unavailable", () => {
    expect(toPublicSlot(booked).available).toBe(false);
  });

  // The load-bearing test in this file.
  //
  // A booked slot carries a student number. The public route returns exactly
  // four keys and this pins them, so a field added to the item later - a parent
  // email, a phone number, a note from the office - fails here rather than
  // appearing in a response any stranger can fetch.
  it("carries no student data, whatever else is on the item", () => {
    const withExtras: SlotItem = {
      ...booked,
      studentName: "Amara Okonkwo",
      parentEmail: "parent@example.com",
      officeNote: "sibling at 5:20",
    };

    expect(Object.keys(toPublicSlot(withExtras)).sort()).toEqual([
      "available",
      "slotId",
      "startsAt",
      "teacherName",
    ]);

    // Belt and braces: assert on the serialised form too, since that is what
    // actually crosses the wire.
    const body = JSON.stringify(toPublicSlot(withExtras));
    for (const secret of ["S00481", "Amara", "parent@example.com", "sibling"]) {
      expect(body, secret).not.toContain(secret);
    }
  });

  it("falls back to the key when the attributes are missing", () => {
    // An item written by an older version, or by hand in the console.
    const bare: SlotItem = { SK: "SLOT#2026-10-14T17:00:00.000Z#okafor" };
    expect(toPublicSlot(bare).startsAt).toBe("2026-10-14T17:00:00.000Z");
  });
});

describe("toStaffSlot", () => {
  it("adds who holds the slot", () => {
    expect(toStaffSlot(booked)).toEqual({
      slotId: "SLOT#2026-10-14T17:00:00.000Z#okafor",
      teacherName: "Ms. Okafor - Mathematics",
      teacherId: "okafor",
      startsAt: "2026-10-14T17:00:00.000Z",
      available: false,
      studentNumber: "S00481",
      bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
      bookedAt: "2026-10-01T09:15:00.000Z",
    });
  });

  it("uses null rather than absent for a free slot, so every row has one shape", () => {
    const slot = toStaffSlot(free);
    expect(slot.studentNumber).toBeNull();
    expect(slot.bookingRef).toBeNull();
    expect(slot.bookedAt).toBeNull();
    expect(slot.available).toBe(true);
  });

  it("is a superset of the public shape", () => {
    // The staff view must never lose a field the parent view has.
    for (const key of Object.keys(toPublicSlot(booked))) {
      expect(toStaffSlot(booked)).toHaveProperty(key);
    }
  });
});
