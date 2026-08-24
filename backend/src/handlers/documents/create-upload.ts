// Office staff ask for permission to upload one PDF.
//
// The file never touches this function. Lambda signs a policy and hands it
// back; the browser PUTs straight to S3. That is a cost decision as much as a
// design one - a Lambda request caps at ~6MB, so a scanned year calendar could
// not pass through here even if it should, and paying for compute to shuttle
// bytes is the thing presigned uploads exist to avoid.
//
// So the authorisation happens at the moment the policy is issued, not at the
// moment the file arrives. S3 never learns who the browser is; it only checks a
// signature. The gate is that the only way to obtain one is through the JWT
// authorizer and the isOffice check below.
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import {
  DOCS_PREFIX,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  UPLOAD_EXPIRY_SECONDS,
  s3,
} from "../../media.js";
import { isPdfFilename, isSafeFilename } from "../../validate.js";
import { isOffice } from "../auth.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, forbidden, ok, parseBody, serverError } from "../http.js";

type UploadRequest = {
  filename?: unknown;
  title?: unknown;
};

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    // Office staff, not merely signed-in staff. The JWT authorizer has already
    // proved the token is valid, but it cannot read an arbitrary claim like
    // cognito:groups - so the group check belongs here. Decided in 02.
    if (!isOffice(event)) return forbidden(event, "Office staff only");

    const body = parseBody<UploadRequest>(event);
    if (!body) return badRequest(event, "A JSON body is required");

    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!isSafeFilename(filename)) {
      // The exclusions are the point: a name carrying / or \ or .. would climb
      // out of docs/ and land somewhere with different storage economics, or
      // worse, over something already there.
      return badRequest(
        event,
        "Use a filename of letters, digits, spaces, dots, dashes and underscores",
      );
    }

    if (!isPdfFilename(filename)) {
      return badRequest(event, "Only PDF files can be uploaded");
    }

    // docs/<uuid>/<filename>. The uuid is generated here and is what addresses
    // the object, so two people uploading "calendar.pdf" cannot overwrite one
    // another; the filename rides along as the last segment purely so it can be
    // read back.
    //
    // It is a segment rather than a suffix because ListObjectsV2 does not
    // return metadata. The name used to live only in Content-Disposition, which
    // meant the admin page listed a row of uuids and getting the real name back
    // would have cost a HEAD per object. A slash makes it a split, not a
    // request. isSafeFilename has already refused / and \ and a leading dot, so
    // the caller cannot add segments of their own.
    const id = randomUUID();
    const key = `${DOCS_PREFIX}${id}/${filename}`;

    const presigned = await createPresignedPost(s3, {
      Bucket: MEDIA_BUCKET,
      Key: key,
      Expires: UPLOAD_EXPIRY_SECONDS,

      // Conditions are what S3 enforces on the actual PUT. A presigned *PUT*
      // URL cannot express a size limit at all - it accepts whatever arrives -
      // which is the entire reason this route hands back a POST policy instead.
      Conditions: [
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", "application/pdf"],
        // Belt to the generated key's braces: even if the client tampered with
        // the key field, it cannot escape the prefix.
        ["starts-with", "$key", DOCS_PREFIX],
      ],

      Fields: {
        "Content-Type": "application/pdf",
        // Shown to whoever downloads it, so the original name survives even
        // though the key is a uuid.
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });

    return ok(event, {
      // The browser posts these fields plus the file to `url`.
      url: presigned.url,
      fields: presigned.fields,
      key,
      // The handle the delete route takes. Returned so the page that just
      // uploaded can offer "remove that again" without waiting for a re-list.
      id,
      filename,
      title: title || filename,
      maxBytes: MAX_UPLOAD_BYTES,
      expiresIn: UPLOAD_EXPIRY_SECONDS,
    });
  } catch (error) {
    console.error("create-upload failed", error);
    return serverError(event);
  }
};
