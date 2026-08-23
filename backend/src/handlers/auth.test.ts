import { describe, expect, it } from "vitest";
import { getClaims, getGroups, getStaffEmail, getStaffId, isOffice, isStaff } from "./auth.js";
import { apiEvent } from "./test-event.js";

const staff = { sub: "u-1", email: "Hart@school.example", "cognito:groups": ["office"] };

describe("without an authorizer", () => {
  // A public route has no authorizer key at all. Every one of these is a shape
  // the deployed runtime really produces, and a handler that reads
  // `authorizer.jwt` unguarded fails only there.
  const event = apiEvent();

  it("has no claims", () => expect(getClaims(event)).toEqual({}));
  it("has no id", () => expect(getStaffId(event)).toBe(""));
  it("has no email", () => expect(getStaffEmail(event)).toBe(""));
  it("has no groups", () => expect(getGroups(event)).toEqual([]));
  it("is not staff", () => expect(isStaff(event)).toBe(false));
  it("is not office", () => expect(isOffice(event)).toBe(false));
});

describe("with a verified token", () => {
  const event = apiEvent({ claims: staff });

  it("reads the sub, which survives an email change", () => {
    expect(getStaffId(event)).toBe("u-1");
  });

  it("lowercases the email, because phones capitalise addresses", () => {
    expect(getStaffEmail(event)).toBe("hart@school.example");
  });

  it("recognises the office group", () => {
    expect(isOffice(event)).toBe(true);
  });
});

describe("getGroups", () => {
  it("accepts the array form", () => {
    expect(getGroups(apiEvent({ claims: { "cognito:groups": ["office", "teachers"] } }))).toEqual([
      "office",
      "teachers",
    ]);
  });

  it("accepts the bracketed string form an HTTP API authorizer may send", () => {
    // Not a hypothetical worth guessing at: handling both shapes costs four
    // lines, and getting it wrong is an authorisation bug that exists only
    // deployed. The real wire format goes in MISTAKES.md once observed.
    expect(getGroups(apiEvent({ claims: { "cognito:groups": "[office teachers]" } }))).toEqual([
      "office",
      "teachers",
    ]);
  });

  it("returns empty for a member of no group, not undefined", () => {
    expect(getGroups(apiEvent({ claims: { sub: "u-2" } }))).toEqual([]);
  });
});
