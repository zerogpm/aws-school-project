import { describe, expect, it } from "vitest";
import type { Route } from "./routes.js";
import { byStaticSegmentsFirst, pathParamNames, routes, toExpressPath } from "./routes.js";

const route = (path: string): Route => ({
  name: path,
  method: "GET",
  path,
  entry: "src/handlers/x.ts",
  auth: "public",
  access: "none",
  env: [],
  timeout: 10,
});

describe("toExpressPath", () => {
  it("translates a single parameter", () => {
    expect(toExpressPath("/windows/{id}")).toBe("/windows/:id");
  });

  it("translates every parameter in a multi-segment path", () => {
    expect(toExpressPath("/windows/{id}/slots/{slotId}")).toBe("/windows/:id/slots/:slotId");
  });

  it("leaves a static path alone", () => {
    expect(toExpressPath("/health")).toBe("/health");
  });
});

describe("pathParamNames", () => {
  it("lists parameters in order", () => {
    expect(pathParamNames("/windows/{id}/slots/{slotId}")).toEqual(["id", "slotId"]);
  });

  it("returns empty for a static path, so no pathParameters key is built", () => {
    expect(pathParamNames("/health")).toEqual([]);
  });
});

describe("byStaticSegmentsFirst", () => {
  it("puts a static segment before a parameterised sibling", () => {
    // Express matches in registration order, so /windows/{id} registered first
    // would swallow /windows/open and dispatch it with id="open". API Gateway
    // prefers the static segment, so getting this wrong is a bug that exists in
    // exactly one of the two runtimes.
    const sorted = [route("/windows/{id}"), route("/windows/open")].sort(byStaticSegmentsFirst);
    expect(sorted.map((r) => r.path)).toEqual(["/windows/open", "/windows/{id}"]);
  });

  it("compares segment by segment rather than counting parameters", () => {
    const sorted = [
      route("/windows/{id}/slots"),
      route("/windows/open/{id}"),
    ].sort(byStaticSegmentsFirst);
    expect(sorted.map((r) => r.path)).toEqual(["/windows/open/{id}", "/windows/{id}/slots"]);
  });

  it("is stable and total for unrelated paths", () => {
    const sorted = [route("/b"), route("/a")].sort(byStaticSegmentsFirst);
    expect(sorted.map((r) => r.path)).toEqual(["/a", "/b"]);
  });
});

describe("the manifest", () => {
  it("has a unique name per route, since names become physical resources", () => {
    const names = routes.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has a unique method and path per route", () => {
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses gateway path syntax - leading slash, {braces}, no :colons", () => {
    for (const r of routes) {
      expect(r.path.startsWith("/"), `${r.name} must start with /`).toBe(true);
      expect(r.path).not.toMatch(/:/);
    }
  });

  it("names an entry file that matches the route name", () => {
    // The zip, the log group and the IAM role are all named from `name`, so a
    // mismatch here makes the deployed function hard to trace back to a file.
    for (const r of routes) {
      expect(r.entry.endsWith(`${r.name}.ts`), `${r.name} vs ${r.entry}`).toBe(true);
    }
  });

  it("grants no table access to a route that names no table", () => {
    for (const r of routes) {
      // Widened: `as const` narrows each route's env to its own literal tuple,
      // so includes() would only accept that route's own names.
      const env: readonly string[] = r.env;
      if (!env.includes("TABLE_NAME")) expect(r.access).toBe("none");
    }
  });
});
