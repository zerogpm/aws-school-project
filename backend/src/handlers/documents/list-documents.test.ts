import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../media.js")>();
  return { ...actual, s3: { send } };
});

const { handler } = await import("./list-documents.js");

const object = (key: string, size: number, iso: string) => ({
  Key: key,
  Size: size,
  LastModified: new Date(iso),
});

const list = async () =>
  JSON.parse((await handler(apiEvent({ path: "/documents" }))).body!).documents;

// docs/<uuid>/<filename>, which is what create-upload writes.
const A = "docs/11111111-1111-4111-8111-111111111111/Newsletter.pdf";
const B = "docs/22222222-2222-4222-8222-222222222222/Year Calendar.pdf";

beforeEach(() => {
  send.mockReset();
});

describe("GET /documents", () => {
  it("answers with no authorizer, because parents have no account", async () => {
    send.mockResolvedValue({ Contents: [object(A, 1024, "2026-08-01T00:00:00Z")] });

    const result = await handler(apiEvent({ path: "/documents" }));
    expect(result.statusCode).toBe(200);
  });

  it("lists newest first, which is what a parent came for", async () => {
    send.mockResolvedValue({
      Contents: [object(A, 10, "2026-01-01T00:00:00Z"), object(B, 20, "2026-08-01T00:00:00Z")],
    });

    expect((await list()).map((d: { key: string }) => d.key)).toEqual([B, A]);
  });

  it("asks only for the docs/ prefix", async () => {
    // photos/ and video/ live in the same bucket and are not documents.
    send.mockResolvedValue({});
    await handler(apiEvent({ path: "/documents" }));

    expect(send.mock.calls[0][0].input.Prefix).toBe("docs/");
  });

  it("splits the key into the id and the name a person reads", async () => {
    // The whole reason the filename is in the key: no HEAD per object, and no
    // column of uuids on the admin page.
    send.mockResolvedValue({ Contents: [object(B, 20, "2026-08-01T00:00:00Z")] });

    expect((await list())[0]).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      filename: "Year Calendar.pdf",
    });
  });

  it("builds a CloudFront URL, because the bucket answers 403 to everyone else", async () => {
    send.mockResolvedValue({ Contents: [object(A, 20, "2026-08-01T00:00:00Z")] });

    expect((await list())[0].url).toBe(
      "https://cdn.test/docs/11111111-1111-4111-8111-111111111111/Newsletter.pdf",
    );
  });

  it("encodes each segment but not the separators", async () => {
    // Filenames routinely contain spaces - SAFE_FILENAME allows them - and an
    // unencoded space is not a legal URL. encodeURIComponent on the whole key
    // would turn the slashes into %2F and ask for one very strangely named
    // object.
    send.mockResolvedValue({ Contents: [object(B, 20, "2026-08-01T00:00:00Z")] });

    const { url } = (await list())[0];
    expect(url).toBe("https://cdn.test/docs/22222222-2222-4222-8222-222222222222/Year%20Calendar.pdf");
    expect(url).not.toContain("%2F");
  });

  it("still lists an object from before the filename moved into the key", async () => {
    // The first uploads produced docs/<uuid>.pdf with no second segment. They
    // are real objects costing real money, so hiding them would be worse than
    // showing a name nobody chose. They are not deletable through the API -
    // delete-document refuses an id that is not a uuid.
    send.mockResolvedValue({ Contents: [object("docs/legacy.pdf", 5, "2026-01-02T00:00:00Z")] });

    expect((await list())[0]).toMatchObject({ id: "legacy.pdf", filename: "legacy.pdf" });
  });

  it("skips the zero-byte prefix marker", async () => {
    // A console-created "folder" shows up as a zero-byte object on the prefix.
    send.mockResolvedValue({
      Contents: [object("docs/", 0, "2026-01-01T00:00:00Z"), object(A, 5, "2026-01-02T00:00:00Z")],
    });

    const documents = await list();
    expect(documents).toHaveLength(1);
    expect(documents[0].key).toBe(A);
  });

  it("returns an empty list for an empty bucket", async () => {
    // ListObjectsV2 omits Contents entirely rather than returning [].
    send.mockResolvedValue({});

    expect(await list()).toEqual([]);
  });

  it("keeps CORS headers when S3 fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const result = await handler(
      apiEvent({ path: "/documents", headers: { origin: "http://localhost:5173" } }),
    );

    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
