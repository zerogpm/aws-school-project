// The standard patterns, in one place.
//
// Every one of these guards a value that arrives from outside: a request body a
// stranger controls, or a filename a member of staff picked. They are
// deliberately boring and deliberately strict - the job is to reject early with
// a message, not to be clever.
//
// Anchored with ^...$ throughout. An unanchored regex matches a *substring*,
// so `/\.pdf/` happily accepts "evil.exe?x=.pdf" and `/S\d{5}/` accepts
// "nonsense S00481 nonsense". Anchoring is the difference between validating a
// value and finding one inside it.
//
// Mirrored on the front end where it improves the form - see site/src/data.ts.
// A client-side check stops typos, not attackers, so these run server-side too.

/**
 * Email, pragmatically.
 *
 * Not RFC 5322 - that grammar permits quoted strings, comments and nested
 * parentheses, and the "correct" regex for it is famously several kilobytes and
 * still wrong. This accepts what a parent will actually type and rejects what
 * breaks downstream: no spaces, exactly one @, a dot in the domain, and a
 * plausible TLD.
 *
 * The real validation is that SES delivers it, which is episode 05's problem.
 * This one exists to reject "sarah@" and "sarah at gmail" before they are
 * stored on a booking nobody can then be told about.
 */
export const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * A filename safe to put in an S3 key.
 *
 * Letters, digits, space, dot, dash, underscore. Nothing else, and it may not
 * start with a dot.
 *
 * The exclusions matter more than the inclusions. `/` and `\` would let a
 * filename climb out of its prefix - "../../index.html" uploaded under docs/
 * lands somewhere it was never meant to. A leading dot hides the file. `..` as
 * a whole name is path traversal spelled plainly. Control characters and
 * newlines break the signature and the logs.
 *
 * Uploads are keyed by a generated uuid anyway, so this validates the *display*
 * name rather than the key. Both, because a name that reaches a Content-
 * Disposition header can carry an injection of its own.
 */
export const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$/;

/** Ends in .pdf, case-insensitive, and has something before the dot. */
export const PDF_FILENAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,195}\.pdf$/i;

/**
 * The one content type the upload route will sign for.
 *
 * Exact, not a prefix match: "application/pdfx" and "application/pdf; x=1" are
 * both refused. A parameter is legal in a real Content-Type header, and is also
 * the shape used to smuggle a second type past a lazy check.
 */
export const PDF_CONTENT_TYPE = /^application\/pdf$/;

/** ISO-8601 with a Z. What every timestamp in this system is stored as. */
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** A v4 uuid, which is what a booking reference is. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A slug for anything that becomes part of a key or a URL: window ids, teacher
 * ids. Lowercase, digits and hyphens, so nothing downstream needs escaping.
 */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Trimmed, and only then tested. Non-strings are always false, never a throw. */
function matches(pattern: RegExp, value: unknown): boolean {
  if (typeof value !== "string") return false;
  return pattern.test(value.trim());
}

export const isEmail = (value: unknown): boolean => matches(EMAIL, value);
export const isSafeFilename = (value: unknown): boolean => matches(SAFE_FILENAME, value);
export const isPdfFilename = (value: unknown): boolean => matches(PDF_FILENAME, value);
export const isPdfContentType = (value: unknown): boolean => matches(PDF_CONTENT_TYPE, value);
export const isIsoUtc = (value: unknown): boolean => matches(ISO_UTC, value);
export const isUuidV4 = (value: unknown): boolean => matches(UUID_V4, value);
export const isSlug = (value: unknown): boolean => matches(SLUG, value);
