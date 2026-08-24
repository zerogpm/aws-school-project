---
paths:
  - "backend/**"
  - "modules/booking/**"
---

# Lambda Handlers

One copy of the code runs on AWS Lambda **and** locally inside Express. There is
no second implementation, no port, and no `isLocal` branch in any handler. A new
handler is not done when it works deployed, and not done when it works locally —
it is done when the same file does both and all three test layers cover it.

## The contract

```ts
(event: ApiEvent) => Promise<ApiResult>
```

A handler never sees `req`, `res`, `next` or a socket. It reads a plain object
and returns a plain object. That is what lets API Gateway, `backend/local/app.ts`
and a test literal all invoke the same function.

**Payload format 2.0** — this is an HTTP API, not a REST API.
`event.requestContext.http.method`, `event.rawPath`,
`event.requestContext.authorizer?.jwt?.claims`. Reference material written for
the v1 shape (`event.httpMethod`, `event.path`, `authorizer.claims`, an `as any`
cast on `requestContext`) does not apply here — mixing the two gives you handlers
reading `undefined` from fields the other version populates.

- `event.body` is a string or absent, never a parsed object. Always `JSON.parse`
  it yourself and guard for absent — `parseBody()` in `handlers/http.ts` does.
- `pathParameters` and `queryStringParameters` are **absent**, not `{}`, when
  empty. Optional-chain every access.
- The returned `body` must be a **string**. v2 permits a bare object; we never
  use it, because the local wrapper would then need a second code path.
- Look headers up case-insensitively — `getHeader()`.

## Adding an endpoint — every step has a failure mode

1. **Handler** in `backend/src/handlers/<domain>/<name>.ts`, exporting `handler`.
   CORS headers on every return path, guards and `catch` included — build every
   response through `ok()` / `badRequest()` / `serverError()` in `handlers/http.ts`.
   *Skip it and a 500 reaches the browser as an opaque network error rather than
   as a 500, and the hours go into the wrong layer.*
2. **Unit test** it with a synthetic event from `handlers/test-event.ts`,
   including absent body, absent path parameters and missing claims.
   *Those are the shapes AWS sends and a happy-path test never produces.*
3. **Manifest entry** in `backend/src/routes.ts` — `name`, `method`, `path` in
   gateway syntax, `entry`, `auth`, `access`, `env`, `timeout`.
   *This one entry is what gives you the local route, the Lambda, the log group,
   the IAM role and the API Gateway route. There is no second list to update.*
4. **`npm run routes:emit`.** *Terraform reads the committed `routes.json`; a
   stale one deploys yesterday's route list.*
5. **`npm test`.** The parity test imports your handler in isolation and fails if
   it read an env var the manifest does not declare. *That check is the only
   thing standing between you and a variable that is set process-wide locally and
   `undefined` in production.*
6. **Exercise it against the real local table**: `./app.sh --start`, then
   curl it. *Confirm the route appears in the boot banner — if it does not, the
   manifest entry is missing.*
7. **e2e** in `site/e2e/api.spec.ts`, against the running API.

Anything the manifest cannot express — a raw-body webhook whose HMAC covers the
exact bytes, a local-only dev affordance, a non-HTTP trigger — is a deliberate,
commented exception, not a quiet one.

## Commands

None of these touch AWS or cost anything — the datastore is DynamoDB Local in
Docker.

```
./app.sh --start           database, tables, seed, and the API on :3000
./app.sh --start --web     also the front end on :5173
./app.sh --status          what is running, and what is in the database
./app.sh --scan [table]    dump a table
./app.sh --stop [--wipe]   stop; --wipe also deletes the database
```

```
cd backend
npm test                   all three test layers
npm run typecheck
npm run dev                the API on :3000, watch mode
npm run routes:emit        regenerate routes.json after editing routes.ts
npm run build:handlers     bundle src/ into dist/<route>/index.mjs
```

The API prints its route table at boot. A handler that does not appear there was
never added to `backend/src/routes.ts`.

## The three seams, and nowhere else

Only three things genuinely differ between the runtimes. Each lives in exactly
one file, and handlers stay ignorant of all of them.

| Seam | File | Local | Deployed |
| --- | --- | --- | --- |
| Datastore | `src/db.ts` | `DYNAMODB_ENDPOINT` set → container | unset → real AWS |
| Identity | `src/handlers/auth.ts` | wrapper injects claims | verified JWT from the authorizer |
| Config | `src/env.ts` | `local/env.ts` sets defaults | Terraform `environment` block |

## Environment variables — the seam that bites

Deployed, a function receives **only** what its own Terraform block declares.
Locally, every handler shares one process and sees everything. So a variable
nobody wired works perfectly on your machine and is `undefined` in production.

- **Fail loud.** `requireEnv()`, which throws at module load. Never
  `if (!VAR) return;` — that turns a forgotten wire into a feature that silently
  does nothing, and if the guard protected an auth check, into a fail-open hole.
- **Read it at module load**, not lazily inside a function. The parity test can
  only see what was requested during import.
- **Transitive counts.** A handler "uses" a variable if anything it imports reads
  one. List it in the manifest's `env` anyway — the test will tell you.
- **Grant the matching permission too.** A declared table name with no IAM grant
  is invisible locally (the container allows everything) and
  `AccessDeniedException` deployed.

## Reject on sight

- `if (process.env.IS_LOCAL)` inside a handler. Branching lives in the three
  seams. Every such branch is untested code in one of the two runtimes.
- A second implementation "just for local". The moment two copies exist they
  diverge, and the deployed one is the untested one.
- `req` or `res` in a handler, or anything in `src/` importing from `local/`.
  The arrow points one way: `local/` → `src/`, never back.
- `createApp()` acquiring a side effect — connecting, seeding, listening. It
  destroys supertest-ability and makes local boot undebuggable.
- Mock claims on a route that is public in production. The wrapper must model the
  absence of identity too.
- `localhost` instead of `127.0.0.1` for the local container.
- Seeding by delete-then-insert. Idempotent upserts, so a restart never destroys
  work in progress.
- `beforeEach(() => spy.mockReset())` — the concise arrow returns the mock, and
  vitest treats a function returned from a hook as that hook's *teardown*, so it
  calls your spy after every test. Always use a block body.

## What local cannot reproduce

Timeouts, the ~6 MB payload cap, IAM, cold starts, container isolation, real
token expiry, and async retries. Do not try to make the wrapper simulate them —
deploy a stage instead. `backend/README.md` has the full table.
