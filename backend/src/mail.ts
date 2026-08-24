// SES, and the second file in this repo with no local seam.
//
// media.ts already made this argument for S3 and it holds here unchanged: db.ts
// has a DYNAMODB_ENDPOINT seam because DynamoDB Local exists, is free and is
// complete. There is no local SES, and inventing one would be a second
// implementation of the thing under test - the part most worth testing is
// whether a real message leaves for a real inbox.
//
// So the same client talks to the same real SES from a laptop and from Lambda,
// resolving credentials from AWS_PROFILE locally and the execution role
// deployed. One code path, no isLocal, and Golden Rule 4 satisfied without an
// emulator.
//
// The consequence, stated rather than discovered: nothing mails anyone from a
// laptop unless a stage is applied and the address is verified. That is a row in
// backend/README.md's "What local does not reproduce" table, not a gap to paper
// over - and it is why the booking-email handler is covered by unit tests
// against synthetic stream events rather than by an end-to-end local run.
//
// Existing as a module at all is also what makes the handler testable: a test
// mocks "../../mail.js" exactly the way the booking handlers mock "../../db.js".
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { requireEnv } from "./env.js";

/**
 * The From address on parent mail. Wired by modules/booking from the identity
 * modules/email verifies.
 *
 * requireEnv at module load, not inside the send: src/routes.parity.test.ts can
 * only see names requested during import, so a lazily-resolved variable would
 * pass the parity check and then be undefined on a deployed function.
 */
export const FROM_ADDRESS = requireEnv("SES_FROM_ADDRESS");

/**
 * Where a parent goes to change or cancel. Every message carries it, because
 * the alternative is a parent replying to a no-reply address.
 */
export const SITE_BASE_URL = requireEnv("SITE_BASE_URL");

export const ses = new SESv2Client({});
