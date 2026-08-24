import { describe, expect, it } from "vitest";
import { isValidStudentNumber, normaliseStudentNumber } from "./student-number.js";

describe("isValidStudentNumber", () => {
  it("accepts the format printed on a report card", () => {
    expect(isValidStudentNumber("S00481")).toBe(true);
  });

  it("accepts what a parent actually types on a phone", () => {
    // Lower case and a trailing space are typos, not different students.
    expect(isValidStudentNumber("s00481")).toBe(true);
    expect(isValidStudentNumber(" S00481 ")).toBe(true);
  });

  it("rejects the near misses", () => {
    for (const value of ["S0048", "S004811", "00481", "SO0481", "S 00481", ""]) {
      expect(isValidStudentNumber(value), value).toBe(false);
    }
  });

  it("rejects a non-string rather than throwing", () => {
    // The value arrives from JSON.parse of a body a stranger controls, so it
    // can be any type at all. A throw here would be a 500 on a bad request.
    for (const value of [undefined, null, 481, {}, ["S00481"]]) {
      expect(isValidStudentNumber(value)).toBe(false);
    }
  });

  it("is anchored, so a number buried in other text does not pass", () => {
    expect(isValidStudentNumber("xS00481")).toBe(false);
    expect(isValidStudentNumber("S00481x")).toBe(false);
    expect(isValidStudentNumber("S00481\nS00482")).toBe(false);
  });
});

describe("normaliseStudentNumber", () => {
  it("produces one canonical form, because this ends up in a partition key", () => {
    // STUDENT#s00481 and STUDENT#S00481 would be two partitions, and the
    // family could then book the same teacher twice.
    expect(normaliseStudentNumber(" s00481 ")).toBe("S00481");
    expect(normaliseStudentNumber("S00481")).toBe("S00481");
  });
});
