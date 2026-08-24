# Episode 03: Data

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

The stage that turns the site from a prop into a system: the single DynamoDB
table, an HTTP API in front of it, and the first Lambda handlers — with the same
handler code running locally inside Express.

## What this stage adds

| | |
| --- | --- |
| `modules/booking` | the table, the HTTP API, one Lambda per route |
| `backend/src/handlers` | the only copy of the handler code |
| `backend/local` | the Express wrapper that runs it on a laptop |

Two endpoints, chosen to prove the harness rather than to be a feature:
`GET /health`, public because the Route53 health check has no token to present,
and `GET /windows`, staff-only, which reads GSI1 against the real table.

## Applying it

```
cd 03-data
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply
```

The apply bundles `backend/src` with esbuild, so node has to be on the machine
running Terraform. Set `build_handlers = false` if it is not, and put a bundle in
`backend/dist` yourself with `npm run build:handlers`.

Only one stage may be applied at a time — they collide on globally unique names.
Apply, verify, destroy, then move on.

Verify with the outputs rather than the console:

```
curl -s "$(terraform output -raw api_url)/health"
```

`/windows` needs a bearer token from a staff account, so a 401 there is the
authorizer working, not a failure.

## Developing against it without applying anything

```
./app.sh --start
curl -s http://127.0.0.1:3000/health
```

That is the same handler code, in the same shape, against DynamoDB Local. It
costs nothing and touches no AWS account. What it cannot reproduce — timeouts,
IAM, cold starts, real token expiry — is listed in
[`backend/README.md`](../backend/README.md).

## One route list, not two

`backend/src/routes.ts` is the only place an endpoint is declared. The Express
wrapper imports it; `modules/booking/build.tf` reads the emitted
`backend/routes.json`. Maintaining two lists produces exactly one of two bugs —
an endpoint that works all through development and 404s in production, or one
that is deployed and reachable whose first real traffic is production traffic.

Adding an endpoint, in order:

1. Write the handler in `backend/src/handlers/`, CORS headers on every return
   path including the guards.
2. Unit-test it with a synthetic event — null body, absent path parameters,
   missing claims.
3. Add the manifest entry, listing every env var it reads *transitively*.
4. `npm run routes:emit`.
5. `npm test` — the parity test confirms Terraform can supply what you declared.
6. `./app.sh --start` and exercise it against the real local table.

## Decided in 02, before this stage is built

**Roles stay in Cognito. They do not get a column in DynamoDB.**

`cognito:groups` is already in the ID token, signed by Cognito and verified by
the API Gateway JWT authorizer. Copying it into a staff item would create two
sources of truth for "who is an admin", a sync problem every time somebody
changes role, and a table read on every request to answer a question the token
already answered.

The split to build against:

| Question | Answered by | Cost |
| --- | --- | --- |
| Is this person office staff? | `cognito:groups` claim | Free, already verified |
| Is this person allowed to edit *this* interview window? | DynamoDB item ownership | One read, and it genuinely needs one |

So the coarse role check reads the claim out of the request context, and the
table is hit only for per-record ownership — which is not a role question and
could never live in a group.

The failure this avoids: a `role` attribute is added to a staff item, somebody
is then added to the `office` group with the CLI, and the table never hears
about it. The API and the UI now disagree about what that person can do, and
both sources look authoritative, which makes it a slow bug to find.

Related: the JWT authorizer on an HTTP API validates issuer, audience and
expiry, and can check `authorization_scopes` against the `scope` claim — but it
**cannot** check an arbitrary claim like `cognito:groups`, and Cognito scopes are
granted per app client rather than per user. So the group check belongs in the
handler, not the authorizer. That is the standard shape, not a workaround.
