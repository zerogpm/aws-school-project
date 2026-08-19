# CLAUDE.md

Topic rules live in `.claude/rules/` and load automatically: `testing.md` and
`debugging.md` every session, `terraform.md` only when a `.tf` or `.tfvars`
file is opened.

## Quality Checklist

Always run the full test suite after changes and confirm all tests pass before
reporting completion. Show actual test output as proof — never "this should work".

**Golden Rules — violating these is a blocker:**

1. All changes require both unit tests AND e2e tests. (see `.claude/rules/testing.md`)
2. Data bugs require inspecting the actual datastore FIRST, before reading code.
   (see `.claude/rules/debugging.md`)
3. Handler env vars MUST be wired in IaC + asserted in a test.
   (see `.claude/rules/terraform.md`)

## General Behaviour

Focus on the specific scope requested. Do NOT modify unrelated code, run builds,
or generate artifacts during verification unless asked.

## Communication Style

Simple question → concise answer first. Don't explore the codebase or enter plan
mode unless the question requires it.

## Project Overview

A school website built on AWS with Terraform. The build is split into six
standalone episode stages, `01-storage` through `06-cost`, each with its own
Terraform root and state. `modules/` holds the reusable modules the stages
consume.

Current state: scaffold only. Every directory contains a placeholder README and
nothing else — there are no `.tf` files, no application code, no test runner,
and no CI in the repo yet.

## Business Model

TODO — not yet documented. Needs: who the site serves (students, parents,
staff), and what the booking and waitlist flows are actually for.

## Repository Structure

```
01-storage/ .. 06-cost/   standalone episode stages, one Terraform root each
modules/static-site/      reusable static site infrastructure
modules/auth/             reusable staff authentication infrastructure
modules/booking/          reusable booking and waitlist infrastructure
MISTAKES.md               running log of errors, surprises, and decisions
```

## Build Commands

Each stage is its own Terraform root, so run commands from inside the stage
directory, not the repo root:

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

- **IaC:** Terraform
- **Cloud:** AWS
- **AWS services:** TODO — not yet chosen or committed to code. Do not assume
  services from the episode directory names; confirm before building on them.

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
