import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

// vi.hoisted, because vi.mock is lifted above the imports and a plain const
// declared here would be in its temporal dead zone inside the factory.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));

const { handler } = await import("./list-windows.js");


const staff = apiEvent({ path: "/windows", claims: { sub: "u-1", email: "hart@school.example" } });

const item = {
  PK: "WINDOW#autumn-2026",
  SK: "META",
  label: "Autumn parent-teacher interviews",
  opensAt: "2026-10-14T17:00:00Z",
  closesAt: "2026-10-14T20:00:00Z",
  published: true,
};

// A block body, not `() => send.mockReset()`. mockReset returns the mock, and
// vitest treats a function returned from beforeEach as that hook's teardown -
// so the concise form makes vitest call send() itself after every test. With a
// rejecting implementation in place that teardown returns a rejected promise
// and fails a test whose body already passed, reporting the error at the line
// where it was constructed. An hour, that one.
beforeEach(() => {
  send.mockReset();
});

describe("GET /windows", () => {
  it("returns the windows for a signed-in member of staff", async () => {
    send.mockResolvedValue({ Items: [item] });

    const result = await handler(staff);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      windows: [
        {
          id: "autumn-2026",
          label: "Autumn parent-teacher interviews",
          opensAt: "2026-10-14T17:00:00Z",
          closesAt: "2026-10-14T20:00:00Z",
          published: true,
        },
      ],
    });
  });

  it("reads GSI1 newest first, rather than scanning the table", async () => {
    send.mockResolvedValue({ Items: [] });
    await handler(staff);

    const input = send.mock.calls[0][0].input;
    expect(input.IndexName).toBe("GSI1");
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": "WINDOWS" });
    expect(input.ScanIndexForward).toBe(false);
  });

  it("refuses a request with no authorizer, which is what local looks like", async () => {
    // Deployed, API Gateway rejects this before the Lambda runs. Locally there
    // is no authorizer at all, so this check is the only thing standing between
    // the route and anyone on the machine.
    send.mockResolvedValue({ Items: [item] });

    const result = await handler(apiEvent({ path: "/windows" }));

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns an empty list, not undefined, when the index has nothing", async () => {
    // Query omits Items entirely rather than returning [].
    send.mockResolvedValue({});
    const result = await handler(staff);
    expect(JSON.parse(result.body!)).toEqual({ windows: [] });
  });

  it("turns a datastore failure into a 500 that still carries CORS headers", async () => {
    send.mockRejectedValue(new Error("ResourceNotFoundException"));

    const result = await handler(
      apiEvent({
        path: "/windows",
        claims: { sub: "u-1" },
        headers: { origin: "http://localhost:5173" },
      }),
    );

    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
