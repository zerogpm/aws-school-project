// The local runtime. One of the two files that make up the entire bridge; the
// other is modules/booking/lambda.tf.
//
// This is an app *factory*. It builds and returns the Express app and does
// nothing else - no listen, no container connection, no seeding - which is what
// lets local/app.test.ts hand it straight to supertest. Protect that property:
// the moment createApp() has a side effect, the wrapper stops being testable
// and local boot stops being debuggable.
//
// The dependency arrow points one way. local/ imports from src/handlers/;
// nothing in src/handlers/ may import from here.
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { APIGatewayProxyEventHeaders } from "aws-lambda";
import { handler as health } from "../src/handlers/health.js";
import { handler as listWindows } from "../src/handlers/windows/list-windows.js";
import type { ApiEvent, ApiResult, Handler } from "../src/handlers/http.js";
import type { Route, RouteName } from "../src/routes.js";
import { byStaticSegmentsFirst, pathParamNames, routes, toExpressPath } from "../src/routes.js";

/**
 * Route name to handler.
 *
 * Typed as Record<RouteName, Handler>, so TypeScript rejects a route with no
 * handler and a handler with no route. That is the parity check the brief
 * spends section 9 on, moved from a shell script into the compiler.
 */
const handlers: Record<RouteName, Handler> = {
  health,
  "list-windows": listWindows,
};

/**
 * The claims the deployed JWT authorizer would have put in the request context.
 *
 * Safe to hard-code because nothing deployed loads this file: the Lambda bundle
 * is built from src/handlers/ only, and local/ has no deployed URL. The group
 * is here so the office-only paths can actually be exercised locally.
 */
const MOCK_CLAIMS = {
  sub: "local-staff-id",
  email: "local@dev.com",
  "cognito:groups": ["office"],
};

/**
 * API Gateway v2 collapses repeated headers into one comma-joined value. Node
 * keeps them as an array, so joining here is what keeps a handler's header
 * lookup returning the same thing in both runtimes.
 */
function flattenHeaders(req: Request): APIGatewayProxyEventHeaders {
  const headers: APIGatewayProxyEventHeaders = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }

  return headers;
}

/**
 * Builds exactly the event API Gateway would send for this route.
 *
 * The body round-trip is deliberate and must not be "optimised" away:
 * express.json() parsed it into an object, and this stringifies it back,
 * because event.body is a string on AWS and a handler that receives an object
 * locally would be a handler nobody has tested. It is also why a raw-body
 * webhook route could never go through here - re-serialising changes the bytes
 * an HMAC was computed over.
 */
export function createLambdaEvent(req: Request, route: Route): ApiEvent {
  const params = pathParamNames(route.path);
  const query = req.query as Record<string, string>;
  const now = new Date();

  return {
    version: "2.0",
    routeKey: `${route.method} ${route.path}`,
    rawPath: req.path,
    rawQueryString: new URLSearchParams(query).toString(),
    headers: flattenHeaders(req),

    // Absent, not {}, when there is nothing - that is the shape AWS sends, and
    // a handler that gets {} locally never has its optional chaining tested.
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    pathParameters:
      params.length > 0
        ? Object.fromEntries(params.map((name) => [name, String(req.params[name])]))
        : undefined,

    body: req.body !== undefined && Object.keys(req.body ?? {}).length > 0
      ? JSON.stringify(req.body)
      : undefined,
    isBase64Encoded: false,

    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: req.hostname,
      domainPrefix: "local",
      http: {
        method: req.method,
        path: req.path,
        protocol: `HTTP/${req.httpVersion}`,
        sourceIp: req.ip ?? "127.0.0.1",
        userAgent: req.get("user-agent") ?? "",
      },
      requestId: `local-${now.getTime()}`,
      routeKey: `${route.method} ${route.path}`,
      stage: "$default",
      time: now.toISOString(),
      timeEpoch: now.getTime(),

      // Driven by the manifest, so this cannot drift from what Terraform
      // attaches. A public route gets no authorizer key at all, because that is
      // what a public route on AWS looks like - injecting mock claims here
      // would let a handler depend on an identity that will not exist.
      ...(route.auth === "staff"
        ? { authorizer: { principalId: MOCK_CLAIMS.sub, integrationLatency: 0, jwt: { claims: MOCK_CLAIMS, scopes: [] } } }
        : {}),
    },
  };
}

/** Copies a Lambda result onto an Express response. */
export function sendLambdaResponse(res: Response, result: ApiResult): void {
  res.status(result.statusCode ?? 200);

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, String(value));
  }

  // send, never json: the body is already a string. res.json() would serialise
  // it a second time and the caller would get a quoted string.
  res.send(result.body ?? "");
}

function wrapHandler(route: Route, handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendLambdaResponse(res, await handler(createLambdaEvent(req, route)));
    } catch (error) {
      // Reaching here means the handler threw rather than returning a 500.
      // Deployed, that is an unhandled Lambda error and API Gateway answers 502
      // with nothing useful in it. Treat it as a bug in the handler, not as a
      // case to be smoothed over here.
      next(error);
    }
  };
}

/**
 * Registration order for Express. Exported so a test can assert it.
 *
 * The return type keeps the manifest's literal names rather than widening to
 * Route, which is what makes handlers[route.name] a checked lookup instead of
 * an unchecked index.
 */
export function registrationOrder(): (typeof routes)[number][] {
  return [...routes].sort(byStaticSegmentsFirst);
}

export function createApp(): express.Express {
  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Preflight only. Deployed, OPTIONS is answered by the HTTP API's own
  // cors_configuration and never reaches a Lambda - two implementations of one
  // policy, which is survivable only because both read the same origin list.
  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json());

  for (const route of registrationOrder()) {
    app[route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch"](
      toExpressPath(route.path),
      wrapHandler(route, handlers[route.name]),
    );
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  });

  return app;
}
