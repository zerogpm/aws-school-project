import { useEffect, useState } from "react";
import {
  fetchDocuments,
  formatBytes,
  type PublishedDocument,
} from "../api/documents";

/**
 * Everything the office has published, for anyone to read.
 *
 * No account, no gate: GET /documents is a public route because newsletters and
 * permission forms are meant to reach every parent, and there are no parent
 * accounts to hide them behind.
 *
 * Two links per row rather than one, because they are genuinely different acts.
 * The objects are stored with `Content-Disposition: inline`, so following the
 * URL opens the browser's own PDF viewer - which is the right default on a
 * phone in a school car park. `download` on the second link overrides that and
 * writes the file to disk; it only works because CloudFront serves the site and
 * the documents from one origin, so the anchor is same-origin. No pdf.js: the
 * front end here is a prop, and a viewer nobody asked for is 300KB of bundle.
 */
export default function Documents() {
  const [documents, setDocuments] = useState<PublishedDocument[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;

    void fetchDocuments().then((result) => {
      if (!live) return;
      if (result.ok) setDocuments(result.value);
      else {
        setDocuments([]);
        setError(result.error);
      }
    });

    // The list is one fetch and a parent may leave immediately. Without this,
    // resolving after unmount sets state on a component that is gone.
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h1 className="font-serif text-3xl font-semibold text-forest-900">
          Newsletters and forms
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Everything the office has published &mdash; the year calendar, monthly
          newsletters and permission forms. Open one to read it, or download it
          to print and sign.
        </p>

        {error && (
          <p role="alert" className="mt-8 text-sm text-brass">
            {error}
          </p>
        )}

        {documents === null && <p className="mt-8 text-muted">Loading&hellip;</p>}

        {documents?.length === 0 && !error && (
          <p className="mt-8 text-muted">Nothing has been published yet.</p>
        )}

        {documents && documents.length > 0 && (
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {documents.map((document) => (
              <li
                key={document.key}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{document.filename}</p>
                  <p className="mt-1 text-xs text-muted">
                    PDF &middot; {formatBytes(document.bytes)}
                    {document.updatedAt &&
                      ` · published ${new Date(document.updatedAt).toLocaleDateString("en-CA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {/* aria-label rather than a visually-hidden span. The list
                      repeats "View" and "Download" once per row, so the visible
                      word alone is not a name - and a label is unambiguous
                      where two sibling text nodes are at the mercy of how the
                      accessible name gets concatenated.

                      rel="noreferrer" with target="_blank": without it the new
                      tab gets a window.opener handle back to this page. */}
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${document.filename}`}
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:border-forest-600"
                  >
                    View
                  </a>
                  <a
                    href={document.url}
                    download={document.filename}
                    aria-label={`Download ${document.filename}`}
                    className="rounded-md bg-forest-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-600"
                  >
                    Download
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
