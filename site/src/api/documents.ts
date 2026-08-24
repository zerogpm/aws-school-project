// Publishing and reading school documents.
//
// Uploading is two requests and they do different things. The first asks our
// API for permission and gets back a signed policy; the second sends the file
// to S3 directly, with that policy attached. The file never passes through
// Lambda - a Lambda request caps at ~6MB, and paying for compute to shuttle
// bytes is what presigned uploads exist to avoid.
//
// Which means the authorisation happened in step one. S3 never learns who the
// browser is; it only validates a signature it issued.
import { apiBaseUrl, type ApiResult } from "./interviews";

/** Mirrors backend/src/media.ts. Checked here for fast feedback, enforced there. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type PublishedDocument = {
  /**
   * The uuid segment of the S3 key, and the only handle the delete route
   * accepts. Never a key: a key is a path, and a path is something a caller
   * gets to shape.
   */
  id: string;
  key: string;
  filename: string;
  /**
   * Where the browser fetches the file. Built by the API from the CloudFront
   * distribution, not assembled here - the bucket is private, so the S3 URL
   * answers 403, and putting the docs/ prefix in the front end too would be a
   * second place for it to be wrong.
   */
  url: string;
  bytes: number;
  updatedAt: string;
};

type UploadTicket = {
  url: string;
  fields: Record<string, string>;
  key: string;
  id: string;
  filename: string;
  maxBytes: number;
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON - S3 answers XML, and a proxy may answer HTML.
  }
  return "Something went wrong. Please try again.";
}

/**
 * Is this a PDF, really?
 *
 * Reads the first five bytes and looks for %PDF-. This is the check the server
 * genuinely cannot do: verifying the bytes means reading the file, and the file
 * deliberately never reaches our API. The signature pins the declared
 * Content-Type as a backstop, but a declaration is not an inspection.
 *
 * Stops mistakes, not attackers - and the uploader is authenticated office
 * staff, so mistakes are the realistic failure.
 */
export async function looksLikePdf(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return (
    header.length === 5 &&
    header[0] === 0x25 && // %
    header[1] === 0x50 && // P
    header[2] === 0x44 && // D
    header[3] === 0x46 && // F
    header[4] === 0x2d // -
  );
}

export async function fetchDocuments(): Promise<ApiResult<PublishedDocument[]>> {
  try {
    const response = await fetch(`${apiBaseUrl()}/documents`);
    if (!response.ok) {
      return { ok: false, error: await readError(response), status: response.status, retry: false };
    }

    const body = (await response.json()) as { documents: PublishedDocument[] };
    return { ok: true, value: body.documents };
  } catch {
    return { ok: false, error: "Could not reach the document service.", status: 0, retry: true };
  }
}

/**
 * Publish one PDF: ask for a policy, then send the file straight to S3.
 *
 * `accessToken` is the Cognito ID token. Only office staff get past the
 * authorizer and the isOffice check behind it, so this is the entire gate -
 * step two has no idea who is calling it.
 */
export async function uploadDocument(input: {
  file: File;
  accessToken: string;
}): Promise<ApiResult<{ key: string; id: string; filename: string }>> {
  const { file, accessToken } = input;

  // Checked before the round trip, so a 30MB file fails in a millisecond rather
  // than after a long upload S3 would reject anyway.
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 20MB.`,
      status: 0,
      retry: false,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "That file is empty.", status: 0, retry: false };
  }

  if (!(await looksLikePdf(file))) {
    return { ok: false, error: "That file is not a PDF.", status: 0, retry: false };
  }

  let ticket: UploadTicket;

  try {
    const response = await fetch(`${apiBaseUrl()}/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ filename: file.name }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 401
            ? "Your session has expired. Sign in again."
            : await readError(response),
        status: response.status,
        retry: false,
      };
    }

    ticket = (await response.json()) as UploadTicket;
  } catch {
    return { ok: false, error: "Could not reach the upload service.", status: 0, retry: true };
  }

  // Step two: multipart form straight to S3. The policy fields must come first
  // and the file last - S3 ignores anything after the file part, so a field
  // appended afterwards is silently dropped and the signature fails.
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) {
    form.append(name, value);
  }
  form.append("file", file);

  try {
    const upload = await fetch(ticket.url, { method: "POST", body: form });

    if (!upload.ok) {
      // S3 answers XML here, not JSON. The status is the useful part: 403 is
      // usually an expired policy or a condition the file broke.
      return {
        ok: false,
        error:
          upload.status === 403
            ? "The upload was refused - the link may have expired. Try again."
            : `The upload failed (${upload.status}).`,
        status: upload.status,
        retry: true,
      };
    }
  } catch {
    return { ok: false, error: "The upload could not be sent.", status: 0, retry: true };
  }

  return { ok: true, value: { key: ticket.key, id: ticket.id, filename: ticket.filename } };
}

/**
 * Unpublish a document.
 *
 * Takes the id rather than the key for the same reason the API does: the id is
 * a uuid the server can check, and a key is a path the server would have to
 * trust. `accessToken` is the Cognito ID token - the authorizer's audience is
 * the app client id, and only the ID token carries a matching `aud`.
 *
 * The object is versioned in S3, so this writes a delete marker rather than
 * shredding anything. Recoverable from the console until the lifecycle rule
 * expires the noncurrent version.
 */
export async function deleteDocument(input: {
  id: string;
  accessToken: string;
}): Promise<ApiResult<{ id: string }>> {
  try {
    const response = await fetch(`${apiBaseUrl()}/documents/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 401
            ? "Your session has expired. Sign in again."
            : response.status === 404
              ? "That document is already gone."
              : await readError(response),
        status: response.status,
        // A 404 here means somebody else deleted it, so the list is stale and
        // refreshing fixes it. Retrying the delete would not.
        retry: false,
      };
    }

    return { ok: true, value: { id: input.id } };
  } catch {
    return { ok: false, error: "Could not reach the document service.", status: 0, retry: true };
  }
}

/** Bytes as something a person reads. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
