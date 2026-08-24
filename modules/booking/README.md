# Booking Module

The single DynamoDB table, the HTTP API in front of it, and one Lambda per
route. Consumed by `03-data/` onward.

## One route list, two runtimes

`backend/src/routes.ts` is the only place an endpoint is declared. The local
Express wrapper imports it directly; `build.tf` reads the emitted
`backend/routes.json`, because Terraform cannot run node at plan time.

```
backend/src/routes.ts ──emit──▶ backend/routes.json ──jsondecode──▶ build.tf
        │
        └── imported by backend/local/app.ts
```

Everything below is `for_each` over that map: the function, its log group, its
role, its policies, the integration, the route, and the invoke permission. Add
an entry, run `npm run routes:emit`, and both runtimes gain the endpoint.

The alternative — two hand-maintained lists — produces exactly one of two bugs.
Local-only: works all through development, then 404s in production. IaC-only:
deployed and reachable, and its first real traffic is production traffic.

## The Lambda nothing calls

`consumers.tf` creates one function per entry in `backend/consumers.json`, the
non-HTTP half of the same manifest. Today there is one: `booking-email`, woken
by the table's own stream.

It is a parallel of `lambda.tf` rather than an extension of it. Those resources
are keyed `for_each = local.routes` and `routes.parity.test.ts` asserts those
expressions by string, so widening them would break the assertions that make the
route half trustworthy.

Two absences carry the lesson:

- **No `aws_apigatewayv2_*`.** There is no URL. Nothing routes to it.
- **No `aws_lambda_permission`.** API Gateway *pushes*, so it needs a resource
  policy naming it as an allowed caller. An event source mapping *pulls*, using
  the function's own execution role — so authorisation lives in the role, and a
  resource policy here would be cargo cult. A parity test asserts it stays
  absent.

The whole block evaporates unless a stage passes an SES identity, which is why
`03-data` and `04-booking` can call this module unchanged.

Settings that are not defaults, and why:

| | |
| --- | --- |
| `starting_position = "LATEST"` | `TRIM_HORIZON` on a replaced mapping re-reads a day of stream and re-confirms every booking in it |
| `filter_criteria` on the `BOOKING#` prefix | one booking writes four items; three of them carry no address and should not cost an invocation |
| `maximum_retry_attempts = 3` | the default is retry-until-expiry — 24 hours of one poison record blocking the shard |
| `bisect_batch_on_function_error` | isolates that record instead of failing its neighbours with it |
| `ReportBatchItemFailures` | lets the handler name which records failed |
| `maximum_batching_window_in_seconds` | a cost control: the poller would otherwise call `GetRecords` several times a second, all year, against a table idle most of it |
| `depends_on` the stream policy | the mapping references the stream and the function, never the policy, so it otherwise races its own IAM grant |

`dynamodb:ListStreams` is granted on `"*"` — it enumerates, so there is nothing
to scope it to, and naming the stream ARN leaves the mapping stuck in `Creating`
with a message that never mentions the line.

## Environment variables are the dangerous part

Deployed, each function receives only what its own `environment` block declares.
Locally every handler shares one process and sees every variable, so a missing
wire is invisible until it is in production behaving as though the feature is
switched off.

Three things have to agree, and each one fails loudly if it does not:

| Where | What enforces it |
| --- | --- |
| The handler reads it | `requireEnv()` throws at module load — no `if (!VAR) return;` |
| The route declares it | `env: [...]` in `routes.ts` |
| Terraform supplies it | `local.env_values[key]` — an unknown name fails the plan |
| A test pins it | `src/routes.parity.test.ts` imports each handler in isolation and compares what it actually asked for |

That last one matters most. A handler "uses" a variable if anything it imports
reads one, and tracing that by hand is the step everyone skips.

## Choices worth stating

**HTTP API, not REST.** Roughly a third the price per million requests, and the
JWT authorizer is built in rather than being a Lambda of its own. What is given
up — request validation, usage plans, per-key quotas — this system was never
going to use.

**Payload format 2.0 everywhere.** The handlers, the local wrapper and the
integration all speak v2. Setting `payload_format_version` to `1.0` leaves every
handler reading `undefined` from `requestContext.http`.

**arm64 and `--external:@aws-sdk/*`.** Graviton is about a fifth cheaper for
identical work, and the runtime already ships AWS SDK v3, so excluding it keeps
each zip at a couple of kilobytes instead of several megabytes.

**A role per function, with only the verbs it uses.** The grant is documentation
of what the handler does. Blanket read-write "to be safe" removes the signal,
and a missing grant is invisible locally — the container accepts dummy
credentials and allows everything — surfacing deployed as `AccessDeniedException`.

**Explicit log groups with retention.** Left to Lambda they appear with no
retention and outlive `terraform destroy` as orphans nobody agreed to pay for.

**Throttling is a spend guard, not a capacity limit.** The public routes need no
account, so what is being throttled is a stranger with a loop against a budget
of under $20 a month.

**No access logging, no dashboard, no paging alarm.** Access logs bill per
ingested GB to answer questions nobody here is asking; `console.error` lands in
the function's own log group with a week of retention.

## Schema drift is on you

`backend/src/schema.ts` is a hand-written mirror of `table.tf`. Nothing keeps
them in sync — change one without the other and local passes while deployed
breaks, so change both in the same commit.
