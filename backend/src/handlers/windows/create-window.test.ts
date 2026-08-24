import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./create-window.js");

const OFFICE = { sub: "staff-1", email: "office@school.test", "cognito:groups": ["office"] };
const TEACHER_ONLY = { sub: "staff-2", email: "teacher@school.test", "cognito:groups": ["teachers"] };

const request = (over: Record<string, unknown> = {}) => ({
  id: "autumn-2026",
  label: "Autumn interviews",
  opensAt: "2026-10-14T17:00:00.000Z",
  closesAt: "2026-10-14T20:00:00.000Z",
  slotMinutes: 20,
  teachers: [
    { id: "okafor", name: "Ms. Okafor - Mathematics" },
    { id: "levesque", name: "Mr. Levesque - Science" },
  ],
  ...over,
});

const post = (over: Record<string, unknown> = {}, claims: Record<string, unknown> = OFFICE) =>
  apiEvent({
    method: "POST",
    path: "/windows",
    body: JSON.stringify(request(over)),
    claims: claims as never,
  });

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
});

describe("POST /windows", () => {
  it("creates the window and its whole grid", async () => {
    const result = await handler(post());

    expect(result.statusCode).toBe(201);
    // Three hours at twenty minutes is nine steps, two teachers each.
    expect(JSON.parse(result.body!)).toMatchObject({
      windowId: "autumn-2026",
      teachers: 2,
      slots: 18,
    });
  });

  it("writes the META item conditionally, so reopening cannot wipe bookings", async () => {
    await handler(post());

    const meta = send.mock.calls[0][0].input;
    expect(meta.Item).toMatchObject({
      PK: "WINDOW#autumn-2026",
      SK: "META",
      GSI1PK: "WINDOWS",
      GSI1SK: "2026-10-14T17:00:00.000Z",
    });
    expect(meta.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("is unpublished unless asked, so an evening is not announced by accident", async () => {
    await handler(post());
    expect(send.mock.calls[0][0].input.Item.published).toBe(false);

    send.mockClear();
    await handler(post({ published: true }));
    expect(send.mock.calls[0][0].input.Item.published).toBe(true);
  });

  it("batches the slots in 25s, which is DynamoDB's limit and not a choice", async () => {
    await handler(post());

    // One Put for META, then 18 slots in a single batch.
    const batches = send.mock.calls.slice(1);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].input.RequestItems["local-school"]).toHaveLength(18);

    const first = batches[0][0].input.RequestItems["local-school"][0].PutRequest.Item;
    expect(first).toMatchObject({
      PK: "WINDOW#autumn-2026",
      SK: "SLOT#2026-10-14T17:00:00.000Z#okafor",
      teacherName: "Ms. Okafor - Mathematics",
    });
    // No bookedBy: its absence is what "free" means.
    expect(first).not.toHaveProperty("bookedBy");
  });

  it("splits a grid larger than one batch", async () => {
    // Ten teachers over three hours is 90 slots: four batches.
    const teachers = Array.from({ length: 10 }, (_, index) => ({
      id: `t${index}`,
      name: `Teacher ${index}`,
    }));

    await handler(post({ teachers }));

    const batches = send.mock.calls.slice(1);
    expect(batches).toHaveLength(4);
    expect(batches.at(-1)![0].input.RequestItems["local-school"]).toHaveLength(90 - 75);
  });

  it("retries whatever DynamoDB hands back unprocessed", async () => {
    const unprocessed = [{ PutRequest: { Item: { PK: "WINDOW#autumn-2026", SK: "SLOT#x#y" } } }];

    send
      .mockResolvedValueOnce({}) // the META put
      .mockResolvedValueOnce({ UnprocessedItems: { "local-school": unprocessed } })
      .mockResolvedValueOnce({});

    const result = await handler(post());

    // Dropping unprocessed items is how a window quietly loses a teacher's
    // five o'clock, so the retry is not optional.
    expect(result.statusCode).toBe(201);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("fails loudly when items stay unprocessed", async () => {
    const unprocessed = [{ PutRequest: { Item: { PK: "WINDOW#autumn-2026", SK: "SLOT#x#y" } } }];

    send.mockResolvedValueOnce({}).mockResolvedValue({
      UnprocessedItems: { "local-school": unprocessed },
    });

    expect((await handler(post())).statusCode).toBe(500);
  });

  it("refuses a signed-in teacher who is not office staff", async () => {
    // The first route to use isOffice. The authorizer cannot check an
    // arbitrary claim, so this check has to live here.
    const result = await handler(post({}, TEACHER_ONLY));

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a request with no claims at all", async () => {
    const result = await handler(
      apiEvent({ method: "POST", path: "/windows", body: JSON.stringify(request()) }),
    );

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("409s a window that already exists", async () => {
    send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({ message: "exists", $metadata: {} }),
    );

    const result = await handler(post());
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body!).error).toMatch(/already exists/);
  });

  it("passes the grid errors through as 400s a human can act on", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["closes before it opens", { closesAt: "2026-10-14T16:00:00.000Z" }],
      ["not a timestamp", { opensAt: "next tuesday" }],
      ["zero-length slots", { slotMinutes: 0 }],
      ["no teachers", { teachers: [] }],
      ["duplicate teacher", { teachers: [{ id: "a", name: "A" }, { id: "a", name: "A" }] }],
    ];

    for (const [name, over] of cases) {
      send.mockClear();
      const result = await handler(post(over));
      expect(result.statusCode, name).toBe(400);
      expect(send, name).not.toHaveBeenCalled();
    }
  });

  it("rejects an id that would need escaping in a key or a URL", async () => {
    for (const id of ["Autumn 2026", "autumn/2026", "WINDOW#x", ""]) {
      send.mockClear();
      expect((await handler(post({ id }))).statusCode, id).toBe(400);
    }
  });

  it("rejects a malformed teachers list", async () => {
    for (const teachers of [undefined, "okafor", [{ id: "okafor" }], [null], [{ name: "x" }]]) {
      send.mockClear();
      expect((await handler(post({ teachers }))).statusCode).toBe(400);
    }
  });

  it("rejects an absent body", async () => {
    const result = await handler(apiEvent({ method: "POST", path: "/windows", claims: OFFICE }));

    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps CORS headers when the datastore fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      method: "POST",
      path: "/windows",
      body: JSON.stringify(request()),
      headers: { origin: "http://localhost:5173" },
      claims: OFFICE,
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
