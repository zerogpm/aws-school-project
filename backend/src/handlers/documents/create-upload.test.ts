import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

// The presigner is mocked, not S3 itself: what is under test is the policy this
// handler asks for. Whether AWS honours it is AWS's contract, and is exercised
// against a deployed stage rather than here.
const { createPresignedPost } = vi.hoisted(() => ({ createPresignedPost: vi.fn() }));
vi.mock("@aws-sdk/s3-presigned-post", () => ({ createPresignedPost }));

const { handler } = await import("./create-upload.js");

const OFFICE = { sub: "s1", email: "office@school.test", "cognito:groups": ["office"] };
const TEACHER = { sub: "s2", email: "teacher@school.test", "cognito:groups": ["teachers"] };

const post = (body: Record<string, unknown> = { filename: "Year Calendar.pdf" }, claims = OFFICE) =>
  apiEvent({
    method: "POST",
    path: "/uploads",
    body: JSON.stringify(body),
    claims: claims as never,
  });

beforeEach(() => {
  createPresignedPost.mockReset();
  createPresignedPost.mockResolvedValue({
    url: "https://local-media.s3.amazonaws.com/",
    fields: { key: "docs/x.pdf", Policy: "base64", "X-Amz-Signature": "sig" },
  });
});

describe("POST /uploads", () => {
  it("returns a policy the browser can post the file with", async () => {
    const result = await handler(post());
    const body = JSON.parse(result.body!);

    expect(result.statusCode).toBe(200);
    expect(body.url).toContain("s3");
    expect(body.fields).toMatchObject({ Policy: "base64" });
    expect(body.filename).toBe("Year Calendar.pdf");
  });

  it("caps the size in the policy, which a presigned PUT could not do", async () => {
    // The entire reason this route hands back a POST policy rather than a PUT
    // URL: content-length-range is the only server-side cost control here.
    await handler(post());

    const { Conditions } = createPresignedPost.mock.calls[0][1];
    expect(Conditions).toContainEqual(["content-length-range", 1, 20 * 1024 * 1024]);
  });

  it("pins the content type and the prefix", async () => {
    await handler(post());

    const { Conditions, Fields, Key, Expires } = createPresignedPost.mock.calls[0][1];
    expect(Conditions).toContainEqual(["eq", "$Content-Type", "application/pdf"]);
    expect(Conditions).toContainEqual(["starts-with", "$key", "docs/"]);
    expect(Fields["Content-Type"]).toBe("application/pdf");
    expect(Key).toMatch(/^docs\/[0-9a-f-]{36}\/Year Calendar\.pdf$/);
    // Minutes. The policy is a bearer capability for as long as it lives.
    expect(Expires).toBe(300);
  });

  it("generates the key rather than taking one from the caller", async () => {
    // Two people uploading "calendar.pdf" must not overwrite each other, and no
    // filename may influence *where* the object lands - only what the last
    // segment is called.
    await handler(post({ filename: "calendar.pdf" }));
    await handler(post({ filename: "calendar.pdf" }));

    const first = createPresignedPost.mock.calls[0][1].Key;
    const second = createPresignedPost.mock.calls[1][1].Key;
    expect(first).not.toBe(second);
    expect(first).toMatch(/\/calendar\.pdf$/);
    expect(second).toMatch(/\/calendar\.pdf$/);
  });

  it("puts the filename in the key, so listing it back costs no extra call", async () => {
    // The name used to live only in Content-Disposition, which ListObjectsV2
    // does not return - so the admin page showed a column of uuids. This is
    // what fixed that, and it has to keep holding.
    await handler(post({ filename: "September Newsletter.pdf" }));

    const { Key } = createPresignedPost.mock.calls[0][1];
    expect(Key.slice(Key.indexOf("/", "docs/".length) + 1)).toBe("September Newsletter.pdf");
  });

  it("returns the id the delete route will take", async () => {
    const body = JSON.parse((await handler(post())).body!);

    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.key).toBe(`docs/${body.id}/Year Calendar.pdf`);
  });

  it("refuses a signed-in teacher who is not office staff", async () => {
    const result = await handler(post({ filename: "a.pdf" }, TEACHER));

    expect(result.statusCode).toBe(403);
    expect(createPresignedPost).not.toHaveBeenCalled();
  });

  it("refuses a request with no claims at all", async () => {
    const result = await handler(
      apiEvent({ method: "POST", path: "/uploads", body: JSON.stringify({ filename: "a.pdf" }) }),
    );

    expect(result.statusCode).toBe(403);
    expect(createPresignedPost).not.toHaveBeenCalled();
  });

  it("refuses a filename that could climb out of docs/", async () => {
    for (const filename of ["../../index.html", "docs/../a.pdf", "a\\b.pdf", "/etc/passwd"]) {
      createPresignedPost.mockClear();
      const result = await handler(post({ filename }));
      expect(result.statusCode, filename).toBe(400);
      expect(createPresignedPost, filename).not.toHaveBeenCalled();
    }
  });

  it("refuses anything that is not a PDF", async () => {
    for (const filename of ["notes.docx", "report.pdf.exe", "archive.zip", ".pdf"]) {
      createPresignedPost.mockClear();
      const result = await handler(post({ filename }));
      expect(result.statusCode, filename).toBe(400);
      expect(createPresignedPost, filename).not.toHaveBeenCalled();
    }
  });

  it("rejects an absent body", async () => {
    const result = await handler(apiEvent({ method: "POST", path: "/uploads", claims: OFFICE }));

    expect(result.statusCode).toBe(400);
    expect(createPresignedPost).not.toHaveBeenCalled();
  });

  it("keeps CORS headers when signing fails", async () => {
    createPresignedPost.mockRejectedValue(new Error("boom"));

    const event = apiEvent({
      method: "POST",
      path: "/uploads",
      body: JSON.stringify({ filename: "a.pdf" }),
      headers: { origin: "http://localhost:5173" },
      claims: OFFICE,
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
