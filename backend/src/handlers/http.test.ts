import { describe, expect, it } from "vitest";
import {
  badRequest,
  buildCorsHeaders,
  conflict,
  created,
  getHeader,
  json,
  notFound,
  ok,
  parseBody,
  serverError,
} from "./http.js";
import { apiEvent } from "./test-event.js";

// ALLOWED_ORIGINS during the suite is set by vitest.config.ts, matching what
// modules/booking/lambda.tf passes to the deployed functions.
const ALLOWED = "http://localhost:5173";

describe("getHeader", () => {
  it("finds a header whatever case it arrives in", () => {
    // v2 lowercases header names and Express lowercases them too, but "in
    // practice" is not a contract, and a lookup that misses returns undefined
    // rather than failing - which reads as the browser's fault.
    const event = apiEvent({ headers: { Origin: ALLOWED } });
    expect(getHeader(event, "origin")).toBe(ALLOWED);
    expect(getHeader(event, "ORIGIN")).toBe(ALLOWED);
  });

  it("returns undefined rather than throwing when there are no headers", () => {
    expect(getHeader(apiEvent(), "origin")).toBeUndefined();
  });
});

describe("buildCorsHeaders", () => {
  it("echoes an allowed origin and varies on it", () => {
    const headers = buildCorsHeaders(apiEvent({ headers: { origin: ALLOWED } }));
    expect(headers["Access-Control-Allow-Origin"]).toBe(ALLOWED);
    expect(headers.Vary).toBe("Origin");
  });

  it("omits the allow header for an origin that is not on the list", () => {
    // No wildcard fallback. The browser blocks it, which is correct.
    const headers = buildCorsHeaders(apiEvent({ headers: { origin: "https://evil.example" } }));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("always declares JSON, so res.send() locally does not say text/html", () => {
    expect(buildCorsHeaders(apiEvent())["Content-Type"]).toBe("application/json");
  });
});

describe("responses", () => {
  it("returns the body as a string, never an object", () => {
    // Returning an object silently produces "[object Object]" on AWS.
    const result = ok(apiEvent(), { windows: [] });
    expect(typeof result.body).toBe("string");
    expect(JSON.parse(result.body!)).toEqual({ windows: [] });
  });

  it("carries CORS headers on the error paths too", () => {
    // A 500 without them reaches the browser as an opaque network error rather
    // than as a 500, and the debugging goes into the wrong layer for hours.
    const event = apiEvent({ headers: { origin: ALLOWED } });
    for (const result of [badRequest(event, "nope"), serverError(event)]) {
      expect(result.headers?.["Access-Control-Allow-Origin"]).toBe(ALLOWED);
    }
  });

  it("says nothing useful in a 500, because the detail belongs in the log", () => {
    expect(JSON.parse(serverError(apiEvent()).body!)).toEqual({ error: "Internal error" });
  });

  it("passes the status through", () => {
    expect(json(apiEvent(), 418, {}).statusCode).toBe(418);
  });

  it("distinguishes the booking outcomes a parent has to act on differently", () => {
    // 201 confirmed, 404 the student number is wrong, 409 someone was faster.
    // Collapsing these into one status is what makes a booking failure
    // unactionable - the parent cannot tell a typo from a lost race.
    const event = apiEvent();
    expect(created(event, { ref: "abc" }).statusCode).toBe(201);
    expect(notFound(event).statusCode).toBe(404);
    expect(conflict(event, "That time was just taken").statusCode).toBe(409);
  });

  it("says why in a 409, because 'conflict' is not something a parent can act on", () => {
    const result = conflict(apiEvent(), "You already have a slot with this teacher");
    expect(JSON.parse(result.body!)).toEqual({
      error: "You already have a slot with this teacher",
    });
  });

  it("carries CORS headers on the new statuses too", () => {
    const event = apiEvent({ headers: { origin: ALLOWED } });
    for (const result of [created(event, {}), notFound(event), conflict(event, "taken")]) {
      expect(result.headers?.["Access-Control-Allow-Origin"]).toBe(ALLOWED);
    }
  });
});

describe("parseBody", () => {
  it("returns undefined for an absent body, which is what AWS sends", () => {
    expect(parseBody(apiEvent())).toBeUndefined();
  });

  it("returns undefined for a malformed body instead of throwing", () => {
    expect(parseBody(apiEvent({ body: "{not json" }))).toBeUndefined();
  });

  it("parses a well-formed body", () => {
    expect(parseBody(apiEvent({ body: JSON.stringify({ a: 1 }) }))).toEqual({ a: 1 });
  });
});
