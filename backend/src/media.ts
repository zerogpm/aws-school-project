// The media bucket, and the one switch that is not there.
//
// db.ts has a DYNAMODB_ENDPOINT seam because DynamoDB Local exists, is free and
// is complete. S3 has no such thing, so this file has no seam at all: the same
// client talks to the same real bucket from a laptop and from Lambda, resolving
// credentials from AWS_PROFILE locally and the execution role deployed.
//
// That matches how Cognito already works here - backend/local/env.ts has no
// Cognito entry, and the local sign-in form posts to the real regional endpoint.
// One code path, no isLocal, and Golden Rule 4 satisfied without an emulator.
//
// The consequence, stated rather than discovered: a stage must be applied for
// uploads to work locally, and an IAM mistake will pass on a laptop - where the
// developer's profile is broad - and fail deployed with AccessDenied. That is
// the same gap lambda.tf already documents for DynamoDB, and deploying a stage
// is what closes it.
import { S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "./env.js";

/** The bucket holding docs/, photos/ and video/. Wired by modules/booking. */
export const MEDIA_BUCKET = requireEnv("MEDIA_BUCKET");

/**
 * Where staff-uploaded PDFs live.
 *
 * The prefix is not cosmetic. modules/static-site scopes its lifecycle rules by
 * prefix: photos/ and video/ age into Glacier IR, and docs/ deliberately does
 * not, because the year calendar and permission forms are read all year and a
 * retrieval fee on those is backwards. An upload written outside docs/ would
 * quietly get the wrong storage economics.
 */
export const DOCS_PREFIX = "docs/";

/**
 * 20 MB.
 *
 * Enforced by S3 itself through the presigned POST policy, not merely checked
 * in the browser. A school newsletter is under a megabyte; twenty is generous
 * for a scanned year calendar and small enough that nobody parks a video here
 * by accident. The whole system's budget is $20 a month.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Minutes, not hours. The signed policy is a bearer capability while it lives. */
export const UPLOAD_EXPIRY_SECONDS = 300;

export const s3 = new S3Client({});
