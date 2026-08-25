# Episode 06: Cost

> **This is the complete system.** If you want to run the project, this is the
> folder. The name refers to the episode it belongs to — guardrails and the real
> bill — not to what it deploys. Only one stage may be applied at a time; every
> stage creates the same globally-unique names.

Five episodes built a thing. This one asks what it costs to leave running, and
what happens when nobody is looking. The answer to the second question turns out
to be most of the answer to the first.

```
cd 06-cost
terraform init
terraform apply
```

## What this adds

Two budgets and a prober. That is the entire monitoring story, and the third
guardrail — point-in-time recovery on the table — has been on since episode 03.

```
                        cost                        availability
                          │                               │
        aws_budgets_budget│                Route53 health check
        ├─ monthly  $10   │                  GET /health, 3 checkers
        │   50% · 100% ·  │                        │
        │   forecast 100% │                        ▼
        └─ daily    $1    │            CloudWatch alarm  ── us-east-1 ──┐
             100%         │            AWS/Route53 HealthCheckStatus    │
                          │                                             ▼
                          ▼                                        SNS topic
                    alert_email  ◀──────────────────────────────────────┘
                                        (one confirmation click)
```

The budgets mail the address directly. The alarm has to go through SNS, and the
reason it has to go through a topic in Virginia is the most interesting thing in
the stage.

## The decisions

**Cost alerting is AWS Budgets, not a CloudWatch billing alarm.** CloudWatch does
carry a cost metric — `AWS/Billing` `EstimatedCharges` — and it is the worse tool
three times over. It publishes only in us-east-1. It needs *Receive Billing
Alerts* switched on by hand in the Billing console, which Terraform cannot set,
so an alarm on it applies clean, looks wired, and silently never fires. And it
alarms only on money already spent. Budgets forecasts, and mails the address
without a topic, a topic policy or a confirmation click.

**Budget the target, not the cap.** Twenty dollars is the hard limit; ten is the
target. Budgeting the limit means the first warning lands at ten dollars and the
last one lands after the month is already lost. At ten, the first mail arrives at
five with fifteen dollars of runway still ahead. The forecast threshold is the
one that earns its place — it says on day twelve that ten is coming, rather than
on day thirty that it went.

**The second budget is daily, because the failure here is not drift.** It is a
loop. `MISTAKES.md` has the shape of it from before any of this was built: an
S3-triggered Lambda that re-triggers itself, billed per invocation and per
request on every turn. A monthly budget takes weeks to notice that. A daily one
takes about a day.

About a day, not the same day, and the difference matters enough to say out
loud: AWS evaluates daily budgets against **prior full-day data** and refreshes
up to three times a day, so the mail arrives the morning after. Neither budget is
a control. The control is the prefix-scoped trigger and reserved concurrency;
these two are the detector behind it.

**Both budgets are free, and that is why there are two.** AWS gives sixty
budget-days a month, which is exactly two budgets running every day of one. A
third would start costing $0.02 a day.

**The budget is account-wide, with no cost filter.** Filtering on `ca-central-1`
would undercount, because CloudFront, Route53 and the health check are billed
globally or in us-east-1. Filtering on the `Project` tag needs cost allocation
tags activated in the Billing console, which is a click and is **not
retroactive**. In an account that runs only this, the whole account is the honest
scope.

**A prober, not an alarm on 5xx.** API Gateway publishes its own error metrics
for free, and an alarm on them costs nothing. It also never fires, because this
site has near-dead traffic for ten months of the year and a metric with no
datapoints raises nothing. An alarm that cannot fire while nobody is looking is
not a guardrail. Paying for a prober is what buys a signal at zero traffic — and
it is the only reason this stage costs anything at all.

**It watches the API, not the site.** `GET /health` was built for this caller and
says so in its own first comment. It touches no datastore on purpose, so a
DynamoDB outage does not make it report the API as down when the API is fine. A
health check on a CloudFront alias record is also not supported, which
`modules/static-site/dns.tf` recorded two episodes ago.

## The constraint: the alarm cannot live in Canada

Route53 publishes `HealthCheckStatus` into `AWS/Route53` in **us-east-1 and
nowhere else**. An alarm created in `ca-central-1` finds no metric, sits in
`INSUFFICIENT_DATA` forever, and never fires — with no error at `validate`, none
at `plan`, none at `apply`, and nothing in any log. Nothing about the stack looks
wrong. It is simply not watching.

A CloudWatch alarm can also only publish to an SNS topic in its own region, so
the topic follows the alarm rather than the rest of the stack.

`CLAUDE.md` calls the region non-negotiable, and it is — for **data**. What
crosses the border here is a health check id, a state transition, and the
maintainer's own address. No student number, no parent address, nothing a booking
touches. That is a different claim from "the region does not matter", and it is
worth making the distinction rather than quietly adding a provider alias.

`backend/src/routes.parity.test.ts` asserts the `provider` line on both
resources, because deleting it is invisible everywhere else.

## The other constraint: watching it costs more than running it

Left unpinned, Route53 probes from every checker location it has. AWS documents
the endpoint receiving a request **about every two seconds** — roughly 1.3
million requests a month, against a system built for near-dead traffic. That is
API Gateway charges plus enough invocations to eat the Lambda free tier, to watch
a site nobody is visiting.

`health_check_regions` pins it to three, the API's own minimum, which is about
260 thousand. Deleting that one argument breaks nothing, raises the bill, and
turns nothing red — so there is a test for it.

Even pinned, the arithmetic is uncomfortable in a way worth showing on camera:

| | estimate / month |
| --- | --- |
| Route53 health check (HTTPS optional feature) | ~$1.00 |
| API Gateway — the prober's own requests | ~$0.26 |
| everything else — DynamoDB, S3, CloudFront, logs | ~$0.35 |
| Lambda, Cognito, SES, SNS, Budgets, the alarm | free tier |

Roughly **70% of the bill is the guardrail** — more than the site, the database,
the CDN and the auth combined. A system this small is dominated by the cost of
watching it. These are estimates until the numbers in the root README's *Running
costs* section replace them; `./scripts/cost-report.sh` is what produces those.

## Smoke test

1. Set `alert_email` in `terraform.tfvars`. Leave it unset and this stage builds
   the whole stack and none of the guardrails — deliberately, so the episode can
   be applied without them.
2. `terraform apply`.
3. **Click the SNS confirmation link AWS emails you.** Until then Terraform shows
   the subscription as `pending confirmation`, the apply is green, and the alarm
   can reach nobody.
4. Watch for a pair of emails a few minutes in. The alarm is created with
   `treat_missing_data = "breaching"`, so it opens in `ALARM` before the first
   checker reports and settles to `OK` once one does. That pair is the cheapest
   possible proof the whole path works.
5. `aws route53 get-health-check-status --health-check-id $(terraform output -raw health_check_id)`
   — three checkers reporting, not a dozen. That is the cost fix, visible.
6. Prove the path on demand, without breaking anything:
   ```
   aws cloudwatch set-alarm-state --region us-east-1 \
     --alarm-name "$(terraform output -raw alarm_name)" \
     --state-value ALARM --state-reason "smoke test"
   ```
   The email arrives in seconds. Set it back to `OK` afterwards.
7. `aws budgets describe-budgets --account-id <id> --region us-east-1` — two
   budgets, the monthly one carrying three notifications and the daily one
   carrying one.
8. `aws dynamodb describe-continuous-backups --table-name $(terraform output -raw table_name)`
   → `ENABLED`. The third guardrail, on since 03, and nothing here turned it on.
9. Leave the stack up long enough to bill, then `./scripts/cost-report.sh`.
10. `terraform destroy`, then `./scripts/check-destroyed.sh` — which now sweeps
    us-east-1 as well, and checks budgets and health checks by hand because
    neither is reachable by tag.

**Filming the budget email.** It cannot be done live: there is no force-evaluate
API, and lowering the limit changes the trip point, not the 8–12 hour refresh.
Set `daily_budget_usd = 0.02` the day before — the stack burns five to seven
cents a day idle, so it trips overnight — and show the real, timestamped mail.
Put it back to `1` afterwards.

## Known and accepted

- **No dashboard and no paging alarm.** Two budgets, one health check, one alarm
  and PITR is the whole monitoring story. Sixty staff and one teacher who
  maintains this do not need a wall of graphs nobody is paid to read.
- **No CloudWatch billing alarm.** See the first decision above.
- **No string matching on the health check.** It is a chargeable optional
  feature, and it would catch a 200 carrying the wrong body — a real failure, but
  one that cannot happen here, because `/health` returns a constant from a
  handler that touches nothing.
- **No alarm on Lambda `Invocations`.** This is the strongest argument against
  the design above and it belongs in the open: an invocations alarm catches a
  runaway loop in about five minutes rather than the next morning, costs ~$0.10 a
  month, and would reuse the topic that already exists. It stays out because the
  monitoring story is fixed at three guardrails and because the real fix for a
  loop is structural — a prefix-scoped trigger, not a faster detector. That is a
  defensible cut, not an obvious one.
- **No budget between recordings.** Both budgets are destroyed with the stage. A
  destroyed stack spends nothing, so that is correct — but the account is
  unwatched until the next apply. The standing net is a second budget made once,
  by hand, outside Terraform.
- **PITR is the entire backup story.** No second region, no exports, no
  snapshots. A booking cannot be lost; analytics can.
- **The estimates above are estimates.** Route53's optional-feature surcharge and
  the current Cognito tiers both need confirming against the live pricing pages
  before any of these numbers are said out loud.
