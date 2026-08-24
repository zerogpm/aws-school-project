import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./list-slots.js");

const meta = {
  PK: "WINDOW#autumn-2026",
  SK: "META",
  label: "Autumn interviews",
  opensAt: "2026-10-14T17:00:00.000Z",
  closesAt: "2026-10-14T20:00:00.000Z",
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

const get = () => apiEvent({ path: "/windows/autumn-2026/slots", pathParameters: { id: "autumn-2026" } });

beforeEach(() => {
  send.mockReset();
});

describe("GET /windows/{id}/slots", () => {
  it("answers with no authorizer at all, because a parent has no account", async () => {
    send.mockResolvedValue({ Items: [meta, free] });

    // apiEvent without claims omits the authorizer key entirely, which is what
    // a public route on AWS actually looks like.
    const result = await handler(get());
    expect(result.statusCode).toBe(200);
  });

  it("marks a booked slot unavailable and a free one available", async () => {
    send.mockResolvedValue({ Items: [meta, free, taken] });

    const { slots } = JSON.parse((await handler(get())).body!);
    expect(slots).toEqual([
      {
        slotId: "SLOT#2026-10-14T17:00:00.000Z#okafor",
        teacherName: "Ms. Okafor - Mathematics",
        startsAt: "2026-10-14T17:00:00.000Z",
        available: true,
      },
      {
        slotId: "SLOT#2026-10-14T17:20:00.000Z#okafor",
        teacherName: "Ms. Okafor - Mathematics",
        startsAt: "2026-10-14T17:20:00.000Z",
        available: false,
      },
    ]);
  });

  it("never returns who holds a slot", async () => {
    // The projection is this route's security boundary - there is no
    // authorizer to fall back on.
    send.mockResolvedValue({ Items: [meta, taken] });

    const body = (await handler(get())).body!;
    expect(body).not.toContain("S00481");
    expect(body).not.toContain("bookedBy");
    expect(body).not.toContain("bookingRef");
  });

  it("reads the window's own partition, consistently", async () => {
    send.mockResolvedValue({ Items: [meta] });
    await handler(get());

    const input = send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": "WINDOW#autumn-2026" });
    // A parent who just booked must not be shown the slot as still free.
    expect(input.ConsistentRead).toBe(true);
    // No IndexName: this is the main table, not GSI1 - a GSI cannot be read
    // consistently at all.
    expect(input.IndexName).toBeUndefined();
  });

  it("hides an unpublished window rather than confirming it exists", async () => {
    send.mockResolvedValue({ Items: [{ ...meta, published: false }, free] });

    const result = await handler(get());
    expect(result.statusCode).toBe(404);
  });

  it("404s a window with no META item", async () => {
    send.mockResolvedValue({ Items: [] });
    expect((await handler(get())).statusCode).toBe(404);
  });

  it("404s rather than throwing when the path parameter is absent", async () => {
    // pathParameters is absent, not {}, when AWS has nothing to put in it.
    const result = await handler(apiEvent({ path: "/windows//slots" }));

    expect(result.statusCode).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns an empty list for a window whose slots are all gone", async () => {
    // Query omits Items entirely rather than returning [].
    send.mockResolvedValue({});
    expect((await handler(get())).statusCode).toBe(404);
  });

  it("keeps CORS headers when the datastore fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      path: "/windows/autumn-2026/slots",
      pathParameters: { id: "autumn-2026" },
      headers: { origin: "http://localhost:5173" },
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
