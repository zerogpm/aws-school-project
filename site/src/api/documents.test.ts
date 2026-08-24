import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDocument,
  fetchDocuments,
  formatBytes,
  looksLikePdf,
  uploadDocument,
} from "./documents";

const pdf = (bytes = 1024, header = "%PDF-") =>
  new File([header + "x".repeat(Math.max(0, bytes - header.length))], "calendar.pdf", {
    type: "application/pdf",
  });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TICKET = {
  url: "https://local-media.s3.amazonaws.com/",
  fields: { key: "docs/abc.pdf", Policy: "base64policy", "X-Amz-Signature": "sig" },
  key: "docs/abc.pdf",
  id: "11111111-1111-4111-8111-111111111111",
  filename: "calendar.pdf",
  maxBytes: 20 * 1024 * 1024,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/uploads")) return json(200, TICKET);
    return new Response("", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looksLikePdf", () => {
  it("reads the magic bytes rather than trusting the name", async () => {
    // The check the server genuinely cannot do - it never sees the file.
    expect(await looksLikePdf(pdf())).toBe(true);
    expect(await looksLikePdf(pdf(100, "PK "))).toBe(false);
  });
});

describe("uploadDocument", () => {
  it("asks our API first, then posts the file to S3", async () => {
    const result = await uploadDocument({ file: pdf(), accessToken: "id-token" });

    expect(result.ok).toBe(true);

    const [ticketUrl, ticketInit] = fetchMock.mock.calls[0];
    expect(String(ticketUrl)).toContain("/uploads");
    // The ID token: the authorizer's audience is the app client id, and only
    // the ID token carries a matching aud claim.
    expect(ticketInit.headers.Authorization).toBe("Bearer id-token");

    const [s3Url, s3Init] = fetchMock.mock.calls[1];
    expect(String(s3Url)).toContain("s3.amazonaws.com");
    expect(s3Init.method).toBe("POST");
  });

  it("sends the policy fields before the file, which S3 requires", async () => {
    // S3 ignores anything after the file part, so a field appended afterwards
    // is silently dropped and the signature fails.
    await uploadDocument({ file: pdf(), accessToken: "t" });

    const form = fetchMock.mock.calls[1][1].body as FormData;
    const names = [...form.keys()];
    expect(names.at(-1)).toBe("file");
    expect(names).toContain("Policy");
    expect(names).toContain("X-Amz-Signature");
  });

  it("refuses an oversized file without a round trip", async () => {
    const result = await uploadDocument({
      file: pdf(21 * 1024 * 1024),
      accessToken: "t",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringMatching(/limit is 20MB/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a renamed non-PDF without a round trip", async () => {
    const result = await uploadDocument({
      file: new File(["PK not a pdf"], "sneaky.pdf", { type: "application/pdf" }),
      accessToken: "t",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringMatching(/not a PDF/i) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty file", async () => {
    const result = await uploadDocument({
      file: new File([], "empty.pdf", { type: "application/pdf" }),
      accessToken: "t",
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the API's own refusal through", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/uploads")) return json(403, { error: "Office staff only" });
      return new Response("", { status: 200 });
    });

    const result = await uploadDocument({ file: pdf(), accessToken: "t" });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "Office staff only" });
    // No S3 call - there was no policy to post with.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says the session expired on a 401 rather than showing a raw status", async () => {
    fetchMock.mockImplementation(async () => json(401, {}));

    const result = await uploadDocument({ file: pdf(), accessToken: "stale" });
    expect(result).toMatchObject({ error: expect.stringMatching(/session has expired/i) });
  });

  it("explains an S3 403 as an expired link, since S3 answers XML not JSON", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/uploads")) return json(200, TICKET);
      return new Response("<Error>...</Error>", { status: 403 });
    });

    const result = await uploadDocument({ file: pdf(), accessToken: "t" });
    expect(result).toMatchObject({ error: expect.stringMatching(/may have expired/i) });
  });
});

describe("fetchDocuments", () => {
  it("reads the list without sending a token, because the route is public", async () => {
    fetchMock.mockResolvedValue(json(200, { documents: [{ id: "a", filename: "a.pdf" }] }));

    const result = await fetchDocuments();

    expect(result).toEqual({ ok: true, value: [{ id: "a", filename: "a.pdf" }] });
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });
});

describe("deleteDocument", () => {
  it("sends the id in the path and the ID token in the header", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "x", deleted: 1 }));

    const result = await deleteDocument({ id: "abc", accessToken: "id-token" });

    expect(result.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/documents/abc");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer id-token");
  });

  it("encodes the id rather than pasting it into the URL", async () => {
    // The API refuses anything that is not a uuid, so this is belt and braces -
    // but a value that reaches a URL unencoded is how a path parameter stops
    // being one.
    fetchMock.mockResolvedValue(json(200, {}));

    await deleteDocument({ id: "../uploads", accessToken: "t" });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/documents/..%2Fuploads");
  });

  it("says the session expired on a 401 rather than showing a raw status", async () => {
    fetchMock.mockResolvedValue(json(401, {}));

    const result = await deleteDocument({ id: "abc", accessToken: "stale" });

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/session has expired/i) });
  });

  it("treats a 404 as already gone and not worth retrying", async () => {
    // Somebody else deleted it, or a second tab did. The list is stale;
    // retrying the delete would never help.
    fetchMock.mockResolvedValue(json(404, { error: "No such document" }));

    const result = await deleteDocument({ id: "abc", accessToken: "t" });

    expect(result).toMatchObject({ ok: false, retry: false });
    expect(result.ok === false && result.error).toMatch(/already gone/i);
  });

  it("reports a network failure as retryable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const result = await deleteDocument({ id: "abc", accessToken: "t" });

    expect(result).toMatchObject({ ok: false, retry: true });
  });
});

describe("formatBytes", () => {
  it("reads as a person would say it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
