import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentUpload from "./DocumentUpload";
import { AuthProvider } from "../auth/AuthContext";

// The API layer is mocked, not fetch. What is under test here is the
// orchestration this component owns and nothing else does: uploading several
// files one after another, the two-step delete, and replace being an upload
// *then* a delete. The requests themselves are api/documents.test.ts's job.
const { fetchDocuments, uploadDocument, deleteDocument } = vi.hoisted(() => ({
  fetchDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock("../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/documents")>();
  return { ...actual, fetchDocuments, uploadDocument, deleteDocument };
});

const document = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  key: "docs/11111111-1111-4111-8111-111111111111/Year Calendar.pdf",
  filename: "Year Calendar.pdf",
  url: "https://cdn.test/docs/11111111-1111-4111-8111-111111111111/Year%20Calendar.pdf",
  bytes: 1024,
  updatedAt: "2026-08-24T03:26:38.000Z",
  ...over,
});

const pdf = (name: string) => new File(["%PDF-x"], name, { type: "application/pdf" });

function signIn() {
  sessionStorage.setItem(
    "staff.session",
    JSON.stringify({
      idToken: "id-token",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 30 * 60_000,
      email: "office@maplewood.example",
      groups: ["office"],
    }),
  );
}

const renderUpload = () =>
  render(
    <AuthProvider>
      <DocumentUpload />
    </AuthProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
  signIn();

  fetchDocuments.mockReset();
  uploadDocument.mockReset();
  deleteDocument.mockReset();

  fetchDocuments.mockResolvedValue({ ok: true, value: [document()] });
  uploadDocument.mockResolvedValue({
    ok: true,
    value: { id: "new-id", key: "docs/new-id/x.pdf", filename: "x.pdf" },
  });
  deleteDocument.mockResolvedValue({ ok: true, value: { id: "gone" } });
});

afterEach(() => {
  sessionStorage.clear();
});

describe("publishing several documents at once", () => {
  it("uploads every file that was picked", async () => {
    renderUpload();
    await screen.findByText("Year Calendar.pdf");

    await userEvent.upload(screen.getByLabelText(/choose pdfs/i), [
      pdf("one.pdf"),
      pdf("two.pdf"),
      pdf("three.pdf"),
    ]);

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(3));
    expect(uploadDocument.mock.calls.map(([call]) => call.file.name)).toEqual([
      "one.pdf",
      "two.pdf",
      "three.pdf",
    ]);
  });

  it("sends them one at a time rather than all at once", async () => {
    // Each upload is two requests and the second is the whole file. Three in
    // flight together share one uplink and every one of them gets slower.
    let inFlight = 0;
    let peak = 0;

    uploadDocument.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { ok: true, value: { id: "x", key: "k", filename: "f" } };
    });

    renderUpload();
    await screen.findByText("Year Calendar.pdf");

    await userEvent.upload(screen.getByLabelText(/choose pdfs/i), [pdf("a.pdf"), pdf("b.pdf")]);

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
    expect(peak).toBe(1);
  });

  it("names the file that failed, since 'the upload failed' does not say which", async () => {
    uploadDocument
      .mockResolvedValueOnce({ ok: true, value: { id: "a", key: "k", filename: "ok.pdf" } })
      .mockResolvedValueOnce({ ok: false, error: "That file is not a PDF.", status: 0, retry: false });

    renderUpload();
    await screen.findByText("Year Calendar.pdf");

    await userEvent.upload(screen.getByLabelText(/choose pdfs/i), [pdf("ok.pdf"), pdf("bad.pdf")]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/bad\.pdf: That file is not a PDF/);
  });

  it("refreshes the list once the uploads are done", async () => {
    renderUpload();
    await screen.findByText("Year Calendar.pdf");
    fetchDocuments.mockClear();

    await userEvent.upload(screen.getByLabelText(/choose pdfs/i), pdf("one.pdf"));

    await waitFor(() => expect(fetchDocuments).toHaveBeenCalled());
  });
});

describe("unpublishing", () => {
  it("asks before deleting", async () => {
    renderUpload();

    await userEvent.click(await screen.findByRole("button", { name: /delete year calendar/i }));

    expect(screen.getByText(/parents will stop seeing it/i)).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("does nothing if the confirm is declined", async () => {
    renderUpload();

    await userEvent.click(await screen.findByRole("button", { name: /delete year calendar/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.queryByText(/parents will stop seeing it/i)).not.toBeInTheDocument();
  });

  it("deletes by id, never by key", async () => {
    // The id is a uuid the API can check. A key is a path, and a path is
    // something a caller gets to shape.
    renderUpload();

    await userEvent.click(await screen.findByRole("button", { name: /delete year calendar/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, remove year calendar/i }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledTimes(1));
    expect(deleteDocument.mock.calls[0][0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      accessToken: "id-token",
    });
  });

  it("refreshes the list even when the delete failed", async () => {
    // A 404 means somebody else already deleted it, so the list on screen is
    // stale - which is precisely when re-reading it is most useful.
    deleteDocument.mockResolvedValue({
      ok: false,
      error: "That document is already gone.",
      status: 404,
      retry: false,
    });

    renderUpload();
    await screen.findByText("Year Calendar.pdf");
    fetchDocuments.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /delete year calendar/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, remove year calendar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already gone/i);
    await waitFor(() => expect(fetchDocuments).toHaveBeenCalled());
  });
});

describe("replacing", () => {
  it("uploads the new file before deleting the old one", async () => {
    // The order is the whole design. Reversed, a failed upload leaves the
    // school with no year calendar published at all.
    const order: string[] = [];
    uploadDocument.mockImplementation(async () => {
      order.push("upload");
      return { ok: true, value: { id: "new", key: "k", filename: "new.pdf" } };
    });
    deleteDocument.mockImplementation(async () => {
      order.push("delete");
      return { ok: true, value: { id: "old" } };
    });

    const { container } = renderUpload();
    await userEvent.click(await screen.findByRole("button", { name: /replace year calendar/i }));

    // The picker is hidden and driven by the Replace button, so the file goes
    // to it directly - there is no visible control to click.
    const picker = container.querySelector('input[type="file"][aria-hidden="true"]');
    await userEvent.upload(picker as HTMLInputElement, pdf("new.pdf"));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalled());
    expect(order).toEqual(["upload", "delete"]);
  });

  it("keeps the old document published when the new upload fails", async () => {
    uploadDocument.mockResolvedValue({
      ok: false,
      error: "That file is not a PDF.",
      status: 0,
      retry: false,
    });

    const { container } = renderUpload();
    await userEvent.click(await screen.findByRole("button", { name: /replace year calendar/i }));

    const picker = container.querySelector('input[type="file"][aria-hidden="true"]');
    await userEvent.upload(picker as HTMLInputElement, pdf("new.pdf"));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("says so if the new file lands but the old one will not go", async () => {
    // The one outcome a PUT /documents/{id} would have had to invent an answer
    // for. Here it is two calls, so it can just be reported.
    deleteDocument.mockResolvedValue({
      ok: false,
      error: "Something went wrong.",
      status: 500,
      retry: false,
    });

    const { container } = renderUpload();
    await userEvent.click(await screen.findByRole("button", { name: /replace year calendar/i }));

    const picker = container.querySelector('input[type="file"][aria-hidden="true"]');
    await userEvent.upload(picker as HTMLInputElement, pdf("new.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /new\.pdf is published, but Year Calendar\.pdf could not be removed/i,
    );
  });
});

describe("the published list", () => {
  it("links each row to the URL the API built", async () => {
    renderUpload();

    expect(await screen.findByRole("link", { name: "Year Calendar.pdf" })).toHaveAttribute(
      "href",
      "https://cdn.test/docs/11111111-1111-4111-8111-111111111111/Year%20Calendar.pdf",
    );
  });

  it("shows the real filename rather than the key it is stored under", async () => {
    // The name is the last segment of the key precisely so this costs no extra
    // request. Before that it was a uuid on screen.
    renderUpload();

    expect(await screen.findByText("Year Calendar.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument();
  });
});
