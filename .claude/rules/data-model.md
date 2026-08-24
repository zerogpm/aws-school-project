---
paths:
  - "03-data/**"
  - "04-booking/**"
  - "05-email/**"
  - "modules/booking/**"
---

# Data Model

Single DynamoDB table, on-demand billing, point-in-time recovery on.

**Attributes are camelCase.** `bookedBy`, not `booked_by`. Keys and their
prefixes are SCREAMING (`PK`, `SK`, `WINDOW#`, `CLAIM#`); everything else
matches the TypeScript that reads it. Built in `backend/src/booking/keys.ts`,
never spelled out inline — a key assembled two ways does not error, it finds
nothing, which reads like data loss rather than like a typo.

Interviews — built in `04-booking`, single-capacity:

```
PK: WINDOW#autumn-2026   SK: META                       label, opensAt, closesAt,
                                                        published, slotMinutes
PK: WINDOW#autumn-2026   SK: SLOT#<iso>#<teacher>       teacherId, teacherName,
                                                        startsAt, bookedBy?,
                                                        bookingRef?, bookedAt?
PK: STUDENT#S00481       SK: PROFILE                    name, grade
PK: STUDENT#S00481       SK: CLAIM#<window>#<teacher>   one-per-teacher guard
PK: BOOKING#<uuid>       SK: META                       windowId, slotId, teacherId,
                                                        studentNumber, startsAt
```

The slot key leads with the timestamp so one query on the window returns the
evening in chronological order — both the parent's list and the office's roster
want that, and neither has to sort. `CLAIM#` is not data: it exists to be
written with `attribute_not_exists` inside the booking transaction.

Clubs and activities — multi-capacity, not yet built:

```
PK: COURSE#123   SK: META                capacity, enrolled, waitCount
PK: COURSE#123   SK: ENROLL#S00481       student, bookedAt
PK: COURSE#123   SK: WAIT#000042         student, joinedAt
PK: COURSE#123   SK: WAIT_MEMBER#S00481  dedupe marker
```

## Concurrency rules

These exist because a booking cannot be lost. Do not "simplify" them away.

- **Single-capacity slot (interview):** `ConditionExpression:
  attribute_not_exists(bookedBy)`, inside a `TransactWriteItems` that also
  condition-checks the student exists and writes the `CLAIM#` guard. One
  condition alone secures the slot but not "one slot per teacher per family".
  See `backend/src/handlers/bookings/create-booking.ts`.
- **Read the cancellation reasons.** `TransactionCanceledException.CancellationReasons`
  is positional and parallel to `TransactItems`. Ignore it and every failure is
  an indistinguishable 409, so a parent who mistyped a student number is told
  the slot was taken. Add `ReturnValuesOnConditionCheckFailure: "ALL_OLD"` where
  a missing item and a losing race would otherwise look identical. The field is
  **not** unmarshalled by the document client — test it for presence, never read
  an attribute out of it.
- **Multi-capacity (club):** `ConditionExpression: enrolled < capacity` with
  `UpdateExpression: SET enrolled = enrolled + 1`
- **Waitlist position:** atomic counter on the META item (`SET waitCount =
  waitCount + 1`, `ReturnValues: UPDATED_NEW`). NEVER a timestamp — concurrent
  Lambdas collide on the same millisecond.
- **Zero-pad the position** in the sort key (`WAIT#000042`). Sort keys sort as
  strings, so `WAIT#10` sorts before `WAIT#9` without padding.
- **Dedupe:** write `WAIT_MEMBER#<student>` with `attribute_not_exists` in a
  transaction with the counter increment.
- **Read consistently where a stale answer misleads.** Query and GetItem are
  eventually consistent by default. A parent who has just booked, or an office
  reading the roster ten minutes before the evening, must not be shown the
  previous state. `ConsistentRead: true` on the main table; a GSI cannot do it
  at all, which is one more reason slots are read through their window's
  partition rather than through an index.

Booking is synchronous by design. A queue was rejected: SQS standard is
at-least-once and still races.

**Known and accepted:** `WINDOW#<id>` is a low-cardinality partition key, so one
evening's writes all land on one partition — the textbook hot-key anti-pattern.
At ~300 bookings across three hours that is ~0.03 writes/second against a 1000
WCU partition limit, so it is a rounding error at this size. It is the first
thing to revisit if this ever serves a district rather than one school.

## Waitlist behaviour

**Cut on 2026-08-24 — do not build this.** Kept as a worked design that was
priced and refused, not as pending work. Episode 05 is confirmation email only.

- Full → the response offers the waitlist with the current queue length. Opt-in
  only; joining is a second, separate API call.
- Do NOT renumber on departure. Leave gaps and show "N people ahead of you" by
  counting items below the caller's key.
- Cancellation → DynamoDB Stream fires → next person promoted and emailed
  via SES.
- **No claim window / expiry in this build.** This is a known gap, stated on
  camera. A real deployment needs one (DynamoDB TTL or a scheduled Lambda).
