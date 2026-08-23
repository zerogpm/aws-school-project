# Backend

One copy of the handler code, running unmodified on AWS Lambda behind API
Gateway and locally inside Express. There is no second implementation, no port,
and no `isLocal` branch in any handler.

```
src/handlers/     the only copy of the business logic
src/routes.ts     the only list of endpoints - both runtimes read it
src/db.ts         seam 1: which datastore
src/handlers/auth.ts   seam 2: who is calling
src/env.ts        seam 3: what is configured
local/            the Express wrapper. imports from src/, never the reverse
scripts/          emit the route JSON, bundle the handlers
```

## The contract

Every endpoint is a function of one shape:

```ts
(event: ApiEvent) => Promise<ApiResult>
```

It never sees `req`, `res`, `next` or a socket. It reads a plain object and
returns a plain object. Because that is the whole contract, three different
things can run it:

| Runtime | Who builds the event |
| --- | --- |
| AWS | API Gateway, then it serialises the result |
| Local | `local/app.ts`, from an Express request |
| Tests | a literal, in process - no HTTP, no server, no transport mocking |

The payoff is the third row: business logic is testable as a pure function.
Reaching for `req.headers` inside a handler, or calling `res.json()`, collapses
all of it.

Payload format **2.0** throughout, because this is an HTTP API rather than a
REST API. `event.requestContext.http.method`, `event.rawPath`,
`event.requestContext.authorizer.jwt.claims`. Material written for the v1 shape
does not apply and mixing the two produces handlers that read `undefined` from
fields the other version populates.

## One route list

`src/routes.ts` is the only place an endpoint is declared. `local/app.ts`
imports it; `modules/booking/build.tf` reads the emitted `routes.json`, because
Terraform cannot run node at plan time.

Three bug classes are structurally impossible rather than merely tested for:

- **Path syntax.** The Express form (`/windows/:id`) is derived from the gateway
  form (`/windows/{id}`), and so is the parameter list. Neither is typed twice.
- **Registration order.** Express matches in registration order, so
  `/windows/{id}` registered before `/windows/open` swallows it and dispatches
  with `id="open"`; API Gateway prefers the static segment and routes it
  correctly. The order is computed, not remembered.
- **A handler with no route, or a route with no handler.** `app.ts` holds a
  `Record<RouteName, Handler>`, so either one fails `tsc`.

After editing `routes.ts`: `npm run routes:emit`. Forgetting fails
`src/routes.parity.test.ts`, not the deploy.

## Environment variables are the dangerous seam

Deployed, a function receives only what its own Terraform block declares.
Locally, every handler shares one process and sees everything `local/env.ts`
set. So a variable nobody wired works perfectly on your machine and is
`undefined` in production — and a handler written as `if (!VAR) return;` then
silently does nothing, with no error and no log.

Hence `requireEnv()`, which throws at module load. A missing wire breaks the
first request loudly, with the variable named, instead of changing behaviour for
months. Reserve a soft fallback for genuinely optional telemetry, and nothing
else.

A handler "uses" a variable if anything it imports reads one. Tracing that by
hand is the step everyone skips, so `src/routes.parity.test.ts` imports each
handler into a fresh module registry and asks it what it actually wanted.

## What local does not reproduce

Each of these has produced a production-only incident somewhere.

| Gap | Local | AWS |
| --- | --- | --- |
| Timeout | none | hard kill at the configured limit |
| Payload size | unlimited | ~6 MB request and response |
| IAM | dummy credentials, everything allowed | least privilege, `AccessDeniedException` |
| Cold start | never | the first invoke pays module-load cost |
| Isolation | one process, shared module state | many containers, per-container state |
| Authorizer | mocked, always valid | validates and returns 401 itself |
| Retries | none | async invocations retry |

Token expiry and 401-refresh flows are not testable here. Test them against a
deployed stage.

## Commands

```
npm run dev              the API on :3000, watch mode
npm start                the API on :3000, no watcher
npm test                 all three test layers
npm run typecheck        tsc --noEmit
npm run routes:emit      regenerate routes.json from routes.ts
npm run build:handlers   bundle src/ into dist/<route>/index.mjs
```

Or from the repo root, `./app.sh --start --api`, which brings up the database
first and probes `/health` before reporting the API as up.

## Testing

Three layers, each cheap, all in `npm test`.

**Handlers**, as pure functions. Build the event literal, call it, assert on the
object. `src/handlers/test-event.ts` defaults to the awkward shapes on purpose —
no body, no path parameters, no authorizer — because those are what API Gateway
actually sends and what a test written from the happy path never produces.

**The wrapper**, with supertest against `createApp()`. Only possible because the
factory has no side effects: it connects to nothing, seeds nothing, listens on
nothing. Protect that.

**Parity with the IaC**, in `src/routes.parity.test.ts`. There is no
`Template.fromStack` for Terraform, so this reads `modules/booking/*.tf` and
asserts what a CDK assertion test would: every declared variable has a value,
every route exists, the authorizer is attached to staff routes and absent from
public ones, log groups have retention.

End to end lives with the front end, in `site/e2e/api.spec.ts` — real HTTP, real
wrapper, real container. It skips when the API is not running.

## Local DynamoDB

Needs Docker running. Nothing here touches AWS — no account, no credentials.

One script, from the repo root:

```
./app.sh --start           database and tables
./app.sh --start --api     also launch the backend API, detached
./app.sh --start --web     also launch the front end, detached
./app.sh --status          containers, ports, tables
./app.sh --scan [table]    dump a table
./app.sh --stop            stop everything, keep the data
./app.sh --stop --wipe     stop everything and delete the database
```

`--stop` also frees ports 3000, 5173, 4173 and 8001, which a killed terminal
leaves occupied. Docker is cross-platform and needs no branch; only the port cleanup
differs by OS, so that is the one thing behind an `IS_WINDOWS` check.

`--web` is opt-in on purpose. A dev server belongs in the foreground of its own
terminal, where its output is visible and Ctrl-C works — detached, its errors go
to `.local-web.log` and nobody reads it. When it is used, vite is started with
`--host 127.0.0.1`, because it otherwise binds `localhost`, which on Windows is
`::1`, and every readiness probe here is IPv4.

Or the npm scripts directly from `backend/`: `db:up`, `db:down`, `db:wipe`,
`db:tables`.

None of this touches AWS. Tearing down the deployed stack is `terraform
destroy`, and `./scripts/check-destroyed.sh` confirms it worked.

### One compose file, not one per OS

Docker is cross-platform and `local/docker-compose.yml` needs no per-platform
variant. Every line in it earns its place:

| | Why |
| --- | --- |
| `-sharedDb` | Without it DynamoDB Local shards by access-key-id and region, so the app, the tests and `dynamodb-admin` each see a different empty database |
| `-dbPath /data` + named volume | Both, or it runs in memory and every restart is a fresh empty database |
| `user: root` | The image's default user cannot write to a mounted volume. This is the real fix for volume-permission errors on Windows, macOS and Linux alike — and the reason no Windows-specific compose file is needed |
| `127.0.0.1:8000:8000` | Binds to loopback, so a laptop on school wifi is not serving an unauthenticated database to the network |

### The local-vs-AWS switch

One environment variable, one file. [`src/db.ts`](src/db.ts) returns an empty
config when `DYNAMODB_ENDPOINT` is unset, so a deployed Lambda takes the same
code path against real AWS. There is no `isLocal` branch anywhere else, and
there should not be.

### Schema drift is on you

[`src/schema.ts`](src/schema.ts) is a hand-written mirror of the Terraform in
`modules/booking`. Nothing keeps them in sync. Change one without the other and
local passes while deployed breaks — so change both in the same commit.

## Inspecting the data

When data looks wrong, look at the data before reading the code. Reading code
first produces plausible theories about rows that are not there.

```
./app.sh --scan local-school
```

Or the raw API — swap `X-Amz-Target` for `GetItem`, `PutItem`, `Query`,
`ListTables`:

```
curl -s -X POST http://127.0.0.1:8000/ \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.Scan" \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=local/x/ca-central-1/dynamodb/aws4_request, SignedHeaders=, Signature=x" \
  -d '{"TableName":"local-school","Limit":5}'
```

Values are typed on the wire: `{"S":"text"}`, `{"N":"42"}`, `{"BOOL":true}`.

A web UI, if you prefer one:

```
DYNAMO_ENDPOINT=http://127.0.0.1:8000 AWS_ACCESS_KEY_ID=local \
AWS_SECRET_ACCESS_KEY=local AWS_REGION=ca-central-1 \
npx --yes dynamodb-admin --port 8001
```

## Gotchas

Each of these cost someone real debugging time.

- **`127.0.0.1`, never `localhost`.** On Windows `localhost` resolves to `::1`
  first and the container is IPv4-only. The error says nothing about IPv6.
- **A bare `GET http://127.0.0.1:8000` returns HTTP 400, and that means
  healthy.** It is rejecting an unsigned request. Use any response as the
  readiness probe; waiting for a 200 waits forever.
- **Dummy credentials are still required.** DynamoDB Local ignores the values,
  but the SDK refuses to sign with an empty credential chain.
- **Numbers travel as strings**: `{"N":"42"}`, not `{"N":42}`.
- **GSI key types must match exactly.** Write a timestamp as `{N}` against a key
  declared `{S}` and the row silently never appears in the index — no error,
  just an empty query.
- **TTL is accepted but swept lazily.** Never assert expiry in a local test.
- **E2E specs share one database.** Parallel specs writing the same key
  contaminate each other. Use a per-spec key prefix, or run serially.
- **`down` keeps the data, `wipe` drops it.** `docker compose down` without `-v`
  leaves the named volume, so a "clean" restart is not clean.
- **Give `beforeEach` a block body.** `beforeEach(() => spy.mockReset())` returns
  the mock, and vitest treats a function returned from a hook as that hook's
  *teardown* — so it calls your spy after every test. With a rejecting
  implementation in place that fails a test whose body already passed, and
  reports the error at the line where it was constructed.
