// Identity, and the second of the three environment seams.
//
// Deployed, these values come out of a JWT the API Gateway authorizer has
// already validated - signature, issuer, audience and expiry are all settled
// before the Lambda is invoked, so nothing here re-verifies anything. Locally,
// backend/local/app.ts injects the same claim shape. A handler calls these
// functions and cannot tell which runtime it is in, which is the entire point.
import type { ApiEvent } from "./http.js";

type Claims = Record<string, string | number | boolean | string[]>;

/** Empty on a public route, where there is no authorizer at all. */
export function getClaims(event: ApiEvent): Claims {
  return event.requestContext.authorizer?.jwt?.claims ?? {};
}

/** The Cognito `sub`. Stable across an email change, unlike the address. */
export function getStaffId(event: ApiEvent): string {
  const sub = getClaims(event).sub;
  return typeof sub === "string" ? sub : "";
}

/** Lowercased: teachers' phones capitalise addresses however they like. */
export function getStaffEmail(event: ApiEvent): string {
  const email = getClaims(event).email;
  return typeof email === "string" ? email.toLowerCase() : "";
}

/** Whether the request carried a verified token at all. */
export function isStaff(event: ApiEvent): boolean {
  return getStaffId(event) !== "";
}

/**
 * The `cognito:groups` claim, normalised.
 *
 * Roles live in Cognito and get no column in DynamoDB - see 03-data/README.md.
 * The claim is already in the token, signed and verified, so copying it into a
 * staff item would create a second source of truth that nothing keeps in sync.
 *
 * Two shapes are accepted because the wire format is not something to be
 * confident about from memory: a JSON array is what the claim is, but an HTTP
 * API JWT authorizer has been known to flatten multi-valued claims into a
 * bracketed, space-separated string ("[office teachers]"). Handling both costs
 * four lines; guessing wrong costs an authorisation bug that only exists
 * deployed. Confirm the real shape against the deployed authorizer and record
 * it in MISTAKES.md.
 */
export function getGroups(event: ApiEvent): string[] {
  const groups = getClaims(event)["cognito:groups"];

  if (Array.isArray(groups)) return groups;
  if (typeof groups !== "string") return [];

  return groups
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * Office staff, who may open interview windows and publish the timetable.
 *
 * This is the coarse role check and it is answered entirely from the token -
 * free, and already verified. The table is read only for per-record ownership
 * ("may this person edit *this* window"), which is not a role question and
 * could never live in a group.
 */
export function isOffice(event: ApiEvent): boolean {
  return getGroups(event).includes("office");
}
