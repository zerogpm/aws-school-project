import { describe, expect, it } from "vitest";
import { handler } from "./health.js";
import { apiEvent } from "./test-event.js";

describe("GET /health", () => {
  it("answers without an authorizer, because the health check has no token", () => {
    // This route is public on AWS. If it needed claims, the local wrapper
    // injecting them would hide that until Route53 started reporting the site
    // down, which is the worst possible moment to find out.
    return expect(handler(apiEvent()).then((r) => r.statusCode)).resolves.toBe(200);
  });

  it("reports ok as a JSON string body", async () => {
    const result = await handler(apiEvent());
    expect(JSON.parse(result.body!)).toEqual({ status: "ok" });
  });

  it("carries CORS headers", async () => {
    const result = await handler(apiEvent({ headers: { origin: "http://localhost:5173" } }));
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
