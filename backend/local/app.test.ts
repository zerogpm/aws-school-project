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

const { healthHandler, listWindowsHandler } = vi.hoisted(() => ({
  healthHandler: vi.fn(),
  listWindowsHandler: vi.fn(),
}));

vi.mock("../src/handlers/health.js", () => ({ handler: healthHandler }));
vi.mock("../src/handlers/windows/list-windows.js", () => ({ handler: listWindowsHandler }));

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
  healthHandler.mockResolvedValue(result());
  listWindowsHandler.mockResolvedValue(result());
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
