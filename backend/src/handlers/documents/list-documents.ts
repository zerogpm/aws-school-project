// What staff have published, for anyone to download.
//
// Public on purpose: newsletters, the year calendar and permission forms are
// meant to be readable by every parent, and there are no parent accounts to
// gate them behind. Upload is office-only; reading is not.
//
// Lists the bucket rather than the table. A DynamoDB index over the documents
// would be faster and would let staff title and order them - and it would also
// be a second source of truth that drifts the first time somebody deletes an
// object from the console. A handful of school PDFs is one ListObjectsV2 call.
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { requireEnv } from "../../env.js";
import { DOCS_PREFIX, MEDIA_BUCKET, s3 } from "../../media.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { ok, serverError } from "../http.js";

/**
 * Where a browser can fetch the object - the CloudFront distribution, which is
 * the same origin the site itself is served from.
 *
 * Built here rather than in the front end, because the front end knows the API
 * URL and nothing else, and rebuilding an S3 key into a public URL in the
 * browser would put the docs/ prefix in two places. Read in this file rather
 * than in media.ts on purpose: create-upload imports media.ts and does not need
 * this, and a variable read transitively but not declared is exactly what
 * routes.parity.test.ts exists to catch.
 *
 * The bucket is private - CloudFront reaches it with OAC - so this is the only
 * URL that works. The S3 one answers 403.
 */
const MEDIA_BASE_URL = requireEnv("MEDIA_BASE_URL").replace(/\/+$/, "");

export type PublishedDocument = {
  /** The uuid segment of the key. What DELETE /documents/{id} takes. */
  id: string;
  key: string;
  filename: string;
  url: string;
  bytes: number;
  updatedAt: string;
};

/**
 * Splits `docs/<uuid>/<filename>` into its two halves.
 *
 * Tolerant of a key with no slash, which is what the first uploads produced
 * before the filename moved into the key. Those list with the uuid-ish name
 * they have and are not deletable through the API - `id` will not pass the
 * uuid check on the delete route. Listing them anyway beats hiding an object
 * that is really there and really costing money.
 */
function splitKey(key: string): { id: string; filename: string } {
  const relative = key.slice(DOCS_PREFIX.length);
  const slash = relative.indexOf("/");

  if (slash === -1) return { id: relative, filename: relative };
  return { id: relative.slice(0, slash), filename: relative.slice(slash + 1) };
}

/**
 * A key as a URL path.
 *
 * Encoded per segment, not whole: encodeURIComponent would turn the separating
 * slashes into %2F and ask CloudFront for one object with slashes in its name.
 * Filenames here contain spaces routinely - SAFE_FILENAME allows them - and an
 * unencoded space is not a legal URL.
 */
function toUrl(key: string): string {
  return `${MEDIA_BASE_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    const { Contents } = await s3.send(
      new ListObjectsV2Command({
        Bucket: MEDIA_BUCKET,
        Prefix: DOCS_PREFIX,
        // A school will not have a thousand documents, and paginating a list
        // nobody scrolls is complexity for its own sake. If this ever truncates
        // it will do so silently, which is the trade being made knowingly.
        MaxKeys: 200,
      }),
    );

    const documents: PublishedDocument[] = (Contents ?? [])
      // The prefix itself comes back as a zero-byte object if anything ever
      // creates one, and it is not a document.
      .filter((object) => object.Key && object.Key !== DOCS_PREFIX && (object.Size ?? 0) > 0)
      .map((object) => {
        const key = String(object.Key);
        const { id, filename } = splitKey(key);

        return {
          id,
          key,
          filename,
          url: toUrl(key),
          bytes: object.Size ?? 0,
          updatedAt: object.LastModified?.toISOString() ?? "",
        };
      })
      // Newest first: the thing staff just published is the thing parents came
      // for.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return ok(event, { documents });
  } catch (error) {
    console.error("list-documents failed", error);
    return serverError(event);
  }
};
