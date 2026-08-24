# Episode 04: Booking

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

A parent books an interview slot: public write, no account, gated by an existing
student number. The interesting part is not the booking — it is the two parents
who click the same slot in the same moment.

## The problem

Near-dead traffic all year, then ~300 parents in one evening, twice. *A booking
cannot be lost.* Read the slot, check it is free, write the booking — and
however small the gap between the read and the write, another Lambda fits inside
it. Both writes succeed, both parents get a confirmation, and nobody finds out
until two families arrive for the same chair.

So the read and the write are one operation.

```
TransactWriteItems([
  ConditionCheck  STUDENT#S00481  PROFILE          attribute_exists(PK)
  Update          WINDOW#w  SLOT#<iso>#okafor      attribute_not_exists(bookedBy)
  Put             STUDENT#S00481  CLAIM#w#okafor   attribute_not_exists(SK)
  Put             STUDENT#S00481  TIME#w#<iso>     attribute_not_exists(SK)
  Put             BOOKING#<uuid>  META             attribute_not_exists(PK)
])
```

Five items, one atomic write, four promises kept:

| Condition | Keeps the promise |
| --- | --- |
| the student exists | "gated by an existing student number" |
| the slot is unclaimed | one confirmation and one clean rejection |
| the family holds no other slot with this teacher | "One slot per teacher per family" |
| the family holds nothing else at that hour | one parent cannot be in two rooms at once |

The last one is the likelier mistake and the easiest to miss. `CLAIM#` stops the
same teacher twice; it says nothing about two *different* teachers at 5:00. Each
booking succeeds on its own, which is exactly why it needs a guard rather than
the parent's attention.

The first condition alone is why this is a transaction rather than a single
conditional write. Securing the slot is one line; securing *the slot and the
family's other bookings together* is not something one condition can do.

### Telling the failures apart

A cancelled transaction throws one exception for all four conditions. Left
there, every failure is a 409 — so a parent who mistyped their child's number is
told the slot was taken, and goes hunting for another time that will fail the
same way.

`CancellationReasons` is positional and parallel to `TransactItems`, so the
index of the failing entry says exactly what went wrong:

| Failed | Answer |
| --- | --- |
| `[0]` student | `404` No student with that number |
| `[1]` slot, item present | `409` That time was just taken |
| `[1]` slot, item absent | `404` No such slot — a stale link, not a race |
| `[2]` claim | `409` You already have a slot with this teacher |
| `[3]` time | `409` You already have an interview at that time |

That last split needs `ReturnValuesOnConditionCheckFailure: "ALL_OLD"` on the
slot update — without it a slot that never existed and a slot somebody just took
are the same failure at the same index. The returned item is **not** unmarshalled
by the document client, so the handler tests it for presence and never reads an
attribute out of it.

## Routes

| | | |
| --- | --- | --- |
| `POST /windows` | office | opens an evening and generates its slot grid |
| `GET /windows/{id}/slots` | public | the times, and which are gone |
| `POST /bookings` | public | the transaction above |
| `GET /windows/{id}/bookings` | staff | the roster: who is coming, and when |
| `POST /bookings/lookup` | public | reference + student number → that family's whole evening |
| `DELETE /bookings/{ref}` | public | give the slot back |
| `POST /uploads` | office | a presigned POST policy for one PDF under `docs/` |
| `GET /documents` | public | what staff have published |

`POST /windows` is the first route to check `isOffice` rather than `isStaff`.
The authorizer validates the token but cannot read an arbitrary claim, so the
group check belongs in the handler — decided in 02, used here.

**Cancellation without accounts.** There are no parent logins, so the booking
reference is the capability: a v4 uuid, sent only to the parent who booked. The
student number is required alongside it, so a reference forwarded in an email is
not on its own enough to cancel someone's interview.

`POST /bookings/lookup` exists because a reference addresses exactly one
booking. A family that booked three teachers and kept one confirmation could
only ever cancel that one. Looking up by student number alone would be a leak —
it is on every report card and is `S` plus five digits — so the lookup takes
both, and holding a valid reference is what proves membership.

**Uploads never pass through Lambda.** `POST /uploads` signs a policy and
returns it; the browser posts the file straight to S3. A presigned **POST**, not
PUT, because only POST carries a `content-length-range` condition — the one
server-enforced size ceiling in a system with a $20/month budget.

## The same query, two audiences

The parent's list and the office's roster read the same items in the same order.
What differs is what may leave the building — a booked slot carries a student
number.

```
toPublicSlot(item)  → { slotId, teacherName, startsAt, available }
toStaffSlot(item)   → + teacherId, studentNumber, bookingRef, bookedAt
```

`GET /windows/{id}/slots` has no authorizer at all, so that projection *is* the
security boundary. `mappers.test.ts` pins the public shape key-for-key, which
means a field added to the slot item later fails a test instead of quietly
appearing in a response any stranger can fetch.

## Applying it

```
cd 04-booking
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply
```

**The booking routes needed no new Terraform.** Seven Lambdas, log groups, IAM
roles and API Gateway routes, all from seven manifest entries, because
`modules/booking` builds every one by iterating `routes.json`.

Three things did change, and each is worth knowing:

- **`dynamodb:ConditionCheckItem`** had to be added to the `readwrite` policy.
  `TransactWriteItems` does not imply it — a ConditionCheck entry is a *read*
  authorised separately from the writes around it, and one denied entry fails
  the whole transaction. Invisible locally, because DynamoDB Local grants
  everything. Found by deploying.
- **A `bucket` field on the manifest**, so a route can declare S3 access
  independently of table access. The upload route touches no table; the booking
  routes touch no bucket.
- **`staff.tf`**, which runs `scripts/create-staff.sh` after the pool exists.

Then seed it and book:

```
API=$(terraform output -raw api_url)
curl -s "$API/windows/autumn-2026/slots" | jq
```

Only one stage may be applied at a time — they collide on globally unique names.
Apply, verify, destroy, then move on. `03-data` must be destroyed first.

## Demo data

Everything below is invented. The school is fictional and no real person's
details are in this repo.

### Students

The booking transaction's first condition is that the student exists, so a table
with no students rejects every booking with a 404. These four are written by
both seeds:

| Number | Name | Grade |
| --- | --- | --- |
| `S00481` | Amara Okonkwo | 11 |
| `S00482` | Daniel Tremblay | 11 |
| `S00483` | Priya Raman | 9 |
| `S00484` | Noah Fitzgerald | 12 |
| `S00485`–`S00488` | reserved for the browser e2e suite | |

`S00481` is the one printed in the form's placeholder. The last four exist only
so `site/e2e/site.spec.ts` never books against the same student as
`site/e2e/api.spec.ts` — the two files run in parallel against one database, and
sharing a student made one suite trip the other's time-conflict guard.

Anything else — `S99999` — is a valid *format* and not on the roll, which is how
you see `404 No student with that number` rather than a 409.

### Staff sign-in

The pool is recreated on every apply, so it starts empty. Set these in
`terraform.tfvars` (gitignored) and the apply creates one office-staff account:

```hcl
demo_staff_email    = "you@example.com"
demo_staff_password = "Str0ng!DemoPassw0rd"
```

Leave the password out and Cognito emails a temporary one and forces a change at
first sign-in — correct for a real account, tedious for a demo.

Accounts are **not** `aws_cognito_user` resources. `password` is `sensitive`,
which in Terraform means plaintext in state, and `terraform destroy` would
delete every staff account in a workflow built on apply/verify/destroy. The
provisioner runs `scripts/create-staff.sh`, the same script you would run by
hand, and nothing about the account reaches state. Set no email and no account
is created at all.

Office group membership matters: `POST /windows` and `POST /uploads` check
`isOffice`, so a teacher outside that group signs in fine and gets a 403.

### Interview windows

| Window | When | Published |
| --- | --- | --- |
| `autumn-2026` | Wed 14 Oct 2026, 5:00–8:00 pm | yes |
| `spring-2027` | Wed 10 Mar 2027, 5:00–8:00 pm | no |

Four teachers × nine twenty-minute slots = **36 slots** per evening. `spring-2027`
is unpublished on purpose, so there is something for the public route's 404 path
to actually be about.

Times are stored as the real instant in UTC — 5:00 pm Toronto in October is
`21:00Z`, because October is daylight time. Writing `17:00:00Z` and meaning
"5 pm" is how every slot ended up three hours early once the front end started
formatting them.

### Seeding

```
./app.sh --start                                  # local: students, windows, 72 slots
cd backend && npm run seed:aws -- --table $(terraform -chdir=../04-booking output -raw table_name)
```

The local stack seeds on every boot; a deployed stage seeds nothing, which is
why a fresh apply shows "Booking for this evening is not open yet". Add
`--dry-run` to see what would be written. Every write is conditional, so
re-running never overwrites a booking made while testing.

## Developing against it without applying anything

```
./app.sh --start
curl -s http://127.0.0.1:3000/windows/autumn-2026/slots | jq
```

The seed loads four students and both interview evenings with their full slot
grids, using the same `generateSlots` the deployed handler uses — so a slot key
bug shows up on a laptop rather than only against a stage that costs money.

`--api` is gone: `--start` brings up the database, the tables, the seed and the
API together. Every reason to start one is a reason to have the others.

## Known and accepted

**`WINDOW#<id>` is a low-cardinality partition key.** One evening's writes all
land on one partition, which is the textbook hot-key anti-pattern. At ~300
bookings across three hours that is roughly 0.03 writes/second against a 1000 WCU
partition limit — a rounding error at this size, and the first thing to revisit
if this ever served a district rather than one school.

**No waitlist, and there will not be one.** A full slot is a 409 and nothing
more. The atomic-counter and zero-padded-position design stays in
`.claude/rules/data-model.md` as a thing that was designed, priced and then cut.
The interviews page still promises one, which is copy to fix.

**No confirmation email.** SES arrives in 05, which is now the whole subject of
that episode. For now the booking reference comes
back in the response body, which is also what a parent needs to cancel.

**No DynamoDB stream on the table.** Cancellation frees the slot by removing
`bookedBy`, and that removal is the event 05 will watch to send the
cancellation email. Building the stream now would mean building it twice.
