import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent } from "../test-event.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../media.js")>();
  return { ...actual, s3: { send } };
});

const { handler } = await import("./delete-document.js");

const OFFICE = { sub: "s1", email: "office@school.test", "cognito:groups": ["office"] };
const TEACHER = { sub: "s2", email: "teacher@school.test", "cognito:groups": ["teachers"] };

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = `docs/${ID}/Newsletter.pdf`;

const del = (id = ID, claims: Record<string, unknown> = OFFICE) =>
  apiEvent({
    method: "DELETE",
    path: "/documents/{id}",
    pathParameters: { id },
    claims: claims as never,
  });

/** ListObjectsV2 finds one object, the delete that follows succeeds. */
const found = () => {
  send.mockImplementation(async (command: unknown) =>
    command instanceof ListObjectsV2Command ? { Contents: [{ Key: KEY, Size: 10 }] } : {},
  );
};

const deletes = () =>
  send.mock.calls
    .map(([command]) => command)
    .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand);

beforeEach(() => {
  send.mockReset();
});

describe("DELETE /documents/{id}", () => {
  it("removes the object the id resolves to", async () => {
    found();

    const result = await handler(del());
    const body = JSON.parse(result.body!);

    expect(result.statusCode).toBe(200);
    expect(body).toMatchObject({ id: ID, filename: "Newsletter.pdf", deleted: 1 });
    expect(deletes()[0].input.Key).toBe(KEY);
  });

  it("looks the key up under the id rather than trusting one from the caller", async () => {
    // The caller names a uuid and never a path. This is the assertion that
    // keeps it that way - the prefix is built here, from a value that has
    // already passed the uuid check.
    found();
    await handler(del());

    const [command] = send.mock.calls[0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input.Prefix).toBe(`docs/${ID}/`);
  });

  it("refuses a signed-in teacher who is not office staff", async () => {
    found();

    const result = await handler(del(ID, TEACHER));

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a request with no claims at all", async () => {
    // Built inline rather than through del(): a default parameter would swallow
    // an explicit undefined and quietly restore the office claims, which is a
    // test that passes by testing nothing.
    found();

    const result = await handler(
      apiEvent({ method: "DELETE", path: "/documents/{id}", pathParameters: { id: ID } }),
    );

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a uuid, before it reaches S3", async () => {
    // The path-traversal case is the point. A key is a path and a uuid is not,
    // which is the entire reason this route takes the latter.
    for (const id of ["../../index.html", "docs/x.pdf", "legacy.pdf", "", "  ", "1234"]) {
      send.mockReset();
      found();

      const result = await handler(del(id));
      expect(result.statusCode, id).toBe(400);
      expect(send, id).not.toHaveBeenCalled();
    }
  });

  it("survives API Gateway sending no path parameters at all", async () => {
    // pathParameters is absent, not {}, when there are none. A handler that
    // assumes the object exists reads undefined in production only.
    const result = await handler(
      apiEvent({ method: "DELETE", path: "/documents/{id}", claims: OFFICE as never }),
    );

    expect(result.statusCode).toBe(400);
  });

  it("answers 404 when the id resolves to nothing", async () => {
    // Already deleted, or never existed. Two tabs open on the same list is a
    // real thing, and the second click is not a server fault.
    send.mockResolvedValue({});

    const result = await handler(del());

    expect(result.statusCode).toBe(404);
    expect(deletes()).toHaveLength(0);
  });

  it("treats an omitted Contents the same as an empty one", async () => {
    // ListObjectsV2 omits the key entirely rather than returning [].
    send.mockResolvedValue({ Contents: undefined });

    expect((await handler(del())).statusCode).toBe(404);
  });

  it("keeps CORS headers when S3 fails", async () => {
    send.mockRejectedValue(new Error("boom"));

    const result = await handler(
      apiEvent({
        method: "DELETE",
        path: "/documents/{id}",
        pathParameters: { id: ID },
        headers: { origin: "http://localhost:5173" },
        claims: OFFICE as never,
      }),
    );

    expect(result.statusCode).toBe(500);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });
});
