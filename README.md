# School Website on AWS

A school website for 800 students, 60 staff, and their parents — built on AWS
with Terraform, for under $20/month, maintained by one teacher with no IT staff.

Each episode of the accompanying series shows one design decision and the
Terraform behind it. **The decisions and their rejected alternatives are the
point of this repo**; the front end is a prop.

---

## Prerequisites

- **Terraform** >= 1.9. Built and filmed against 1.15 with AWS provider 6.60;
  `.terraform.lock.hcl` is committed so you get the same provider.
- **AWS credentials** on the standard chain — an SSO profile, `AWS_PROFILE`, or
  environment variables. Check with `aws sts get-caller-identity` before you
  start: a profile that works for `aws s3 ls` is not necessarily the one your
  shell is actually using.
- An account you are willing to create and destroy real resources in.

Your profile's default region does not matter. The provider pins
`ca-central-1` explicitly, so a profile pointed at `us-east-1` still deploys to
Canada. Bare `aws` CLI commands *do* follow your profile, which is the usual
reason a resource "isn't there" when it is.

---

## Just want to run it?

```
cd 06-cost
terraform init
terraform apply
```

**`06-cost/` is the complete system.** The name refers to the episode it belongs
to, not to what it deploys.

The numbered folders are cumulative, not sequential steps you work through. Each
one deploys the entire stack up to that point, so `cd 04-booking && terraform
apply` gives you a working booking system without running 01–03 first. Pick the
folder matching the last feature you want; `06-cost` is everything.

> **Only one stage can be applied at a time.** Every stage creates the same
> globally-unique names — S3 buckets, the Cognito pool, Route53 records. Apply,
> verify, `terraform destroy`, then move on. Two stages up at once will collide.

Region is `ca-central-1` and that is not configurable in any meaningful sense:
student data has to stay in Canada. The one exception is the CloudFront ACM
certificate, which AWS requires in `us-east-1`. That is metadata, not student
data.

---

## Running it locally, without AWS

The front end runs entirely on your machine. No AWS account, no credentials, no
`terraform apply`:

```
cd site
npm install
npm run dev        # http://localhost:5173
```

Every public page works. The home page, the published timetable, and the
interview booking form — which validates student numbers and refuses a full slot
— all run against fixture data in `src/data.ts`. There is no API behind the form
yet, so submitting says so rather than pretending.

Both test suites run with no AWS environment at all:

```
npm test           # unit - Vitest + React Testing Library
npm run test:e2e   # e2e - Playwright, against the real production build
npm run build      # production build into dist/
npm run lint
```

The e2e suite walks the entire staff sign-in journey — a wrong password, the
forced password change every new account hits, session renewal from a refresh
token, sign-out — with every call to Cognito intercepted inside the spec. No
test has ever reached AWS, and none needs to.

**The one thing that does not work offline is signing in.** It needs a real
Cognito user pool and there is no offline substitute. A build with no pool
configured detects that, disables the sign-in button and explains itself rather
than failing with an opaque network error. Nothing else on the site is affected.

To sign in against a real pool while still running the front end locally, apply
`02-auth`, then write its details into `site/.env.local`:

```
cd 02-auth
cat > ../site/.env.local <<EOF
VITE_COGNITO_CLIENT_ID=$(terraform output -raw user_pool_client_id)
VITE_COGNITO_REGION=$(terraform output -raw aws_region)
EOF
```

Neither value is a secret — the app client generates none, because anything
inside a JavaScript bundle is readable. They are account-specific and go stale
on the next destroy, so `.env*.local` is gitignored.

Playwright deliberately runs against `vite preview`, not the dev server: the SPA
fallback and the hashed asset names only exist after a build, and those are
exactly the things worth testing.

### The database, locally

DynamoDB runs in Docker, so handler work needs no AWS account either:

```
./app.sh --start           database, tables, seed, and the API on :3000
./app.sh --start --web     also launch the front end
./app.sh --status          containers, ports, tables
./app.sh --stop            stop everything, keep the data
./app.sh --stop --wipe     stop everything and delete the database
```

One environment variable decides where a handler points: `DYNAMODB_ENDPOINT` is
set only locally, so deployed Lambdas run the same code against real AWS with no
`isLocal` branch anywhere. See [`backend/README.md`](backend/README.md) for the
setup and its gotchas — `localhost` versus `127.0.0.1`, why a healthy container
answers HTTP 400, and why the local schema is a hand-written mirror you have to
keep in step with the Terraform yourself.

---

## The constraints that drive every decision

- 800 students, 60 staff, plus parents
- ~40GB of photos and event video, growing ~15GB/year, rarely read after the
  first month
- Traffic near-dead most of the year, spiking to ~300 parents in one evening,
  twice a year
- Budget under $20/month; target under $10
- No IT staff — one teacher maintains it
- Data must stay in Canada
- Cannot lose a booking. Can lose analytics.

Every architectural choice below traces back to one of these. Where a more
conventional answer was rejected, the reason is recorded.

## Architecture

**Site + media** — S3 + CloudFront with Origin Access Control, Route53 for DNS.
Buckets are fully private. Versioning on. Media lifecycle Standard →
Standard-IA at 30d → Glacier IR at 90d. Uploads go direct to S3 via presigned
URLs, never through Lambda.

**Auth** — Cognito user pool, staff only (~60 accounts), self-signup disabled.
No parent or student accounts. The sign-in form is the school's own page talking
to `cognito-idp` directly, not the Cognito hosted UI — the hosted UI can be
recoloured but never restyled past a centered card, and the site has a design.

**API + compute** — API Gateway HTTP API → Lambda → DynamoDB on-demand. Public
routes throttled, with student-number format validation.

**Async** — DynamoDB Streams → Lambda → SES for booking confirmations.

**Guardrails** — this is the entire monitoring story: an AWS Budgets alarm to
email, a Route53 health check to SNS email, and DynamoDB point-in-time recovery.

**No VPC anywhere.** Lambda, DynamoDB, and S3 do not need one.

## Key decisions

| Decision | Why | Rejected |
| --- | --- | --- |
| No VPC | Nothing needs one, and a NAT Gateway alone is ~$32/mo — more than the entire system | VPC with private subnets |
| Lambda over EC2/Fargate | Two busy evenings a year. A `t3.small` idles for 363 days | Always-on compute |
| DynamoDB over RDS | Lambda + RDS means connection exhaustion, RDS Proxy, and therefore a VPC | RDS |
| No SQS anywhere | Booking must be synchronous, and SQS standard is at-least-once and still races. For email, DynamoDB Streams give the same decoupling with one less service to maintain | SQS / SQS FIFO |
| Staff-only accounts | ~1000 parent accounts means bulk import and password resets with no IT staff | Parent accounts |
| Glacier IR over Glacier Flexible | Flexible needs a restore job. A parent clicking last year's concert photo would get nothing for hours | Glacier Flexible / Deep Archive |
| No CI/CD | The teacher will never push to git | GitHub Actions |
| No dashboards or paging alarms | Nobody is watching, and nobody can be paged | CloudWatch dashboards |
| Local Terraform state | Remote state coordinates a team. There is no team | S3 backend + lock table |

The chain matters: Lambda → DynamoDB → no VPC → no NAT → under $10/month. Each
decision forces the next.

## Episodes

| Stage | Adds | Status |
| --- | --- | --- |
| [`01-storage`](01-storage/) | Private S3 site + media buckets, CloudFront with OAC, lifecycle to Glacier IR | Built |
| [`02-auth`](02-auth/) | Cognito user pool, staff-only accounts, custom sign-in form, custom domain | Built |
| [`03-data`](03-data/) | Single-table DynamoDB design, API Gateway, Lambda — and one copy of the handler code that also runs locally under Express | Built |
| [`04-booking`](04-booking/) | Conditional writes, the double-booking demo | Built |
| [`05-email`](05-email/) | Table stream → Lambda → SES booking confirmations | Not started |
| [`06-cost`](06-cost/) | Budgets alarm, health check, PITR — **and the complete system** | Not started |

## Layout

```
modules/static-site/      S3 + CloudFront, private by OAC
modules/auth/             Cognito
modules/booking/          DynamoDB, Lambda, API Gateway
01-storage/ .. 06-cost/   episode stages; each calls the modules it needs
site/                     React SPA (Vite), plus its unit and e2e tests
backend/                  Lambda handlers, plus the local DynamoDB harness
scripts/deploy-site.sh    build the front end and publish it
scripts/create-staff.sh   create a staff account and put it in a group
scripts/check-destroyed.sh  confirm a destroy really left nothing behind
app.sh                    the local stack: --start [--api] [--web], --stop, --status, --scan
```

Stages hold only module calls and variables. The infrastructure itself lives in
`modules/`, so a stage is a short, readable statement of what that episode adds.

## The front end

`site/` is a React single-page app built with Vite. `npm run build` emits plain
HTML, CSS, and JS into `site/dist/` — no server, no Lambda@Edge, no Amplify. S3
serves the files and CloudFront caches them, which is the only arrangement that
fits the budget.

React Router owns the URL space, so `/timetable` is not an object in S3 — it is
a route the bundle resolves after `index.html` loads. CloudFront is configured
to return `index.html` with a **200** for any key S3 cannot find, which is what
makes a deep link or a browser refresh work. There is an e2e test asserting
exactly that, because it is the failure that only appears in production.

Terraform creates the bucket but does not own the site content. Editing a
heading should not require a `terraform apply`, and `terraform plan` should stay
a statement about infrastructure. Publishing is a separate step:

```
./scripts/deploy-site.sh 01-storage
```

That builds, uploads, and invalidates the CloudFront cache, with two cache
policies: files under `assets/` carry a content hash in the filename and are
marked immutable for a year, while `index.html` is `must-revalidate` so a deploy
is visible immediately.

An empty bucket returns **403, not 404** — the bucket policy grants `GetObject`
but not `ListBucket`, so S3 cannot distinguish a missing key from a forbidden
one without also allowing enumeration. A 403 before you have deployed any
content is expected, and is evidence that OAC is working.

## Running costs

Measured figures land here once the full stack has been up long enough to
produce a real bill. Until then this section stays empty rather than carrying an
estimate — a wrong number is worse than no number.

Two things make measuring this harder than it looks. Cost allocation tags are
**not retroactive** — `Project` and `Stage` attribute spend only from the moment
they are activated under Billing, and a tag key does not even appear there until
a resource carrying it has existed for up to 24 hours. And this account runs
unrelated workloads, so the total bill is not the project's bill. Filtering Cost
Explorer by region `ca-central-1` works immediately, works retroactively, and is
the cleaner separator here.

## Verifying teardown

`terraform destroy` reports success based on its own state file, which is not
the same thing as the account being clean. Every resource here is tagged
`Project = school`, so one sweep answers it:

```
aws resourcegroupstaggingapi get-resources --region ca-central-1   --tag-filters Key=Project,Values=school --query 'ResourceTagMappingList[].ResourceARN'
aws resourcegroupstaggingapi get-resources --region us-east-1   --tag-filters Key=Project,Values=school --query 'ResourceTagMappingList[].ResourceARN'
```

Both regions, because global services register their tags in `us-east-1`. Empty
output from both means nothing survived. Worth running after every destroy — an
orphaned resource on a $10/month budget is not a rounding error.

## Notes for anyone cloning this

- `*.tfvars` is gitignored. Each stage ships a `terraform.tfvars.example`;
  defaults work as-is.
- `.terraform.lock.hcl` **is** committed, so you get the same provider version
  the episode was filmed against.
- State is local, one `terraform.tfstate` per stage folder. Nothing to set up,
  but nothing shared either.
- Buckets set `force_destroy = true`, because this repo is an apply/verify/
  destroy cycle repeated once per episode. Versioning makes manual teardown
  deceptive: `aws s3 rm --recursive` writes a delete marker over each key rather
  than removing anything, so the bucket looks empty to `aws s3 ls` while
  `DeleteBucket` still fails. Set `force_destroy = false` for anything holding
  real data.
- A destroy that includes CloudFront takes **15-20 minutes**. The distribution
  must be disabled and propagated to every edge location before AWS will delete
  it. Interrupting leaves a disabled-but-undeleted distribution and a stale
  state lock — recover with `terraform force-unlock <ID>` then destroy again.
- Terraform does not roll back. A failed apply stops and keeps what it created,
  recorded in state; the fix is almost always to run it again, since it re-plans
  from reality. There is no equivalent of `UPDATE_ROLLBACK_FAILED` to escape.
