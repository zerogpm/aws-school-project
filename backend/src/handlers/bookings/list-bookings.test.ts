import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./list-bookings.js");

const STAFF = { sub: "staff-1", email: "office@school.test", "cognito:groups": ["office"] };

const meta = {
  PK: "WINDOW#autumn-2026",
  SK: "META",
  label: "Autumn interviews",
  published: true,
};

const free = {
  PK: "WINDOW#autumn-2026",
  SK: "SLOT#2026-10-14T17:00:00.000Z#okafor",
  teacherId: "okafor",
  teacherName: "Ms. Okafor - Mathematics",
  startsAt: "2026-10-14T17:00:00.000Z",
};

const taken = {
  ...free,
  SK: "SLOT#2026-10-14T17:20:00.000Z#okafor",
  startsAt: "2026-10-14T17:20:00.000Z",
  bookedBy: "S00481",
  bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
  bookedAt: "2026-10-01T09:15:00.000Z",
};

const get = () =>
  apiEvent({
    path: "/windows/autumn-2026/bookings",
    pathParameters: { id: "autumn-2026" },
    claims: STAFF,
  });

/** The same request with no authorizer key at all - a public call to a staff route. */
const getAnonymous = () =>
  apiEvent({
    path: "/windows/autumn-2026/bookings",
    pathParameters: { id: "autumn-2026" },
  });

beforeEach(() => {
  send.mockReset();
});

describe("GET /windows/{id}/bookings", () => {
  it("shows the office who holds each slot", async () => {
    send.mockResolvedValue({ Items: [meta, free, taken] });

    const body = JSON.parse((await handler(get())).body!);
    expect(body.slots[1]).toEqual({
      slotId: "SLOT#2026-10-14T17:20:00.000Z#okafor",
      teacherId: "okafor",
      teacherName: "Ms. Okafor - Mathematics",
      startsAt: "2026-10-14T17:20:00.000Z",
      available: false,
      studentNumber: "S00481",
      bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
      bookedAt: "2026-10-01T09:15:00.000Z",
    });
  });

  it("counts the evening, because the office wants it at a glance", async () => {
    send.mockResolvedValue({ Items: [meta, free, taken] });

    const body = JSON.parse((await handler(get())).body!);
    expect(body).toMatchObject({ total: 2, booked: 1 });
  });

  it("uses nulls rather than absent keys for a free slot", async () => {
    send.mockResolvedValue({ Items: [meta, free] });

    const body = JSON.parse((await handler(get())).body!);
    expect(body.slots[0].studentNumber).toBeNull();
  });

  it("refuses a request with no claims, in the runtime where that is possible", async () => {
    // Deployed the authorizer answers 401 first, so this never runs. Locally
    // there is no authorizer, and without the guard the roster would be open.
    const result = await handler(getAnonymous());

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows an unpublished window, unlike the public route", async () => {
    // Staff draft an evening and check the roster before announcing it.
    send.mockResolvedValue({ Items: [{ ...meta, published: false }, free] });

    const result = await handler(get());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!).published).toBe(false);
  });

  it("reads consistently, so a cancellation is not still showing", async () => {
    send.mockResolvedValue({ Items: [meta] });
    await handler(get());

    expect(send.mock.calls[0][0].input.ConsistentRead).toBe(true);
  });

  it("404s a window that does not exist", async () => {
    send.mockResolvedValue({ Items: [] });
    expect((await handler(get())).statusCode).toBe(404);
  });

  it("404s rather than throwing when the path parameter is absent", async () => {
    const result = await handler(apiEvent({ path: "/windows//bookings", claims: STAFF }));

    expect(result.statusCode).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps CORS headers when the datastore fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      path: "/windows/autumn-2026/bookings",
      pathParameters: { id: "autumn-2026" },
      headers: { origin: "http://localhost:5173" },
      claims: STAFF,
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
