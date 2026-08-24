# Episode 05: Email

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

A parent books an interview and gets a confirmation. A parent cancels and gets
told. That is the whole feature, and it is the first thing in this project that
happens *after* a request has already returned.

```
cd 05-email
terraform init
terraform apply
```

## What this adds

A DynamoDB stream on the single table, one Lambda triggered by it, and a
verified SES identity in `ca-central-1` for it to send through.

```
create-booking writes BOOKING#<ref>/META
        │
        ▼
   table stream  ── 4 records, 3 filtered out ──▶  booking-email Lambda
        │                                                  │
        │                                                  ▼
        │                                          SES ──▶ parent's inbox
        ▼
cancel-booking deletes the same item ──▶ the cancellation message
```

## The decisions

**Watch the booking item, not the slot.** The first guess — written into a
comment in `cancel-booking.ts` an episode early — was to watch the slot's
`REMOVE`. It is wrong: the slot carries a student number and no address, so
every message would need a second read to find out who to tell. The booking item
carries everything, and both events land on it. `INSERT` is a confirmation,
`REMOVE` is a cancellation.

**`NEW_AND_OLD_IMAGES`, because cancelling deletes the item.** The address
survives only in the old image. Under `NEW_IMAGE` a cancellation arrives as bare
keys, and there is nobody left to mail.

**One booking writes four items; only one should send mail.** The slot update,
the `CLAIM#` guard, the `TIME#` guard and the booking itself. The event source
mapping filters on the `BOOKING#` partition prefix, so the other three never
cost an invocation — and the handler applies the same rule again, because a
filter is configuration and sending exactly one email is a property of the code.

**Exactly-once does not exist, so pick which way to fail.** A stream batch is
retried, so at-least-once delivery of a record has to become exactly-once
delivery of a message. The handler claims a marker before sending, and deletes
it if the send fails. Claiming and never releasing would lose the message
silently — the worse failure, because it is invisible at both ends.

**A pull, not a push.** Every other Lambda here has an `aws_lambda_permission`
naming API Gateway as an allowed caller. This one has none: an event source
mapping pulls, using the function's own execution role. The grant is on the
role, and `dynamodb:ListStreams` is on `"*"` because enumerating cannot be
scoped to the thing being enumerated.

**A domain, not an address.** Verifying an address is a click nobody can repeat
on camera. Verifying a domain is three CNAMEs in a zone Route53 already hosts,
so it lives in code and survives a destroy.

## The sandbox, which is the interesting constraint

SES verification, quota and sandbox status are all **per-region**. The account
has production access in `us-east-1`; `ca-central-1` has none, 200 messages a
day, and started with zero verified identities.

Sending through `us-east-1` would work immediately. It would also put a parent's
address and their child's interview time through a US region, which is what
`CLAUDE.md` calls not negotiable. Paying the 24 hours is the reason the
constraint was written down.

**Verifying the domain authorises a sender. It says nothing about recipients.**
In the sandbox SES accepts a message to an unverified address and delivers it
nowhere. So `verified_recipients` exists, the demo inbox is in it, and a human
clicks the link once.

**Cognito is wired but switched off.** `02-auth` left a `ses_source_arn` hook for
this stage. Flipping it now makes staff email *worse*: Cognito's own sender
reaches anyone at 50 a day, and SES in the sandbox reaches only verified
addresses — which sixty staff accounts are not. It would also fail this stage's
own apply, because `scripts/create-staff.sh` asks Cognito to email the demo
account. Set `cognito_email_via_ses = true` and apply again once production
access lands.

## Smoke test

1. `terraform apply`.
2. Click the verification link AWS sends to each address in
   `verified_recipients`. One time only.
3. The table seeds itself during the apply — `seed.tf` runs the same seeder a
   human would, because `destroy` takes the table with it and every cycle would
   otherwise start with "not open yet". Nothing about the rows reaches state.
   Set `seed_demo_data = false` for a real deployment, or run
   `./scripts/seed-stage.sh` by hand against a table that already exists.
4. Confirm the domain is ready before booking anything —
   `terraform output ses_verified_for_sending`, or
   `aws sesv2 get-email-identity --email-identity <domain> --region ca-central-1`.
   It is **false** right after the apply; DKIM takes minutes, and a send before
   it finishes is retried three times and dropped.
5. Book any interview on the site. Every seeded student carries the demo
   address, so it does not matter which one.
6. Cancel it. The cancellation arrives the same way.
7. `aws lambda get-event-source-mapping` → `State: Enabled`,
   `LastProcessingResult: OK`.
8. `terraform destroy`, then `./scripts/check-destroyed.sh`.

## Known and accepted

- **No local end-to-end.** DynamoDB Local serves a Streams API but has no event
  source mapping, and SES has no local equivalent at all. Building a poller
  would be a second implementation of the thing under test. The handler is
  covered by unit tests against synthetic stream events; the wiring is covered
  by `routes.parity.test.ts`; the rest is covered by applying a stage. See the
  table in [`backend/README.md`](../backend/README.md).
- **No bounce feed.** A configuration set suppresses bounces and complaints, but
  nothing reads the events. The monitoring story here is a Budgets alarm and a
  health check; a Firehose to read bounce events would cost more than the system
  it watches.
- **No dead-letter queue.** After three attempts a failed message is logged and
  dropped. `CLAUDE.md` says no SQS, and this is where that cut shows up.
- **Text only.** The front end is a prop and the message is five lines.
- **One inbox for every parent.** This is a demo school; there is no contact
  list and there is not going to be one.
