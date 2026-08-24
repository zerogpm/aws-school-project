# modules/email

One verified SES identity in the project's region, and the DNS that proves it.

Two things send through it: the `booking-email` consumer in
[`modules/booking`](../booking/), which mails parents, and — when a stage opts
in — the Cognito pool in [`modules/auth`](../auth/), which mails staff invites.
An identity is not owned by whichever of those sends more, so it lives here.

## Why a domain and not an address

Verifying an address is one CLI call and a click. Verifying a domain is three
CNAMEs, which means it lives in code, survives a destroy and re-apply, and can
be filmed twice. It also makes the sender `interviews@<domain>` rather than
somebody's Gmail, which is the difference between a demo and a prop.

## The sandbox, which is the part that surprises people

Verifying the domain authorises a **sender**. It says nothing about who may
**receive**. Until the account has production access *in this region*, SES
accepts a message to an unverified address and delivers it nowhere — silently.

So `verified_recipients` exists. Each address becomes an identity of its own,
AWS emails it a link, and a human clicks it. Terraform creates the identity; it
cannot finish it.

Production access is a support case, roughly 24 hours, and there is no resource
for it. It is the one dependency in this repo that cannot be unblocked from the
machine you are sitting at.

## Region

Identity verification, sandbox status and sending quota are all per-region. A
domain verified in `us-east-1` is not partially set up in `ca-central-1` — it is
unknown. Everything here exists in the stage's region, which is Canadian,
because a parent's address and their child's interview time are exactly the data
that constraint was written for.

## After an apply

`verified_for_sending` is **false** immediately after the first apply. DKIM
propagation takes minutes, and there is no SESv2 equivalent of
`aws_acm_certificate_validation` to block on. A booking made before it finishes
is retried three times and then dropped, so check the output before the first
demo:

```
aws sesv2 get-email-identity --email-identity <domain> --region ca-central-1
```

## Deliberately not here

- **No event destination.** That would be the bounce and complaint feed, and the
  entire monitoring story in this project is a Budgets alarm and a health check.
  A Firehose to read bounce events would cost more than the system it watches.
- **No MAIL FROM subdomain.** It buys SPF alignment that matters for bulk
  marketing mail. This sends a few hundred messages twice a year.
