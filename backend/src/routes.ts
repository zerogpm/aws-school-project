// Every endpoint, once.
//
// This list is the source of truth for both runtimes. backend/local/app.ts
// imports it directly; modules/booking/lambda.tf reads the emitted
// backend/routes.json and creates one Lambda, one log group, one IAM role and
// one API Gateway route per entry. Adding an endpoint to one side and not the
// other is the standard way to ship a route that works all through development
// and 404s in production, so there is only one side.
//
// Keep this file pure data - no imports of handler functions, nothing
// environment-dependent. It has to survive JSON.stringify, and scripts that
// only want the shape (emit-routes, build-handlers) must be able to load it
// without dragging in the AWS SDK.

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type Route = {
  /** Lambda name, log group, zip file, IAM role and the key in app.ts's handler map. */
  readonly name: string;

  readonly method: HttpMethod;

  /**
   * API Gateway syntax: leading slash, `{id}` for a path parameter. The Express
   * form (`/windows/:id`) is derived from this in local/app.ts, never written
   * out by hand - hand-translating the two syntaxes is the bug the brief spends
   * a whole table on.
   */
  readonly path: string;

  /** Source file, relative to backend/. Read by build-handlers.ts and Terraform. */
  readonly entry: string;

  /**
   * "staff" attaches the Cognito JWT authorizer and, locally, injects mock
   * claims. "public" attaches neither - the local wrapper models the *absence*
   * of identity too, so a handler that quietly depends on claims fails locally
   * instead of in production.
   */
  readonly auth: "staff" | "public";

  /** Least-privilege table access. Generates the IAM policy in lambda.tf. */
  readonly access: "none" | "read" | "readwrite";

  /**
   * Every environment variable the handler reads, including transitively
   * through a shared helper. src/routes.parity.test.ts imports each handler in
   * isolation and fails if it asked for one that is not listed here.
   */
  readonly env: readonly string[];

  /** Seconds. Local has no timeout at all, so this bound is only ever tested deployed. */
  readonly timeout: number;
};

export const routes = [
  {
    name: "health",
    method: "GET",
    path: "/health",
    entry: "src/handlers/health.ts",
    // Public on purpose: this is what the Route53 health check hits, and it has
    // no token to present.
    auth: "public",
    access: "none",
    env: ["ALLOWED_ORIGINS"],
    timeout: 5,
  },
  {
    name: "list-windows",
    method: "GET",
    path: "/windows",
    entry: "src/handlers/windows/list-windows.ts",
    auth: "staff",
    access: "read",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
] as const satisfies readonly Route[];

/**
 * The union of route names. local/app.ts keys its handler map on this, so a
 * route with no handler - or a handler with no route - fails `tsc` rather than
 * waiting to be noticed by a test or, worse, by production.
 */
export type RouteName = (typeof routes)[number]["name"];

/** API Gateway `{id}` to Express `:id`. Derived, never hand-written. */
export function toExpressPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

/** The path parameter names in a route, in order. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}

/**
 * Registration order for Express, which matches in registration order and would
 * otherwise let `/windows/{id}` swallow `/windows/open` and dispatch it with
 * id="open". API Gateway prefers the static segment and routes it correctly, so
 * getting this wrong produces a bug that exists in exactly one of the two
 * runtimes. Sorting mechanically is cheaper than remembering.
 */
export function byStaticSegmentsFirst(a: Route, b: Route): number {
  const aSegments = a.path.split("/");
  const bSegments = b.path.split("/");

  for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
    const aParam = aSegments[i]?.startsWith("{") ?? false;
    const bParam = bSegments[i]?.startsWith("{") ?? false;
    if (aParam !== bParam) return aParam ? 1 : -1;
  }

  return a.path.localeCompare(b.path);
}
