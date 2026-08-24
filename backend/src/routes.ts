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
   * Least-privilege media-bucket access, scoped to docs/.
   *
   * A second axis rather than more values on `access`, because the two grants
   * are independent: list-documents touches S3 and never the table, and every
   * booking route is the reverse. Folding them into one enum would produce
   * "readwrite-and-s3-write" and a policy generator nobody can read.
   *
   * "read" is ListBucket on the prefix plus GetObject; "write" is PutObject;
   * "delete" is ListBucket plus DeleteObject. None implies another - the upload
   * route signs a policy and never lists, the public list never writes, and the
   * delete route has to find an object before removing it but may not read one.
   */
  readonly bucket?: "read" | "write" | "delete";

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
  {
    name: "create-window",
    method: "POST",
    path: "/windows",
    entry: "src/handlers/windows/create-window.ts",
    // Office staff, checked in the handler against cognito:groups - the
    // authorizer can validate a token but cannot read an arbitrary claim.
    auth: "staff",
    access: "readwrite",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    // Longer than the rest: this writes the whole grid, which is 540 items for
    // sixty teachers, in batches of 25.
    timeout: 30,
  },
  {
    name: "list-slots",
    method: "GET",
    path: "/windows/{id}/slots",
    entry: "src/handlers/windows/list-slots.ts",
    // Public: a parent has no account and this is the page they came for. The
    // projection is the boundary here, not the authorizer - see toPublicSlot.
    auth: "public",
    access: "read",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
  {
    name: "create-booking",
    method: "POST",
    path: "/bookings",
    entry: "src/handlers/bookings/create-booking.ts",
    // Public write, gated by student number and throttled at the API. The
    // conditional write is what makes it safe, not the caller's identity.
    auth: "public",
    access: "readwrite",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
  {
    name: "list-bookings",
    method: "GET",
    path: "/windows/{id}/bookings",
    entry: "src/handlers/bookings/list-bookings.ts",
    auth: "staff",
    access: "read",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
  {
    name: "cancel-booking",
    method: "DELETE",
    path: "/bookings/{ref}",
    entry: "src/handlers/bookings/cancel-booking.ts",
    // Public, because there are no parent accounts. The booking reference is a
    // v4 uuid and acts as the capability; the student number is a second factor.
    auth: "public",
    access: "readwrite",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
  {
    name: "lookup-bookings",
    method: "POST",
    path: "/bookings/lookup",
    entry: "src/handlers/bookings/lookup-bookings.ts",
    // Public, and keyed on a booking reference plus the student number. A
    // lookup by student number alone would let anyone who guessed one read a
    // family's evening; a reference is unguessable and proves membership.
    //
    // POST because the reference is a credential and does not belong in a URL,
    // a browser history or an access log.
    auth: "public",
    access: "read",
    env: ["ALLOWED_ORIGINS", "TABLE_NAME"],
    timeout: 10,
  },
  {
    name: "create-upload",
    method: "POST",
    path: "/uploads",
    entry: "src/handlers/documents/create-upload.ts",
    // Office staff, checked in the handler - the authorizer cannot read
    // cognito:groups. The signed policy it returns is a bearer capability, so
    // this route is the only gate that exists.
    auth: "staff",
    // No table at all. This route signs a policy and touches nothing else.
    access: "none",
    bucket: "write",
    env: ["ALLOWED_ORIGINS", "MEDIA_BUCKET"],
    timeout: 10,
  },
  {
    name: "list-documents",
    method: "GET",
    path: "/documents",
    entry: "src/handlers/documents/list-documents.ts",
    // Public: school newsletters and permission forms are meant to be read by
    // every parent, and there are no parent accounts to gate them behind.
    auth: "public",
    access: "none",
    bucket: "read",
    // MEDIA_BASE_URL is read by this handler and not by media.ts, deliberately.
    // Putting it in the shared helper would make create-upload read it
    // transitively without declaring it, which routes.parity.test.ts fails on -
    // correctly, because Terraform would then not pass it to that function.
    env: ["ALLOWED_ORIGINS", "MEDIA_BASE_URL", "MEDIA_BUCKET"],
    timeout: 10,
  },
  {
    name: "delete-document",
    method: "DELETE",
    path: "/documents/{id}",
    entry: "src/handlers/documents/delete-document.ts",
    // Office staff, checked in the handler. Unpublishing is the destructive
    // half of publishing and belongs behind the same gate.
    auth: "staff",
    access: "none",
    // ListBucket to resolve the id to a key, DeleteObject to remove it. No
    // GetObject: this route never needs to read what it is deleting.
    bucket: "delete",
    env: ["ALLOWED_ORIGINS", "MEDIA_BUCKET"],
    timeout: 10,
  },
] as const satisfies readonly Route[];

/**
 * The union of route names. local/app.ts keys its handler map on this, so a
 * route with no handler - or a handler with no route - fails `tsc` rather than
 * waiting to be noticed by a test or, worse, by production.
 */
export type RouteName = (typeof routes)[number]["name"];

// ---------------------------------------------------------------------------
// Consumers: Lambdas that nothing calls over HTTP.
//
// This is the exception .claude/rules/handlers.md names in as many words - "a
// non-HTTP trigger - is a deliberate, commented exception, not a quiet one" -
// so here is the comment.
//
// A stream consumer cannot be a Route, and the reasons are structural rather
// than stylistic. `method` is a closed union of HTTP verbs with no null member;
// `path` is dereferenced unguarded by byStaticSegmentsFirst and interpolated
// into an API Gateway route key; `auth: "public"` would be a lie that reads as
// "anyone on the internet can invoke this"; and local/app.ts types its handler
// map as Record<RouteName, Handler>, so a DynamoDBStreamEvent handler would not
// compile. Forcing one in mints an API Gateway route and an invoke permission
// for a function that must have neither.
//
// So: a second list, in the same file. routes.ts stays the one place endpoints
// and functions are declared, the HTTP loop in local/app.ts never sees these,
// and everything that is genuinely shared - the bundle, the env-var parity
// check, the log group, the role - is reused rather than reimplemented.
// ---------------------------------------------------------------------------

export type Consumer = {
  /** Lambda name, log group, zip file and IAM role, exactly as for a route. */
  readonly name: string;

  /** Source file, relative to backend/. Read by build-handlers.ts and Terraform. */
  readonly entry: string;

  /**
   * What invokes it. One value today; it exists so the Terraform can switch on
   * something meaningful rather than assuming every consumer is a table stream.
   */
  readonly source: "table-stream";

  /**
   * Partition prefix the event source mapping filters on, so a consumer is only
   * woken by records it cares about.
   *
   * Here rather than as a literal in consumers.tf so a test can pin it to the
   * key builder it has to agree with. Rename the prefix in booking/keys.ts and
   * the filter goes deaf - the consumer stops being invoked at all, no error
   * anywhere, and every other test stays green.
   */
  readonly keyPrefix: string;

  /**
   * Least-privilege table access, same enum and same meaning as on a Route.
   * Stream *read* permission is implied by `source` and granted separately - it
   * is a grant on the stream ARN, not on the table, and conflating the two is
   * how a consumer ends up able to write rows it only ever needed to read.
   */
  readonly access: "none" | "read" | "readwrite";

  /**
   * Every environment variable the handler reads, transitively. Checked by the
   * same parity test that checks routes - the mechanism cares about the entry
   * point, not about what triggers it.
   */
  readonly env: readonly string[];

  /** Seconds. */
  readonly timeout: number;

  /** Records per invocation. Small: a batch is one evening's bookings at most. */
  readonly batchSize: number;
};

export const consumers = [
  {
    name: "booking-email",
    entry: "src/consumers/booking-email.ts",
    source: "table-stream",
    // Must equal bookingPk(""). routes.ts stays pure data, so the tie to
    // keys.ts is asserted in a test rather than imported here.
    keyPrefix: "BOOKING#",
    // Reads the student profile for the parent's address, and writes the
    // send-once marker that keeps a retried batch from mailing twice.
    access: "readwrite",
    // No ALLOWED_ORIGINS, and that absence is the signal: every helper in
    // handlers/http.ts takes an ApiEvent so it can read the Origin header, and
    // this handler has no request, no origin and no response.
    env: ["SES_FROM_ADDRESS", "SITE_BASE_URL", "TABLE_NAME"],
    timeout: 30,
    batchSize: 10,
  },
] as const satisfies readonly Consumer[];

/** The union of consumer names, for the same reason RouteName exists. */
export type ConsumerName = (typeof consumers)[number]["name"];

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
