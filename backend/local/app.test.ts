// Layer 2: the adapter itself.
//
// The handlers are mocked here on purpose. What is under test is the bridge -
// event construction, response translation, route registration - not the
// business logic, which layer 1 covers as pure functions. Mocking them is also
// the only way to inspect the event the wrapper built.
//
// That supertest can import createApp() at all is the property to protect: the
// factory connects to nothing, seeds nothing and listens on nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { ApiEvent, ApiResult } from "../src/handlers/http.js";
import type { Route } from "../src/routes.js";

const {
  healthHandler,
  listWindowsHandler,
  createWindowHandler,
  listSlotsHandler,
  createBookingHandler,
  listBookingsHandler,
  cancelBookingHandler,
  listDocumentsHandler,
  deleteDocumentHandler,
} = vi.hoisted(() => ({
  healthHandler: vi.fn(),
  listWindowsHandler: vi.fn(),
  createWindowHandler: vi.fn(),
  listSlotsHandler: vi.fn(),
  createBookingHandler: vi.fn(),
  listBookingsHandler: vi.fn(),
  cancelBookingHandler: vi.fn(),
  listDocumentsHandler: vi.fn(),
  deleteDocumentHandler: vi.fn(),
}));

vi.mock("../src/handlers/health.js", () => ({ handler: healthHandler }));
vi.mock("../src/handlers/windows/list-windows.js", () => ({ handler: listWindowsHandler }));
vi.mock("../src/handlers/windows/create-window.js", () => ({ handler: createWindowHandler }));
vi.mock("../src/handlers/windows/list-slots.js", () => ({ handler: listSlotsHandler }));
vi.mock("../src/handlers/bookings/list-bookings.js", () => ({ handler: listBookingsHandler }));
vi.mock("../src/handlers/bookings/create-booking.js", () => ({ handler: createBookingHandler }));
vi.mock("../src/handlers/bookings/cancel-booking.js", () => ({ handler: cancelBookingHandler }));
vi.mock("../src/handlers/documents/list-documents.js", () => ({ handler: listDocumentsHandler }));
vi.mock("../src/handlers/documents/delete-document.js", () => ({ handler: deleteDocumentHandler }));

const { createApp, createLambdaEvent, registrationOrder } = await import("./app.js");

const result = (over: Partial<ApiResult> = {}): ApiResult => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ok: true }),
  ...over,
});

// Block bodies, always: an arrow returning mockReset() returns the mock, and
// vitest would take that as this hook's teardown and call it after every test.
beforeEach(() => {
  healthHandler.mockReset();
  listWindowsHandler.mockReset();
  createWindowHandler.mockReset();
  listSlotsHandler.mockReset();
  createBookingHandler.mockReset();
  listBookingsHandler.mockReset();
  cancelBookingHandler.mockReset();
  listDocumentsHandler.mockReset();
  deleteDocumentHandler.mockReset();
  healthHandler.mockResolvedValue(result());
  listWindowsHandler.mockResolvedValue(result());
  createWindowHandler.mockResolvedValue(result());
  listSlotsHandler.mockResolvedValue(result());
  createBookingHandler.mockResolvedValue(result());
  listBookingsHandler.mockResolvedValue(result());
  cancelBookingHandler.mockResolvedValue(result());
  listDocumentsHandler.mockResolvedValue(result());
  deleteDocumentHandler.mockResolvedValue(result());
});

/** The event the wrapper handed to the handler on its most recent call. */
const eventFor = (handler: typeof healthHandler): ApiEvent => handler.mock.calls[0][0];

/** The parts of an Express request createLambdaEvent actually reads. */
const fakeRequest = (over: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string | string[]>;
  body?: unknown;
}) =>
  ({
    method: "GET",
    path: "/windows/w-1/slots/s-2",
    params: over.params ?? {},
    query: over.query ?? {},
    headers: over.headers ?? {},
    body: over.body,
    hostname: "127.0.0.1",
    httpVersion: "1.1",
    ip: "127.0.0.1",
    get: () => undefined,
  }) as never;

/**
 * A route with parameters, which the manifest does not have one of yet. The
 * translation has to be right before the first route needs it - a handler that
 * finds pathParameters absent surfaces as a 400 nobody can explain.
 */
const parameterised: Route = {
  name: "get-slot",
  method: "GET",
  path: "/windows/{id}/slots/{slotId}",
  entry: "src/handlers/windows/get-slot.ts",
  auth: "staff",
  access: "read",
  env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
  timeout: 10,
};

describe("response translation", () => {
  it("copies the status through", async () => {
    healthHandler.mockResolvedValue(result({ statusCode: 503 }));
    await request(createApp()).get("/health").expect(503);
  });

  it("copies the handler's headers onto the response", async () => {
    healthHandler.mockResolvedValue(
      result({ headers: { "Content-Type": "application/json", "X-Marker": "from-handler" } }),
    );

    const response = await request(createApp()).get("/health");

    expect(response.headers["x-marker"]).toBe("from-handler");
  });

  it("sends the body as-is rather than re-serialising it", async () => {
    // res.json() on an already-stringified body would quote the whole thing and
    // the caller would parse a string instead of an object.
    healthHandler.mockResolvedValue(result({ body: JSON.stringify({ status: "ok" }) }));

    const response = await request(createApp()).get("/health");

    expect(response.text).toBe('{"status":"ok"}');
    expect(response.body).toEqual({ status: "ok" });
  });

  it("honours the handler's Content-Type rather than the text/html default", async () => {
    // res.send() on a bare string types it as text/html unless something set
    // the header, which is why buildCorsHeaders always declares JSON.
    const response = await request(createApp()).get("/health");
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("event construction", () => {
  it("gives a public route no authorizer at all", async () => {
    // This is what a public route looks like on AWS. Injecting mock claims here
    // would let a handler depend on an identity that will not exist, and the
    // failure would first appear in production.
    await request(createApp()).get("/health");

    expect(eventFor(healthHandler).requestContext.authorizer).toBeUndefined();
  });

  it("gives a staff route the claim shape the JWT authorizer produces", async () => {
    await request(createApp()).get("/windows");

    const claims = eventFor(listWindowsHandler).requestContext.authorizer?.jwt.claims;
    expect(claims).toMatchObject({ sub: "local-staff-id", email: "local@dev.com" });
  });

  it("leaves the body undefined when there is none", async () => {
    await request(createApp()).get("/health");
    expect(eventFor(healthHandler).body).toBeUndefined();
  });

  it("omits queryStringParameters entirely when there is no query", async () => {
    // Absent, not {} - a handler that gets {} locally never has its optional
    // chaining exercised against the shape AWS actually sends.
    await request(createApp()).get("/health");
    expect(eventFor(healthHandler).queryStringParameters).toBeUndefined();
  });

  it("passes the query string through when there is one", async () => {
    await request(createApp()).get("/health?published=true");

    expect(eventFor(healthHandler).queryStringParameters).toEqual({ published: "true" });
    expect(eventFor(healthHandler).rawQueryString).toBe("published=true");
  });

  it("sets version 2.0 and a routeKey matching the manifest", async () => {
    await request(createApp()).get("/windows");

    const event = eventFor(listWindowsHandler);
    expect(event.version).toBe("2.0");
    expect(event.routeKey).toBe("GET /windows");
    expect(event.requestContext.http.method).toBe("GET");
  });

});

describe("path parameters", () => {
  it("maps every parameter named in the gateway path", () => {
    const event = createLambdaEvent(fakeRequest({ params: { id: "w-1", slotId: "s-2" } }), parameterised);
    expect(event.pathParameters).toEqual({ id: "w-1", slotId: "s-2" });
  });

  it("omits pathParameters for a static route", () => {
    const event = createLambdaEvent(fakeRequest({}), { ...parameterised, path: "/windows" });
    expect(event.pathParameters).toBeUndefined();
  });
});

describe("body and header translation", () => {
  // Driven through createLambdaEvent rather than over HTTP, because superagent
  // cannot produce the inputs these are about: it overwrites a repeated header
  // rather than repeating it, and there is no POST route to carry a body yet.
  it("re-serialises the body express parsed, so the handler gets a string", () => {
    // The round-trip is the fidelity guarantee, not an inefficiency to remove:
    // event.body is a string on AWS, and a handler that receives an object
    // locally is a handler nobody has tested. It is also exactly why a
    // signature-verifying webhook could never come through this path.
    const event = createLambdaEvent(fakeRequest({ body: { hello: "world" } }), parameterised);
    expect(event.body).toBe('{"hello":"world"}');
  });

  it("treats an empty parsed body as no body", () => {
    // express.json() leaves {} on a request that carried nothing.
    expect(createLambdaEvent(fakeRequest({ body: {} }), parameterised).body).toBeUndefined();
  });

  it("joins repeated headers the way API Gateway v2 does", () => {
    // Node keeps repeats as an array; v2 collapses them to one comma-joined
    // value, so a handler's header lookup has to see the same thing in both.
    const event = createLambdaEvent(
      fakeRequest({ headers: { "x-repeated": ["a", "b"], "x-single": "one" } }),
      parameterised,
    );

    expect(event.headers["x-repeated"]).toBe("a,b");
    expect(event.headers["x-single"]).toBe("one");
  });
});

describe("routing", () => {
  it("registers static paths before parameterised siblings", () => {
    const paths = registrationOrder().map((r) => r.path);
    const sorted = [...paths].sort((a, b) => (a.includes("{") ? 1 : 0) - (b.includes("{") ? 1 : 0));
    expect(paths).toEqual(sorted);
  });

  it("answers 404 for a path no route claims", async () => {
    await request(createApp()).get("/nope").expect(404);
    expect(healthHandler).not.toHaveBeenCalled();
  });

  it("turns a handler that throws into a 500 rather than a hung request", async () => {
    // Deployed this is an unhandled Lambda error and API Gateway answers 502.
    // Either way it is a bug in the handler - a handler returns its errors.
    healthHandler.mockRejectedValue(new Error("handler exploded"));

    const response = await request(createApp()).get("/health").expect(500);

    expect(response.body.details).toBe("handler exploded");
  });
});

// The bridge behaviour the booking routes introduced. Until episode 04 the
// manifest had no POST, no DELETE and no path parameter, so none of this had
// ever run against a real route - only against the literal `parameterised`
// above. These are the same assertions against the routes that now exist.
describe("the booking routes over the bridge", () => {
  it("hands a POST body to the handler as a JSON string, not an object", async () => {
    // express.json() parsed it; createLambdaEvent has to stringify it back,
    // because event.body is a string on AWS. A handler that received an object
    // locally would be a handler nobody has tested.
    await request(createApp())
      .post("/bookings")
      .send({ studentNumber: "S00481", slotId: "SLOT#2026-10-14T21:00:00.000Z#okafor" })
      .expect(200);

    const event = eventFor(createBookingHandler);
    expect(typeof event.body).toBe("string");
    expect(JSON.parse(event.body!)).toEqual({
      studentNumber: "S00481",
      slotId: "SLOT#2026-10-14T21:00:00.000Z#okafor",
    });
  });

  it("reaches a public POST with no authorizer at all", async () => {
    // POST /bookings is public. Injecting mock claims here would let a handler
    // depend on an identity that does not exist in production.
    await request(createApp()).post("/bookings").send({ studentNumber: "S00481" }).expect(200);

    expect(eventFor(createBookingHandler).requestContext.authorizer).toBeUndefined();
  });

  it("maps a nested path parameter", async () => {
    await request(createApp()).get("/windows/autumn-2026/slots").expect(200);

    const event = eventFor(listSlotsHandler);
    expect(event.pathParameters).toEqual({ id: "autumn-2026" });
    expect(event.routeKey).toBe("GET /windows/{id}/slots");
  });

  it("routes a DELETE and carries its parameter and body together", async () => {
    // The only route that needs both at once - and Express does not parse a
    // DELETE body unless express.json() is mounted before the routes.
    await request(createApp())
      .delete("/bookings/3f1c8a2e-0000-4000-8000-000000000000")
      .send({ studentNumber: "S00481" })
      .expect(200);

    const event = eventFor(cancelBookingHandler);
    expect(event.pathParameters).toEqual({ ref: "3f1c8a2e-0000-4000-8000-000000000000" });
    expect(JSON.parse(event.body!)).toEqual({ studentNumber: "S00481" });
    expect(event.requestContext.http.method).toBe("DELETE");
  });

  it("does not confuse GET /windows with GET /windows/{id}/slots", async () => {
    // Registration order decides this in Express. API Gateway would get it
    // right either way, so a mistake here exists in exactly one runtime.
    await request(createApp()).get("/windows").expect(200);

    expect(listWindowsHandler).toHaveBeenCalledTimes(1);
    expect(listSlotsHandler).not.toHaveBeenCalled();
  });

  it("dispatches GET and POST on /windows to different handlers", async () => {
    // Same path, two routes, distinguished only by method. Express registers
    // them separately; getting this wrong sends an open-window request to the
    // list handler and returns 200 with the wrong body.
    const app = createApp();
    await request(app).get("/windows").expect(200);
    await request(app).post("/windows").send({ id: "autumn-2026" }).expect(200);

    expect(listWindowsHandler).toHaveBeenCalledTimes(1);
    expect(createWindowHandler).toHaveBeenCalledTimes(1);
  });
});

// The document routes over the bridge. GET /documents and DELETE
// /documents/{id} are the manifest's first same-prefix pair where one side is
// static and the other parameterised *and* they differ in method - the shape
// Express gets wrong by registration order and API Gateway always gets right.
describe("the document routes over the bridge", () => {
  it("reaches the public list with no authorizer at all", async () => {
    // GET /documents is public: newsletters are for every parent and there are
    // no parent accounts. Injecting mock claims here would let the handler grow
    // a dependency on an identity production will not send.
    await request(createApp()).get("/documents").expect(200);

    expect(eventFor(listDocumentsHandler).requestContext.authorizer).toBeUndefined();
  });

  it("gives the staff delete the claim shape the JWT authorizer produces", async () => {
    await request(createApp())
      .delete("/documents/11111111-1111-4111-8111-111111111111")
      .expect(200);

    const claims = eventFor(deleteDocumentHandler).requestContext.authorizer?.jwt?.claims;
    expect(claims?.["cognito:groups"]).toContain("office");
  });

  it("carries the id through as a path parameter", async () => {
    await request(createApp())
      .delete("/documents/11111111-1111-4111-8111-111111111111")
      .expect(200);

    const event = eventFor(deleteDocumentHandler);
    expect(event.pathParameters).toEqual({ id: "11111111-1111-4111-8111-111111111111" });
    expect(event.routeKey).toBe("DELETE /documents/{id}");
    expect(event.requestContext.http.method).toBe("DELETE");
  });

  it("does not let the list swallow the delete, or the other way round", async () => {
    const app = createApp();
    await request(app).get("/documents").expect(200);
    await request(app).delete("/documents/11111111-1111-4111-8111-111111111111").expect(200);

    expect(listDocumentsHandler).toHaveBeenCalledTimes(1);
    expect(deleteDocumentHandler).toHaveBeenCalledTimes(1);
    expect(eventFor(listDocumentsHandler).pathParameters).toBeUndefined();
  });
});
