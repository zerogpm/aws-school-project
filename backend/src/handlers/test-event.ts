// Builds the events API Gateway actually sends, for tests.
//
// No handler imports this, so it never reaches a Lambda bundle. It exists
// because the payoff of the handler contract is that business logic is testable
// as a pure function - no HTTP, no server, no transport mocking - and that only
// holds if the synthetic event is honest about the awkward shapes.
//
// The defaults are the awkward ones on purpose: no body, no path parameters, no
// query string, and no authorizer. Those are exactly what AWS sends and what a
// test written from the happy path never produces.
import type { ApiEvent } from "./http.js";

export type EventOptions = {
  method?: string;
  path?: string;
  body?: string | null;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;

  /** Omit for a public route - the authorizer key is then absent, as on AWS. */
  claims?: Record<string, string | number | boolean | string[]>;
};

export function apiEvent(options: EventOptions = {}): ApiEvent {
  const method = options.method ?? "GET";
  const path = options.path ?? "/";

  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: new URLSearchParams(options.queryStringParameters ?? {}).toString(),
    headers: options.headers ?? {},
    queryStringParameters: options.queryStringParameters,
    pathParameters: options.pathParameters,
    body: options.body ?? undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "test-request",
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: "2026-08-22T00:00:00Z",
      timeEpoch: 1_787_356_800_000,
      ...(options.claims
        ? {
            authorizer: {
              principalId: String(options.claims.sub ?? ""),
              integrationLatency: 0,
              jwt: { claims: options.claims, scopes: [] },
            },
          }
        : {}),
    },
  };
}
