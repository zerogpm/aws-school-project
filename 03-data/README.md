# Episode 03: Data

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

Episode documentation will be added here.

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
