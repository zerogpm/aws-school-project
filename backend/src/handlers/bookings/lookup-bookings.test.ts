import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./lookup-bookings.js");

const REF = "3f1c8a2e-0000-4000-8000-000000000000";
const OTHER_REF = "9a2b1c3d-0000-4000-9000-000000000001";

const booking = {
  PK: `BOOKING#${REF}`,
  SK: "META",
  bookingRef: REF,
  windowId: "autumn-2026",
  studentNumber: "S00481",
};

const slot = (ref: string, time: string, teacher: string) => ({
  PK: "WINDOW#autumn-2026",
  SK: `SLOT#${time}#${teacher}`,
  teacherName: `${teacher} name`,
  startsAt: time,
  bookedBy: "S00481",
  bookingRef: ref,
});

const post = (body: Record<string, unknown> = { bookingRef: REF, studentNumber: "S00481" }) =>
  apiEvent({ method: "POST", path: "/bookings/lookup", body: JSON.stringify(body) });

beforeEach(() => {
  send.mockReset();
});

describe("POST /bookings/lookup", () => {
  it("returns the family's whole evening, earliest first", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({
      Items: [
        slot(OTHER_REF, "2026-10-14T21:40:00.000Z", "levesque"),
        slot(REF, "2026-10-14T21:00:00.000Z", "okafor"),
      ],
    });

    const result = await handler(post());
    const body = JSON.parse(result.body!);

    expect(result.statusCode).toBe(200);
    expect(body.bookings.map((b: { bookingRef: string }) => b.bookingRef)).toEqual([
      REF,
      OTHER_REF,
    ]);
  });

  it("answers with no authorizer, because parents have no account", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({ Items: [] });
    expect((await handler(post())).statusCode).toBe(200);
  });

  it("requires the student number as well as the reference", async () => {
    // The reference alone is what makes this safe to answer at all - but a
    // leaked one must not be enough on its own.
    send.mockResolvedValueOnce({ Item: booking });

    const result = await handler(post({ bookingRef: REF, studentNumber: "S00999" }));

    expect(result.statusCode).toBe(403);
    // Read only; the family's evening was never queried.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses a student number with no reference, which is the guessing attack", async () => {
    // A student number is on every report card and is S plus five digits. If
    // that alone opened this route, anyone could read a family's evening.
    const result = await handler(post({ studentNumber: "S00481" }));

    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a malformed reference before touching the table", async () => {
    for (const bookingRef of ["not-a-uuid", "", "3f1c8a2e-0000-1000-8000-000000000000"]) {
      send.mockClear();
      const result = await handler(post({ bookingRef, studentNumber: "S00481" }));
      expect(result.statusCode, bookingRef).toBe(400);
      expect(send, bookingRef).not.toHaveBeenCalled();
    }
  });

  it("filters the window to this family only", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({ Items: [] });
    await handler(post());

    const query = send.mock.calls[1][0].input;
    expect(query.FilterExpression).toBe("bookedBy = :student");
    expect(query.ExpressionAttributeValues[":student"]).toBe("S00481");
    expect(query.ConsistentRead).toBe(true);
  });

  it("404s an unknown reference", async () => {
    send.mockResolvedValueOnce({});
    expect((await handler(post())).statusCode).toBe(404);
  });

  it("omits a slot whose reference went missing rather than offering a dead button", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({
      Items: [
        slot(REF, "2026-10-14T21:00:00.000Z", "okafor"),
        { ...slot("", "2026-10-14T21:20:00.000Z", "whitfield"), bookingRef: undefined },
      ],
    });

    const { bookings } = JSON.parse((await handler(post())).body!);
    expect(bookings).toHaveLength(1);
  });

  it("rejects an absent body", async () => {
    const result = await handler(apiEvent({ method: "POST", path: "/bookings/lookup" }));

    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps CORS headers when the datastore fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      method: "POST",
      path: "/bookings/lookup",
      body: JSON.stringify({ bookingRef: REF, studentNumber: "S00481" }),
      headers: { origin: "http://localhost:5173" },
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
