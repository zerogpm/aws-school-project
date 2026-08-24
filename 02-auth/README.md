# Episode 02: Auth

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

## What this episode adds

Everything from [`01-storage`](../01-storage/), plus a Cognito user pool for
staff:

- Sign-in by school email address, with the classic hosted UI
- No self-registration anywhere — the office creates every account
- Optional TOTP MFA, email-only account recovery
- `office` and `teacher` groups, carried in the `cognito:groups` claim
- A public app client using the authorization code flow, no client secret

Roughly sixty accounts. Parents and students never appear in this pool: a parent
books an interview with a student number, not an account. That single decision
is what keeps the pool inside the free tier and keeps the password-reset load
off a teacher who has no help desk.

## Decisions

| Decision | Why | Rejected |
| --- | --- | --- |
| Cognito hosted UI | Nobody here is writing a sign-in page, storing a password hash, or handling forgot-password. One part-time maintainer | Rolling auth into the API; a third-party IdP with a per-seat bill |
| Staff only, no parent accounts | 800 students' parents would mean thousands of accounts, password resets, and a support burden with nobody to carry it. The booking flow is gated by student number instead | Accounts for parents; accounts for students |
| `allow_admin_create_user_only = true` | There is no path from the public internet to an account. Self-signup on a school pool is an open door | Self-registration with email domain validation |
| `user_pool_tier = "LITE"` | A new pool defaults to `ESSENTIALS`. Sixty staff are free on either, so this is not today's bill — it is not sitting on a higher per-MAU rate nobody chose | `ESSENTIALS` by default; `PLUS` threat protection nobody will read |
| Classic hosted UI (`managed_login_version = 1`) | The newer managed login branding needs `ESSENTIALS` or above. Naming the version keeps the tier and the sign-in page from drifting apart | Managed login v2 branding |
| Authorization code flow, public client | A secret shipped in a JS bundle is not a secret. Implicit flow puts tokens in the URL fragment, where they land in browser history | Implicit flow; a confidential client with a secret |
| TOTP MFA only, optional | SMS MFA needs an SNS caller role, bills per message, and means holding staff phone numbers | SMS MFA; mandatory MFA for sixty people with no help desk |
| No symbol requirement, 12-char minimum | Length is the control that does the work. Symbol rules mostly generate forgotten passwords, and a lockout at 8pm has nobody to call | Complexity rules; `password_history_size` (an `ESSENTIALS` feature) |
| Email-only account recovery | SMS recovery means collecting phone numbers and paying per message | Phone recovery; admin-only recovery |
| Cognito's built-in email sender | Free, and enough for onboarding in batches. SES arrives with confirmations in `05-email` and is passed down there, behind a switch - in the SES sandbox it would reach fewer staff than the built-in sender, not more | Wiring SES here, before anything else needs it |
| Hosted UI on `*.amazoncognito.com` | A custom `auth.` domain needs an ACM certificate in `us-east-1` and a Route53 record, for a page sixty people see a few times a term | Custom auth domain |
| `/staff` is the redirect target | The page already exists in the SPA. The hosted UI returns there with `?code=` and the app exchanges it — no extra route, no server | A dedicated `/staff/callback` route |

## Cost change from previous

**No change — still effectively $0/month.** Sixty staff sit far inside the
Cognito free MAU allowance, the hosted UI domain is free, and no compute exists
yet. The first real line item arrives with Lambda and DynamoDB in `03-data`.

The tier choice is the thing to watch rather than the current bill: `LITE` and
`ESSENTIALS` are both free at this size, and only differ once a pool grows past
the free allowance — which this one never will.

## Creating a staff account

Nothing self-registers, so the first account is made from the CLI. Terraform
does not create it: staff accounts are data, not infrastructure, and putting
sixty people in a `.tf` file means their email addresses live in git.

```
cd 02-auth
POOL=$(terraform output -raw user_pool_id)

aws cognito-idp admin-create-user \
  --region ca-central-1 \
  --user-pool-id "$POOL" \
  --username teacher@maplewood.example \
  --user-attributes Name=email,Value=teacher@maplewood.example Name=email_verified,Value=true

aws cognito-idp admin-add-user-to-group \
  --region ca-central-1 \
  --user-pool-id "$POOL" \
  --username teacher@maplewood.example \
  --group-name teacher
```

Cognito emails a temporary password, good for 14 days. Then open the sign-in
page:

```
terraform output -raw hosted_ui_login_url
```

`--region` is spelled out because the AWS CLI follows your profile, not the
Terraform provider. A profile pointed at `us-east-1` will report that the pool
does not exist.

## Not here yet

- **The front end does not use any of this.** The Staff page still shows a
  disabled button. Wiring the SPA to the hosted UI needs the pool ID and client
  ID at build time, which is a change to the deploy script.
- **Nothing is protected by these tokens.** There is no API to authorise
  against until `03-data`; the pool issues tokens nothing checks yet.
- No custom auth domain, and no custom domain on the site either.
- No SES. Cognito's built-in sender is capped at 50 emails a day, which is under
  a full sixty-person onboarding — invite in batches, or pass `ses_source_arn`
  to the module. `05-email` brings SES and wires exactly this, though it leaves
  the switch off: see that stage's README for why connecting it early is a
  downgrade rather than an upgrade.

## Creating staff accounts

There is no self-registration. `allow_admin_create_user_only = true`, so the
hosted UI offers no sign-up link and an account only exists because someone with
AWS credentials made one:

```
./scripts/create-staff.sh teacher@maplewood.example office
./scripts/create-staff.sh --dry-run teacher@maplewood.example teacher
```

Cognito emails a temporary password and the hosted UI forces a new one on first
sign-in. There is no bootstrapping problem — creating the first account is an
IAM operation, not an app one, so nobody needs to be signed in already.

For a demo account, `STAFF_PASSWORD` sets a known password instead and skips
email entirely:

```
STAFF_PASSWORD='MaplewoodDemo2026' ./scripts/create-staff.sh principal@maplewood.example office
```

That calls `admin-set-user-password --permanent`, which also clears
`FORCE_CHANGE_PASSWORD` so the account signs in immediately. Because no mail is
sent, the address does not have to be a real inbox — which is why the fictional
school's own domain works here and nowhere else.

It is read from the environment rather than an argument so it stays out of shell
history and out of `ps`, and it never touches Terraform state. It is still a
known password on an internet-facing pool: fine for a pool with no data that
gets destroyed after each session, wrong for a real staff account, where the
point is a password nobody else has ever seen.

Groups are `office` (precedence 1) and `teacher` (precedence 10). They ride in
the token as `cognito:groups`, and the Admin page displays them — but **nothing
enforces them yet**. Any staff member who signs in reaches `/admin`. Real
enforcement is the API Gateway JWT authorizer in a later stage, because a
client-side group check is cosmetic: anyone can edit `sessionStorage` or call
the API directly.

Accounts are deliberately not `aws_cognito_user` resources. `temporary_password`
and `password` are sensitive attributes, which in Terraform means masked in
output and stored in plaintext in state; `terraform destroy` would delete every
account in a repo whose workflow is apply, verify, destroy; and sixty real
teachers' addresses do not belong in a public portfolio repo. Accounts are data,
not infrastructure.

The built-in email sender is capped at 50 messages a day, so onboarding sixty
staff spans two days or needs SES via the module's `ses_source_arn`.

## Apply / destroy

Only one stage may be applied at a time — every stage creates the same
globally-unique bucket names and hosted UI domain, and will collide.

```
cd 02-auth
cp terraform.tfvars.example terraform.tfvars   # optional; defaults are fine
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply

terraform destroy
../scripts/check-destroyed.sh
```

`deletion_protection` on the pool is `INACTIVE`, which is what makes
`terraform destroy` work at all. It is the wrong answer for a pool holding real
staff accounts: a deleted pool cannot be restored, and every account has to be
created again by hand.

`force_destroy` is `true` on both buckets, so the site bundle and anything
staff uploaded goes with them. Terraform will not otherwise delete a bucket that
still holds objects, and versioning means `aws s3 rm --recursive` does not
actually empty one — it writes a delete marker over each key and leaves every
version behind.

Between them those two settings mean a destroy removes everything. What they do
not do is tell you it worked: a CloudFront deletion that timed out leaves a
distribution behind, and the failure scrolls past in the output.
`check-destroyed.sh` sweeps the account by name and exits non-zero if anything
is still standing. It only reports — deleting stays a decision you make.

## Video

_Link once published._
