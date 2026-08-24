// The HTTP shape every handler speaks, and the only place a response is built.
//
// Payload format 2.0, because CLAUDE.md commits to an API Gateway HTTP API. The
// v1 REST shape (event.httpMethod, event.path, requestContext.authorizer.claims)
// does not appear anywhere in this codebase - mixing the two is how you get a
// handler that reads undefined from a field the other version populates.
import type {
  APIGatewayEventRequestContextJWTAuthorizer,
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2WithRequestContext,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { requireEnv } from "../env.js";

/**
 * The event every handler receives.
 *
 * `authorizer` is optional rather than required, which the stock
 * APIGatewayProxyEventV2WithJWTAuthorizer does not allow: a public route has no
 * authorizer attached, so the key is genuinely absent. Modelling that in the
 * type is what forces a handler to decide what it does without identity,
 * instead of reading `undefined.jwt` in production only.
 */
export type ApiEvent = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & {
    authorizer?: APIGatewayEventRequestContextJWTAuthorizer;
  }
>;

export type ApiResult = APIGatewayProxyStructuredResultV2;

/**
 * The universal interface. Both runtimes construct an ApiEvent and read back an
 * ApiResult; neither a handler nor anything it imports ever sees req, res, next
 * or a socket. Violate this once and the local wrapper stops being a wrapper.
 */
export type Handler = (event: ApiEvent) => Promise<ApiResult>;

// Read at module load, so a function deployed without it fails on the first
// invocation with the variable named, rather than quietly serving responses
// that no browser will accept.
const ALLOWED_ORIGINS = requireEnv("ALLOWED_ORIGINS")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Case-insensitive header lookup.
 *
 * API Gateway v2 lowercases header names and so does Node, but "in practice"
 * is not a contract, and a handler that looks up "Origin" and gets undefined
 * fails in a way that looks like the browser's fault.
 */
export function getHeader(event: ApiEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * CORS headers for this request.
 *
 * The origin is echoed rather than wildcarded, because the allow-list is short
 * and known. An origin that is not on the list gets a response with no
 * Access-Control-Allow-Origin at all - the browser then blocks it, which is the
 * correct outcome and the honest one.
 */
export function buildCorsHeaders(event: ApiEvent): Record<string, string> {
  const headers: Record<string, string> = {
    // Set here rather than left to the runtime: locally the wrapper hands
    // the body to res.send(), which types a bare string as text/html.
    "Content-Type": "application/json",
  };

  const origin = getHeader(event, "origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    // The response varies by request origin, so a cache keyed only on the
    // URL would serve one parent's allowed origin to another's browser.
    headers.Vary = "Origin";
  }

  return headers;
}

/**
 * The only way a response is built.
 *
 * Every path goes through here, including guards and catch blocks, because a
 * 500 without CORS headers reaches the browser as an opaque network error
 * rather than as a 500 - and then the hours go into the wrong layer.
 *
 * The body is stringified here too. v2 permits returning a bare object, but
 * relying on that would give the local wrapper a second shape to handle.
 */
export function json(event: ApiEvent, statusCode: number, payload: unknown): ApiResult {
  return {
    statusCode,
    headers: buildCorsHeaders(event),
    body: JSON.stringify(payload),
  };
}

export const ok = (event: ApiEvent, payload: unknown): ApiResult => json(event, 200, payload);

/**
 * 201, for a booking that was actually created.
 *
 * Distinct from ok() because the booking routes are the first thing here that
 * creates a resource, and a parent's client needs to tell "your slot is
 * confirmed" from "here is the list you asked for".
 */
export const created = (event: ApiEvent, payload: unknown): ApiResult => json(event, 201, payload);

export const badRequest = (event: ApiEvent, error: string): ApiResult =>
  json(event, 400, { error });

export const unauthorized = (event: ApiEvent, error = "Unauthorized"): ApiResult =>
  json(event, 401, { error });

export const forbidden = (event: ApiEvent, error = "Forbidden"): ApiResult =>
  json(event, 403, { error });

export const notFound = (event: ApiEvent, error = "Not found"): ApiResult =>
  json(event, 404, { error });

/**
 * 409, and the reason this episode exists.
 *
 * A booking loses a race - the slot went while the page was open, or this
 * family already holds a slot with this teacher. Both are the caller's problem
 * to resolve rather than a server fault, and the message says which, because a
 * parent cannot act on "conflict".
 *
 * Distinct from badRequest: the request was well-formed and would have
 * succeeded a moment earlier.
 */
export const conflict = (event: ApiEvent, error: string): ApiResult => json(event, 409, { error });

/**
 * Deliberately says nothing. The detail belongs in the log, where CloudWatch
 * has it and the caller does not.
 */
export const serverError = (event: ApiEvent): ApiResult =>
  json(event, 500, { error: "Internal error" });

/**
 * Parses a JSON body, treating absent and malformed as the same failure.
 *
 * event.body is a string or undefined, never a parsed object - the local
 * wrapper re-serialises Express's parsed body precisely so this stays true in
 * both runtimes.
 */
export function parseBody<T>(event: ApiEvent): T | undefined {
  if (!event.body) return undefined;
  try {
    return JSON.parse(event.body) as T;
  } catch {
    return undefined;
  }
}
