import { describe, expect, it } from "vitest";
import { isValidStudentNumber } from "./data";

describe("isValidStudentNumber", () => {
  it("accepts S followed by exactly five digits", () => {
    expect(isValidStudentNumber("S00481")).toBe(true);
    expect(isValidStudentNumber("S12345")).toBe(true);
  });

  it("accepts lowercase and surrounding whitespace", () => {
    expect(isValidStudentNumber("s00481")).toBe(true);
    expect(isValidStudentNumber("  S00481  ")).toBe(true);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidStudentNumber("S0048")).toBe(false);
    expect(isValidStudentNumber("S004811")).toBe(false);
  });

  it("rejects a missing or wrong prefix", () => {
    expect(isValidStudentNumber("00481")).toBe(false);
    expect(isValidStudentNumber("A00481")).toBe(false);
  });

  it("rejects empty and non-numeric input", () => {
    expect(isValidStudentNumber("")).toBe(false);
    expect(isValidStudentNumber("SABCDE")).toBe(false);
  });

  it("rejects anything with extra characters around a valid number", () => {
    // Guards against a regex without anchors, which would let an injected
    // payload through while still looking correct in a happy-path test.
    expect(isValidStudentNumber("S00481; DROP")).toBe(false);
    expect(isValidStudentNumber("xxS00481xx")).toBe(false);
  });
});
