import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./cancel-booking.js");

const REF = "3f1c8a2e-0000-4000-8000-000000000000";
const SLOT = "SLOT#2026-10-14T17:00:00.000Z#okafor";

const booking = {
  PK: `BOOKING#${REF}`,
  SK: "META",
  bookingRef: REF,
  windowId: "autumn-2026",
  slotId: SLOT,
  teacherId: "okafor",
  startsAt: "2026-10-14T17:00:00.000Z",
  studentNumber: "S00481",
};

const del = (studentNumber: unknown = "S00481", ref = REF) =>
  apiEvent({
    method: "DELETE",
    path: `/bookings/${ref}`,
    pathParameters: { ref },
    body: JSON.stringify({ studentNumber }),
  });

beforeEach(() => {
  send.mockReset();
});

describe("DELETE /bookings/{ref}", () => {
  it("frees the slot and releases the family's claim", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({});

    const result = await handler(del());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toMatchObject({ bookingRef: REF, cancelled: true });

    const items = send.mock.calls[1][0].input.TransactItems;
    expect(items).toHaveLength(4);

    // Free the slot, but only if this booking still holds it.
    expect(items[0].Update).toMatchObject({
      Key: { PK: "WINDOW#autumn-2026", SK: SLOT },
      ConditionExpression: "bookingRef = :ref",
      UpdateExpression: "REMOVE bookedBy, bookingRef, bookedAt",
    });

    // Release the one-per-teacher guard, so the family can rebook.
    expect(items[1].Delete.Key).toEqual({
      PK: "STUDENT#S00481",
      SK: "CLAIM#autumn-2026#okafor",
    });

    // Release the one-per-time guard too. Missed, and the slot frees while the
    // family stays blocked from ever using that hour again.
    expect(items[2].Delete.Key).toEqual({
      PK: "STUDENT#S00481",
      SK: "TIME#autumn-2026#2026-10-14T17:00:00.000Z",
    });

    // And kill the reference.
    expect(items[3].Delete.Key).toEqual({ PK: `BOOKING#${REF}`, SK: "META" });
  });

  it("requires the student number as well as the reference", async () => {
    // A reference forwarded in an email is not on its own enough to cancel
    // somebody else's interview.
    send.mockResolvedValueOnce({ Item: booking });

    const result = await handler(del("S00999"));
    expect(result.statusCode).toBe(403);
    // Read only; nothing was written.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("accepts the student number however the parent typed it", async () => {
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({});

    expect((await handler(del(" s00481 "))).statusCode).toBe(200);
  });

  it("reads the booking consistently", async () => {
    // A parent cancelling seconds after booking must not be told their own
    // booking does not exist.
    send.mockResolvedValueOnce({ Item: booking }).mockResolvedValueOnce({});
    await handler(del());

    expect(send.mock.calls[0][0].input.ConsistentRead).toBe(true);
  });

  it("404s an unknown reference", async () => {
    send.mockResolvedValueOnce({});

    const result = await handler(del());
    expect(result.statusCode).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("treats an already-cancelled booking as gone rather than as an error", async () => {
    // Two taps on a slow phone. The caller wanted it gone, and it is gone.
    send.mockResolvedValueOnce({ Item: booking }).mockRejectedValueOnce(
      new TransactionCanceledException({
        message: "Transaction cancelled",
        $metadata: {},
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    );

    expect((await handler(del())).statusCode).toBe(404);
  });

  it("rejects a malformed student number before reading anything", async () => {
    const result = await handler(del("00481"));

    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an absent body", async () => {
    const result = await handler(
      apiEvent({ method: "DELETE", path: `/bookings/${REF}`, pathParameters: { ref: REF } }),
    );

    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("404s rather than throwing when the path parameter is absent", async () => {
    const result = await handler(
      apiEvent({ method: "DELETE", path: "/bookings/", body: JSON.stringify({ studentNumber: "S00481" }) }),
    );

    expect(result.statusCode).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to guess when a booking cannot name its slot", async () => {
    // Nothing writes such an item, so this is corruption - and a partial
    // cancellation would be worse than a loud failure.
    send.mockResolvedValueOnce({ Item: { ...booking, slotId: undefined } });

    const result = await handler(del());
    expect(result.statusCode).toBe(500);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps CORS headers when the datastore fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      method: "DELETE",
      path: `/bookings/${REF}`,
      pathParameters: { ref: REF },
      body: JSON.stringify({ studentNumber: "S00481" }),
      headers: { origin: "http://localhost:5173" },
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
