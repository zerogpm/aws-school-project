// The instant a slot is stored as, turned into a sentence a parent can act on.
//
// Pure - no clock, no environment, no stream. The suite runs with TZ=UTC (see
// vitest.config.ts) so a machine already set to Toronto cannot make these pass
// for the wrong reason.
import { describe, expect, it } from "vitest";

import { formatSlotTime } from "./format.js";

describe("formatSlotTime", () => {
  it("reads an evening slot back as the local time a parent should arrive", () => {
    // The exact instant from a real cancellation email, which is what started
    // this: the message quoted the stored value and asked the reader to do the
    // timezone arithmetic themselves.
    expect(formatSlotTime("2026-10-14T21:40:00.000Z")).toBe(
      "Wednesday, October 14, 2026 at 5:40 p.m. EDT",
    );
  });

  it("follows the school across the DST boundary rather than a fixed offset", () => {
    // Same wall-clock UTC instant, three months earlier: -4 becomes -5 and the
    // abbreviation says so. A hardcoded "EDT" or a stored offset would put a
    // January interview an hour late.
    expect(formatSlotTime("2026-01-14T21:40:00.000Z")).toBe(
      "Wednesday, January 14, 2026 at 4:40 p.m. EST",
    );
  });

  it("converts the date, not only the clock", () => {
    // 02:00 UTC on the 15th is 22:00 on the 14th in Toronto. The interview is
    // on Wednesday evening, and telling a parent Thursday would send them to an
    // empty school.
    expect(formatSlotTime("2026-10-15T02:00:00.000Z")).toBe(
      "Wednesday, October 14, 2026 at 10:00 p.m. EDT",
    );
  });

  it("hands back anything it cannot parse instead of saying 'Invalid Date'", () => {
    // A booking written by something that got the field wrong is still a
    // booking. The raw value at least carries the facts; "Invalid Date" in a
    // message to a parent carries nothing and looks like the site is broken.
    expect(formatSlotTime("not a date")).toBe("not a date");
    expect(formatSlotTime("")).toBe("");
  });
});
