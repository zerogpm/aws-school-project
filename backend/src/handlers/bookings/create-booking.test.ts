import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionCanceledException, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { apiEvent } from "../test-event.js";

// vi.hoisted, because vi.mock is lifted above the imports and a plain const
// declared here would be in its temporal dead zone inside the factory.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./create-booking.js");

const SLOT = "SLOT#2026-10-14T17:00:00.000Z#okafor";

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    studentNumber: "S00481",
    windowId: "autumn-2026",
    slotId: SLOT,
    ...over,
  });

const post = (over: Record<string, unknown> = {}) =>
  apiEvent({ method: "POST", path: "/bookings", body: body(over) });

/**
 * A cancelled transaction with ConditionalCheckFailed at one index.
 *
 * The array is positional and parallel to TransactItems - that correspondence
 * is the only thing that tells the handler which condition failed, so the tests
 * build it the same way DynamoDB does.
 *
 * `item` is typed as raw AttributeValue rather than a plain object, because
 * that is what the service actually returns here: CancellationReasons is not
 * unmarshalled by the document client. Which is exactly why the handler tests
 * this field for presence and never reads an attribute out of it.
 */
const cancelledAt = (index: number, item?: Record<string, AttributeValue>) =>
  new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: [0, 1, 2, 3, 4].map((position) =>
      position === index ? { Code: "ConditionalCheckFailed", Item: item } : { Code: "None" },
    ),
  });

// A block body, not `() => send.mockReset()`. mockReset returns the mock, and
// vitest treats a function returned from beforeEach as that hook's teardown -
// so the concise form makes vitest call send() itself after every test.
beforeEach(() => {
  send.mockReset();
});

describe("POST /bookings", () => {
  it("confirms a booking with a reference the parent can cancel with", async () => {
    send.mockResolvedValue({});

    const result = await handler(post());
    const payload = JSON.parse(result.body!);

    expect(result.statusCode).toBe(201);
    expect(payload).toMatchObject({
      windowId: "autumn-2026",
      slotId: SLOT,
      startsAt: "2026-10-14T17:00:00.000Z",
      teacherId: "okafor",
      studentNumber: "S00481",
    });
    // A v4 uuid, which is what makes it unguessable enough to authorise a
    // cancellation on its own.
    expect(payload.bookingRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sends one transaction carrying all four guarantees", async () => {
    send.mockResolvedValue({});
    await handler(post());

    const items = send.mock.calls[0][0].input.TransactItems;
    expect(items).toHaveLength(5);

    // [0] the student is real
    expect(items[0].ConditionCheck).toMatchObject({
      Key: { PK: "STUDENT#S00481", SK: "PROFILE" },
      ConditionExpression: "attribute_exists(PK)",
    });

    // [1] the slot is free - the line the whole episode rests on
    expect(items[1].Update.Key).toEqual({ PK: "WINDOW#autumn-2026", SK: SLOT });
    expect(items[1].Update.ConditionExpression).toContain("attribute_not_exists(bookedBy)");

    // [2] one slot per teacher per family
    expect(items[2].Put).toMatchObject({
      Item: { PK: "STUDENT#S00481", SK: "CLAIM#autumn-2026#okafor" },
      ConditionExpression: "attribute_not_exists(SK)",
    });

    // [3] not already somewhere else at this exact time
    expect(items[3].Put).toMatchObject({
      Item: { PK: "STUDENT#S00481", SK: "TIME#autumn-2026#2026-10-14T17:00:00.000Z" },
      ConditionExpression: "attribute_not_exists(SK)",
    });

    // [4] the booking itself, findable by reference
    expect(items[4].Put.Item.PK).toMatch(/^BOOKING#/);
  });

  it("accepts a booking with no email at all, since it is optional", async () => {
    send.mockResolvedValue({});
    expect((await handler(post())).statusCode).toBe(201);
  });

  it("accepts a well-formed email", async () => {
    send.mockResolvedValue({});
    expect((await handler(post({ parentEmail: "sarah@example.com" }))).statusCode).toBe(201);
  });

  it("normalises the student number, so one family is one partition", async () => {
    send.mockResolvedValue({});
    await handler(post({ studentNumber: " s00481 " }));

    const items = send.mock.calls[0][0].input.TransactItems;
    expect(items[0].ConditionCheck.Key.PK).toBe("STUDENT#S00481");
    expect(items[2].Put.Item.PK).toBe("STUDENT#S00481");
  });

  describe("when the transaction is cancelled", () => {
    it("says the student number is wrong rather than blaming the slot", async () => {
      // The failure a mistyped number produces. Reporting this as 409 "taken"
      // sends a parent hunting for another time that will fail the same way.
      send.mockRejectedValue(cancelledAt(0));

      const result = await handler(post());
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body!).error).toMatch(/No student with that number/);
    });

    it("reports a lost race as a conflict", async () => {
      // Item present: the slot exists and somebody else holds it.
      send.mockRejectedValue(
        cancelledAt(1, { PK: { S: "WINDOW#autumn-2026" }, bookedBy: { S: "S00999" } }),
      );

      const result = await handler(post());
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body!).error).toMatch(/just taken/);
    });

    it("distinguishes a slot that never existed from one that was taken", async () => {
      // No Item: the condition failed on attribute_exists(SK). A stale link,
      // not a race - and 409 would be a lie.
      send.mockRejectedValue(cancelledAt(1));

      const result = await handler(post());
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body!).error).toMatch(/No such slot/);
    });

    it("enforces one slot per teacher per family", async () => {
      send.mockRejectedValue(cancelledAt(2));

      const result = await handler(post());
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body!).error).toMatch(/already have a slot with this teacher/);
    });

    it("refuses a second interview at the same time with a different teacher", async () => {
      // The likeliest way a parent gets this wrong: working down the list,
      // booking each teacher in turn, and taking 5:00 twice without noticing.
      send.mockRejectedValue(cancelledAt(3));

      const result = await handler(post());
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body!).error).toMatch(/already have an interview at that time/);
    });

    it("does not leak a uuid collision to the caller as a conflict", async () => {
      send.mockRejectedValue(cancelledAt(4));

      const result = await handler(post());
      expect(result.statusCode).toBe(500);
    });

    it("falls back to a retryable conflict when the reason is not one of ours", async () => {
      // Throughput, or another transaction touching the same item.
      send.mockRejectedValue(
        new TransactionCanceledException({
          message: "Transaction cancelled",
          $metadata: {},
          CancellationReasons: [
            { Code: "TransactionConflict" },
            { Code: "None" },
            { Code: "None" },
            { Code: "None" },
            { Code: "None" },
          ],
        }),
      );

      const result = await handler(post());
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body!).error).toMatch(/try again/);
    });
  });

  describe("rejects before touching the table", () => {
    it("a malformed student number", async () => {
      const result = await handler(post({ studentNumber: "00481" }));

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).error).toMatch(/format S00481/);
      expect(send).not.toHaveBeenCalled();
    });

    it("an absent body, which is what AWS sends for a bodyless POST", async () => {
      const result = await handler(apiEvent({ method: "POST", path: "/bookings" }));

      expect(result.statusCode).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });

    it("a malformed body, which parseBody reports the same as absent", async () => {
      const result = await handler(apiEvent({ method: "POST", path: "/bookings", body: "{" }));

      expect(result.statusCode).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });

    it("a slotId that is not a slot key", async () => {
      const result = await handler(post({ slotId: "META" }));

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).error).toMatch(/not a valid slot/);
      expect(send).not.toHaveBeenCalled();
    });

    it("a missing windowId", async () => {
      const result = await handler(post({ windowId: "" }));

      expect(result.statusCode).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });

    it("an email address that would bounce when episode 05 mails it", async () => {
      const result = await handler(post({ parentEmail: "sarah at example.com" }));

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).error).toMatch(/email address/i);
      expect(send).not.toHaveBeenCalled();
    });

    it("a student number of the wrong type entirely", async () => {
      // The body comes from JSON.parse of input a stranger controls.
      const result = await handler(post({ studentNumber: { $gt: "" } }));

      expect(result.statusCode).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it("keeps CORS headers when the datastore fails", async () => {
    // Without them a 500 reaches the browser as an opaque network error and
    // the debugging goes into the wrong layer.
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      method: "POST",
      path: "/bookings",
      body: body(),
      headers: { origin: "http://localhost:5173" },
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
