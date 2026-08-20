# CLAUDE.md

Topic rules live in `.claude/rules/` and load automatically: `testing.md` and
`debugging.md` every session; `terraform.md` when a `.tf` or `.tfvars` file is
opened; `data-model.md` when working in `03-data/`, `04-booking/`,
`05-waitlist/`, or `modules/booking/`.

## Quality Checklist

Always run the full test suite after changes and confirm all tests pass before
reporting completion. Show actual test output as proof — never "this should work".

**Golden Rules — violating these is a blocker:**

1. All changes require both unit tests AND e2e tests. (see `.claude/rules/testing.md`)
2. Data bugs require inspecting the actual datastore FIRST, before reading code.
   (see `.claude/rules/debugging.md`)
3. Handler env vars MUST be wired in IaC + asserted in a test.
   (see `.claude/rules/terraform.md`)
4. NEVER create, modify, or destroy real AWS resources without asking first.
   Nothing in this repo is free to leave running. (see `.claude/rules/terraform.md`)
5. NEVER run `git commit`, `git push`, `git merge`, `git rebase`, or anything
   else that writes to history or a remote. Staging and committing are the
   maintainer's job alone. The commit log is part of the series narrative — each
   commit marks an episode beat — so it is authored deliberately, not generated
   as a side effect of a change. Read-only git (`status`, `diff`, `log`) is fine.

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

Current state: scaffold only. Every directory holds a placeholder README and
nothing else — no `.tf` files, no application code, no test runner, no CI.

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
modules/booking/          reusable booking and waitlist infrastructure
MISTAKES.md               running log of errors, surprises, and decisions
```

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
  validation.
- **Async:** DynamoDB Streams → Lambda → SES for confirmations and waitlist
  promotion. No SQS.
- **Guardrails** (this is the entire monitoring story): AWS Budgets alarm →
  email, Route53 health check → SNS email, DynamoDB point-in-time recovery. No
  dashboards, no paging alarms.

Deliberately out of scope: CI/CD, dashboards, paging alarms, multi-region, RDS,
containers, Kubernetes, VPC, waitlist claim expiry, parent accounts, payments,
grades. Each cut is stated on camera with its reason — the cuts are the content.

## Key Files

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | This file — rules and project context |
| `README.md` | Human-facing project summary |
| `MISTAKES.md` | Build notes; append errors and decisions as they happen |
| `.gitignore` | Excludes `.terraform/`, state files, and `*.tfvars` |

## Environment Variables

None defined yet. AWS access resolves through the standard credential chain
(`AWS_PROFILE`, `AWS_REGION`, `~/.aws/config`).

Once Lambda handlers exist, Golden Rule 3 applies: every handler env var must be
declared in the Terraform that creates the function AND asserted in a test.
Secrets belong in `terraform.tfvars` or Parameter Store, never in committed
`.tf` files.
