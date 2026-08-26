# CLAUDE.md

Topic rules live in `.claude/rules/` and load automatically: `testing.md` and
`debugging.md` every session; `terraform.md` when a `.tf` or `.tfvars` file is
opened; `data-model.md` when working in `03-data/`, `04-booking/`,
`05-email/`, or `modules/booking/`; `handlers.md` when working in `backend/`
or `modules/booking/`.

## Quality Checklist

Always run the full test suite after changes and confirm all tests pass before
reporting completion. Show actual test output as proof — never "this should work".

**Golden Rules — violating these is a blocker:**

1. All changes require both unit tests AND e2e tests. (see `.claude/rules/testing.md`)
2. Data bugs require inspecting the actual datastore FIRST, before reading code.
   (see `.claude/rules/debugging.md`)
3. Handler env vars MUST be wired in IaC + asserted in a test — including the
   ones read transitively through a shared helper.
   (see `.claude/rules/terraform.md`, `.claude/rules/handlers.md`)
4. A new Lambda MUST work in BOTH runtimes before it is done. One copy of the
   code runs on AWS and locally inside Express — never a second implementation,
   never an `isLocal` branch in a handler. Adding a handler means: the manifest
   entry in `backend/src/routes.ts`, `npm run routes:emit`, the Terraform that
   picks it up, unit + wrapper + parity tests, and actually curling it against
   the local table. "It works deployed" is half done; so is "it works locally".
   (see `.claude/rules/handlers.md`)
5. NEVER create, modify, or destroy real AWS resources without asking first.
   Nothing in this repo is free to leave running. (see `.claude/rules/terraform.md`)
6. NEVER run `git commit`, `git push`, `git merge`, `git rebase`, or anything
   else that writes to history or a remote. Staging and committing are the
   maintainer's job alone. The commit log is part of the series narrative — each
   commit marks an episode beat — so it is authored deliberately, not generated
   as a side effect of a change. Read-only git (`status`, `diff`, `log`) is fine.
7. NEVER write a claim that the system holds a kind of data without first finding
   the thing that produces it. Before a README, run sheet, diagram or narration
   line says the build stores something, go look for the writer — a handler, an
   uploader, a seeded object. No writer means the layout is **provisioned, not
   populated**, and it has to be said that way. `docs/` is the only prefix with a
   producer: the staff PDF upload, pinned in `backend/src/media.ts` and gated on
   a `%PDF-` byte check. `photos/` and `video/` have real lifecycle rules and a
   CloudFront behaviour each, and nothing in the repo ever writes to them.

   When you find a claim like that, don't just delete it. Rewrite it so the
   provisioned layout reads as a layout decision — that version is stronger, not
   weaker, because a prefix layout is the one thing that cannot be changed once
   the objects exist — and add the unbuilt feature to the cuts, where it belongs.
   Then bring the rewrite to me instead of applying it silently. This is a
   portfolio repo and the narration is filmed; a claim about data that isn't
   there is the one error the camera makes permanent.

## General Behaviour

Focus on the specific scope requested. Do NOT modify unrelated code, run builds,
or generate artifacts during verification unless asked.

## Communication Style

Simple question → concise answer first. Don't explore the codebase or enter plan
mode unless the question requires it.

## Project Overview

A school website for a fictional-but-realistic school, built on AWS with
Terraform and filmed as a YouTube series. The repo is the primary artifact — a
portfolio piece. The front end is a prop: keep it minimal. The infrastructure
and the reasoning behind it are the product.

Six episode stages, `01-storage` through `06-cost`. They are **cumulative, not
independent**: each stage deploys the whole stack up to that point by calling
modules from `modules/`, so `cd 04-booking && terraform apply` works without
running 01–03 first. `06-cost` is the complete system.

Because every stage creates the same globally-unique names (S3 buckets, Cognito
pool, Route53 records), only ONE stage may be applied at a time. Apply, verify,
destroy, then move to the next. Each stage also needs its own backend key or
they will fight over state.

Region is `ca-central-1` — data must stay in Canada. Not negotiable.

Current state: episodes 01 through 05 are built — the static site, Cognito, the
single table, an HTTP API, the Lambda handlers with their local Express runtime,
the booking transaction, and a table stream feeding a Lambda that mails parents
through SES. `05-email` is built but has not been applied. `06-cost` is still a
placeholder README. No CI, by choice.

## Business Model

Serves 800 students, 60 staff, and their parents. One teacher maintains it;
there is no IT staff.

- **Public, read-only:** school info, published timetable
- **Public, write (throttled):** a parent books a parent-teacher interview slot,
  gated by an existing student number — no account required
- **Staff only (Cognito):** publish the timetable, open interview windows, view
  rosters, upload media

Parents do NOT schedule courses — scheduling is staff work. Parents book
interview slots and club/activity spots.

**Constraints that drive every decision:**

- Budget under $20/month; target under $10
- ~40GB of photos and event video, growing ~15GB/year, rarely read after the
  first month
- Near-dead traffic most of the year, spiking to ~300 parents in one evening,
  twice a year
- Cannot lose a booking. Can lose analytics.
- No VPC anywhere — a NAT Gateway alone is ~$32/mo, more than the whole system

## Repository Structure

```
01-storage/ .. 06-cost/   cumulative episode stages; 06-cost is the full stack
modules/static-site/      reusable static site infrastructure
modules/auth/             reusable staff authentication infrastructure
modules/booking/          table, HTTP API, one Lambda per route, one per consumer
modules/email/            SES identity and its DKIM records
backend/src/handlers/     THE ONLY COPY of the handler code
backend/src/consumers/    Lambdas nothing calls over HTTP. a stream wakes them
backend/src/routes.ts     THE ONLY LIST of endpoints AND consumers
backend/local/            the Express wrapper. imports src/, never the reverse
backend/scripts/          emit routes.json, bundle handlers with esbuild
site/                     the front end. a prop; keep it minimal
scripts/                  deploy and teardown helpers
app.sh                    the local stack: database, API, front end
MISTAKES.md               running log of errors, surprises, and decisions
```

`backend/src/routes.ts` is the pivot: imported by the local wrapper, and — via
the emitted `backend/routes.json` — read by `modules/booking/lambda.tf`. One
list, so an endpoint cannot exist in one runtime and not the other.

## Build Commands

Each stage is its own Terraform root with its own backend key, so run commands
from inside the stage directory, not the repo root. Only one stage may be
applied at a time — they collide on globally-unique names.

```
cd 01-storage
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
```

`*.tfvars` is gitignored, so each stage needs its own local `terraform.tfvars`
that is never committed.

Backend and front-end commands are in `.claude/rules/handlers.md`, which loads
when you are working in `backend/`. None of them touch AWS or cost anything.

## Tech Stack

- **IaC:** Terraform in `ca-central-1`. Pin `required_version` and provider
  versions in every stage so old episodes stay reproducible.
- **Site + media:** S3 + CloudFront with OAC, Route53 for DNS. Versioning on.
  Media lifecycle Standard → Standard-IA at 30d → Glacier IR at 90d. Uploads go
  direct to S3 via presigned URLs, never through Lambda.
- **Auth:** Cognito user pool with hosted UI, staff only (~60 accounts),
  `allow_admin_create_user_only = true`. No parent or student accounts.
- **API + compute:** API Gateway HTTP API → Lambda → DynamoDB on-demand. Public
  routes throttled (low burst + rate limit) with student-number format
  validation. **Payload format 2.0**, nodejs22.x on arm64, `@aws-sdk` left
  external because the runtime ships it. Handlers are pure
  `(event) => Promise<result>` functions, so the same file runs on Lambda, in
  the local Express wrapper, and in a test with no HTTP at all.
- **Async:** DynamoDB Streams → Lambda → SES for booking confirmations. No SQS.
- **Guardrails** (this is the entire monitoring story): AWS Budgets alarm →
  email, Route53 health check → SNS email, DynamoDB point-in-time recovery. No
  dashboards, no paging alarms.

Deliberately out of scope: CI/CD, dashboards, paging alarms, multi-region, RDS,
containers, Kubernetes, VPC, the interview waitlist, parent accounts, payments,
grades, and the photo/video gallery — `photos/` and `video/` are a provisioned
prefix layout, never a built feature. Each cut is stated on camera with its
reason — the cuts are the content.

## Key Files

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | This file — rules and project context |
| `README.md` | Human-facing project summary |
| `MISTAKES.md` | Build notes; append errors and decisions as they happen |
| `.gitignore` | Excludes `.terraform/`, state files, and `*.tfvars` |
| `app.sh` | The local stack — database, API, front end. Touches no AWS |
| `backend/src/routes.ts` | The one endpoint list. Edit, then `npm run routes:emit` |
| `backend/routes.json` | Generated and committed; Terraform cannot run node |
| `backend/local/app.ts` | The wrapper. One half of the bridge between runtimes |
| `modules/booking/lambda.tf` | The other half — one Lambda per manifest entry |
| `backend/src/routes.parity.test.ts` | Enforces Golden Rules 3 and 4 |

## Environment Variables

AWS access resolves through the standard credential chain (`AWS_PROFILE`,
`AWS_REGION`, `~/.aws/config`).

Handler variables so far: `ALLOWED_ORIGINS`, `TABLE_NAME`, `MEDIA_BUCKET`,
`MEDIA_BASE_URL`, and — read only by the stream consumer, which has no request
and therefore no origin — `SES_FROM_ADDRESS` and `SITE_BASE_URL`. Locally they
are set by `backend/local/env.ts` alongside `DYNAMODB_ENDPOINT`, which is the
single switch that points the SDK at the container; deployed, `DYNAMODB_ENDPOINT`
is unset and the rest come from `modules/booking/lambda.tf`. The test suite
supplies the same names through `backend/vitest.config.ts` — miss one there and
every test importing that handler throws at module load.

Golden Rule 3 is enforced mechanically and fails loudly at each of three points
— `requireEnv()` throws at module load, Terraform fails the plan on a name it
has no value for, and `backend/src/routes.parity.test.ts` catches one read
transitively through a shared helper. The mechanics are in
`.claude/rules/handlers.md`.

Secrets belong in `terraform.tfvars` or Parameter Store, never in committed
`.tf` files.
