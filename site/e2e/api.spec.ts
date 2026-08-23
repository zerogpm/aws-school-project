import { expect, test } from "@playwright/test";

// End to end against the real thing: real HTTP, the real Express wrapper, the
// real handlers, and the real DynamoDB Local container. Nothing is mocked, so
// this is the only layer that would catch a route registered in the manifest
// but never reachable, or a handler that works against a stubbed client and not
// against the database.
//
// Skipped rather than failed when the API is not running, matching
// backend/src/db.integration.test.ts - a clean checkout without Docker should
// still get a green suite.
//
//   ./app.sh --start --api
const API = "http://127.0.0.1:3000";

let apiUp = false;

test.beforeAll(async () => {
  try {
    const response = await fetch(`${API}/health`);
    apiUp = response.ok;
  } catch {
    apiUp = false;
  }

  if (!apiUp) {
    console.warn(`[skipped] no API at ${API} - run ./app.sh --start --api to include these`);
  }
});

test.beforeEach(() => {
  test.skip(!apiUp, `no API at ${API}`);
});

test.describe("the local API", () => {
  test("health answers without a token, as the health check will", async () => {
    const response = await fetch(`${API}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("windows come back from the real table, newest first", async () => {
    // Reads GSI1 rather than scanning, so this also proves the index keys were
    // written as strings - written as numbers the rows are silently absent
    // from the index and this returns an empty list with no error anywhere.
    const response = await fetch(`${API}/windows`);
    expect(response.status).toBe(200);

    const { windows } = (await response.json()) as {
      windows: { id: string; opensAt: string; label: string }[];
    };

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.map((w) => w.id)).toContain("autumn-2026");

    const openings = windows.map((w) => w.opensAt);
    expect(openings).toEqual([...openings].sort().reverse());
  });

  test("an allowed origin is echoed back", async () => {
    const response = await fetch(`${API}/health`, {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("an unknown origin gets no allow header, so the browser blocks it", async () => {
    // No wildcard fallback. The request still succeeds server-side; it is the
    // browser that refuses to hand the response to the page.
    const response = await fetch(`${API}/health`, {
      headers: { Origin: "https://not-the-school.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a path no route claims is a 404", async () => {
    const response = await fetch(`${API}/windows/nope/nope`);
    expect(response.status).toBe(404);
  });
});
