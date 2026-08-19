---
paths:
  - "03-data/**"
  - "04-booking/**"
  - "05-waitlist/**"
  - "modules/booking/**"
---

# Data Model

Single DynamoDB table, on-demand billing, point-in-time recovery on.

```
PK: COURSE#123   SK: META                capacity, enrolled, wait_count
PK: COURSE#123   SK: ENROLL#S00481       student, booked_at
PK: COURSE#123   SK: WAIT#000042         student, joined_at
PK: COURSE#123   SK: WAIT_MEMBER#S00481  dedupe marker
```

## Concurrency rules

These exist because a booking cannot be lost. Do not "simplify" them away.

- **Single-capacity slot (interview):** `ConditionExpression:
  attribute_not_exists(booked_by)`
- **Multi-capacity (club):** `ConditionExpression: enrolled < capacity` with
  `UpdateExpression: SET enrolled = enrolled + 1`
- **Waitlist position:** atomic counter on the META item (`SET wait_count =
  wait_count + 1`, `ReturnValues: UPDATED_NEW`). NEVER a timestamp — concurrent
  Lambdas collide on the same millisecond.
- **Zero-pad the position** in the sort key (`WAIT#000042`). Sort keys sort as
  strings, so `WAIT#10` sorts before `WAIT#9` without padding.
- **Dedupe:** write `WAIT_MEMBER#<student>` with `attribute_not_exists` in a
  transaction with the counter increment.

Booking is synchronous by design. A queue was rejected: SQS standard is
at-least-once and still races.

## Waitlist behaviour

- Full → the response offers the waitlist with the current queue length. Opt-in
  only; joining is a second, separate API call.
- Do NOT renumber on departure. Leave gaps and show "N people ahead of you" by
  counting items below the caller's key.
- Cancellation → DynamoDB Stream fires → next person promoted and emailed
  via SES.
- **No claim window / expiry in this build.** This is a known gap, stated on
  camera. A real deployment needs one (DynamoDB TTL or a scheduled Lambda).
