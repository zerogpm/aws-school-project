---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
---

# Terraform

Each `0X-*` directory is its own Terraform root with its own state. Run
`terraform` from inside the stage directory, not the repo root. Run
`terraform fmt` before finishing.

Shared infrastructure belongs in `modules/`, consumed by the stage roots — do
not copy resource blocks between stages.

**Env vars (blocker):** every Lambda handler env var must be declared in the
Terraform that creates the function AND asserted in a test. A handler reading a
var that no `.tf` file sets is a defect even if the code looks correct — and it
is invisible locally, where every handler shares one process and sees every
variable.

**Lambda routes come from the manifest, not from here.** `modules/booking/`
reads `backend/routes.json` and creates one function, log group, role and route
per entry. Do not hand-write a `aws_lambda_function` or `aws_apigatewayv2_route`
block for a new endpoint — add it to `backend/src/routes.ts` and run
`npm run routes:emit`. A handler must work in both runtimes before it is done;
see `.claude/rules/handlers.md`.

**Secrets:** never in committed `.tf` files. Use `terraform.tfvars` (gitignored)
or Parameter Store.

## Spending money (blocker)

**Never create, modify, or destroy real AWS resources without asking first.**
Ask, wait for a yes, and say which stage is involved. Applying is the user's
decision every time — a yes for one stage is not a yes for the next one.

Needs permission — these touch the account:

- `terraform apply`, `terraform destroy`, `terraform import`, `terraform taint`
- any state-mutating command (`state rm`, `state mv`, `apply -replace`)
- `aws` CLI calls that create, upload, delete, or invalidate
- `scripts/deploy-site.sh`, which uploads to S3 and invalidates CloudFront

Fine without asking — these are local and free:

- `terraform fmt`, `terraform fmt -check -recursive`
- `terraform validate` (offline: syntax and provider schema only, no
  credentials, no API calls)
- reading `.tf` files, `terraform.tfstate`, and lock files

In between — free and read-only, but it does hit AWS with real credentials, so
say so before running it:

- `terraform plan` (the stage roots read `aws_caller_identity`)
- read-only `aws` CLI calls (`s3 ls`, `s3api list-object-versions`,
  `cloudfront get-distribution`)

Two things make a forgotten stack expensive here rather than merely untidy: the
stages are cumulative, so a later one leaves Lambda, DynamoDB, and Cognito
running as well as buckets; and the budget for the entire system is under
$20/month, so one stack left up overnight is a real fraction of it.

`terraform validate` passing is not evidence that an apply would succeed — S3
rejects some configurations server-side that the provider schema accepts. Say
which of the two was actually run.
