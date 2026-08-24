// Office staff unpublish a document.
//
// The caller names a uuid, never a key. That is the whole security design of
// this route: a key is a path, and a path is something an attacker gets to
// shape - "../../index.html" under a bucket that also holds the site would be a
// very bad afternoon. A uuid is checked against a regex and then used to build
// the prefix ourselves, so the only thing the caller influences is *which*
// document, never *where* we look.
//
// It also means this route needs ListBucket. It cannot delete `docs/<id>/...`
// without first discovering the filename on the end, because the filename is
// part of the key and only the browser ever knew it.
//
// Deleting is not losing. The media bucket has versioning on, so this writes a
// delete marker and the object is still recoverable from the console until the
// lifecycle rule expires the noncurrent version. Worth knowing before the
// office deletes the year calendar in October.
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DOCS_PREFIX, MEDIA_BUCKET, s3 } from "../../media.js";
import { isUuidV4 } from "../../validate.js";
import { isOffice } from "../auth.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, forbidden, notFound, ok, serverError } from "../http.js";

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    // Office staff, not merely signed-in staff - the same gate as publishing.
    // The JWT authorizer has proved the token is valid and cannot read
    // cognito:groups, so the group check belongs here.
    if (!isOffice(event)) return forbidden(event, "Office staff only");

    // Absent, not {}, when API Gateway sends no path parameters - which is
    // never for this route, but the type says optional and a handler that
    // assumes otherwise reads undefined in production.
    const id = event.pathParameters?.id ?? "";

    if (!isUuidV4(id)) {
      // Also the answer for the earliest uploads, whose keys have no uuid
      // segment at all. They list, they do not delete here, and the message
      // says so rather than 404ing as though they were gone.
      return badRequest(event, "Not a document id");
    }

    const prefix = `${DOCS_PREFIX}${id}/`;

    const { Contents } = await s3.send(
      new ListObjectsV2Command({ Bucket: MEDIA_BUCKET, Prefix: prefix, MaxKeys: 10 }),
    );

    const keys = (Contents ?? []).map((object) => String(object.Key)).filter(Boolean);

    if (keys.length === 0) {
      // Already gone, or never existed. Not an error worth a 500, and staff
      // deleting the same row twice from two tabs is a real thing.
      return notFound(event, "No such document");
    }

    // One at a time rather than DeleteObjects. There is exactly one object
    // under a uuid prefix, the batch API reports per-key failures in a 200 body
    // that is easy to ignore by accident, and a loop over one item is not a
    // performance problem.
    for (const key of keys) {
      await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    }

    return ok(event, {
      id,
      filename: keys[0].slice(prefix.length),
      deleted: keys.length,
    });
  } catch (error) {
    console.error("delete-document failed", error);
    return serverError(event);
  }
};
