import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/authState";
import {
  deleteDocument,
  fetchDocuments,
  formatBytes,
  MAX_UPLOAD_BYTES,
  uploadDocument,
  type PublishedDocument,
} from "../api/documents";

/**
 * Publish PDFs, and manage what is already published.
 *
 * The ID token, not the access token: the API Gateway JWT authorizer is
 * configured with the app client id as its audience, and only the ID token
 * carries a matching `aud` claim. An access token has `client_id` instead and
 * is refused with a bare 401 that says nothing about why.
 *
 * Replace is composed rather than a route of its own. It is an upload followed
 * by a delete, and doing it in that order means a failure leaves the old file
 * still published - the safe way round. A `PUT /documents/{id}` would have to
 * do the same two things server-side and would also have to invent an answer
 * for "the new one uploaded but the old one would not delete".
 */
export default function DocumentUpload() {
  const { session } = useAuth();
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<PublishedDocument[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Which row is asking "are you sure". An inline confirm rather than
  // window.confirm: a native dialog blocks the thread, cannot be styled, and is
  // untestable without stubbing a global.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Which row the hidden replace picker belongs to. One input reused, because
  // one per row would put N file inputs in the accessibility tree for a control
  // only ever used once at a time.
  const [replacing, setReplacing] = useState<string | null>(null);

  async function refresh() {
    const result = await fetchDocuments();
    setDocuments(result.ok ? result.value : []);
    if (!result.ok) setMessage(result.error);
  }

  useEffect(() => {
    void refresh();
  }, []);

  /**
   * Uploads one file and returns its new id, or null.
   *
   * Sequential rather than Promise.all when there are several: each upload is
   * two requests and the second is the whole file, so firing five at once
   * competes for the same uplink and makes every one of them slower.
   */
  async function upload(file: File): Promise<string | null> {
    if (!session) return null;

    const result = await uploadDocument({ file, accessToken: session.idToken });
    if (result.ok) return result.value.id;

    // Named, because with several files "the upload failed" does not say which.
    setMessage(`${file.name}: ${result.error}`);
    return null;
  }

  async function handleFiles(files: File[]) {
    if (!session || files.length === 0) return;

    setMessage(null);
    setDone(null);

    const published: string[] = [];

    for (const [index, file] of files.entries()) {
      setBusy(files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : "Uploading…");
      if (await upload(file)) published.push(file.name);
    }

    setBusy(null);

    if (published.length === 1) setDone(`${published[0]} is published.`);
    else if (published.length > 1) setDone(`${published.length} documents are published.`);

    await refresh();

    // Clear the picker, so choosing the same file again re-fires onChange.
    if (addRef.current) addRef.current.value = "";
  }

  async function handleDelete(document: PublishedDocument) {
    if (!session) return;

    setConfirming(null);
    setMessage(null);
    setDone(null);
    setBusy(`Removing ${document.filename}…`);

    const result = await deleteDocument({ id: document.id, accessToken: session.idToken });

    setBusy(null);
    if (result.ok) setDone(`${document.filename} is no longer published.`);
    else setMessage(result.error);

    // Either way. A 404 means somebody else deleted it and the list is stale,
    // which is exactly when a refresh is most useful.
    await refresh();
  }

  async function handleReplace(file: File) {
    const target = documents?.find((document) => document.id === replacing);
    setReplacing(null);
    if (replaceRef.current) replaceRef.current.value = "";
    if (!session || !target) return;

    setMessage(null);
    setDone(null);
    setBusy(`Replacing ${target.filename}…`);

    // Upload first. If this fails the old document is still published, which is
    // the failure everyone would choose.
    const uploaded = await upload(file);

    if (uploaded) {
      const removed = await deleteDocument({ id: target.id, accessToken: session.idToken });
      if (removed.ok) setDone(`${target.filename} was replaced by ${file.name}.`);
      else setMessage(`${file.name} is published, but ${target.filename} could not be removed.`);
    }

    setBusy(null);
    await refresh();
  }

  const disabled = busy !== null;

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="document" className="block text-sm font-medium text-ink">
          Choose PDFs
        </label>
        <input
          ref={addRef}
          id="document"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={disabled}
          onChange={(event) => void handleFiles([...(event.target.files ?? [])])}
          className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-forest-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-forest-900 disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-muted">
          Up to {formatBytes(MAX_UPLOAD_BYTES)} each, and you can pick several at once. Files go
          straight to S3 &mdash; they never pass through the API.
        </p>
      </div>

      {/* The replace picker. Hidden rather than absent: a row's Replace button
          sets the target and clicks this, so there is one file input for N
          rows instead of N. */}
      <input
        ref={replaceRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleReplace(file);
        }}
      />

      {busy && (
        <p role="status" className="text-sm text-muted">
          {busy}
        </p>
      )}

      {done && (
        <p role="status" className="text-sm font-medium text-forest-900">
          {done}
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-brass">
          {message}
        </p>
      )}

      <div>
        <h3 className="text-sm font-medium text-ink">Published documents</h3>

        {documents === null && <p className="mt-2 text-sm text-muted">Loading&hellip;</p>}

        {documents?.length === 0 && (
          <p className="mt-2 text-sm text-muted">Nothing published yet.</p>
        )}

        {documents && documents.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line">
            {documents.map((document) => (
              <li key={document.key} className="px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-ink underline decoration-line underline-offset-4 hover:decoration-forest-600"
                  >
                    {document.filename}
                  </a>
                  <span className="shrink-0 text-xs text-muted">
                    {formatBytes(document.bytes)}
                  </span>

                  {/* aria-label, not a visually-hidden span: every row shows
                      the same two words, so the visible text alone names
                      nothing. */}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setReplacing(document.id);
                        replaceRef.current?.click();
                      }}
                      aria-label={`Replace ${document.filename}`}
                      className="rounded border border-line px-2 py-1 text-xs text-ink hover:border-forest-600 disabled:opacity-50"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setConfirming(document.id)}
                      aria-label={`Delete ${document.filename}`}
                      className="rounded border border-line px-2 py-1 text-xs text-ink hover:border-brass disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {confirming === document.id && (
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                    Remove this from the site? Parents will stop seeing it.
                    <button
                      type="button"
                      onClick={() => void handleDelete(document)}
                      aria-label={`Yes, remove ${document.filename}`}
                      className="rounded bg-brass px-2 py-1 font-medium text-white"
                    >
                      Yes, remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded border border-line px-2 py-1"
                    >
                      Keep it
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
