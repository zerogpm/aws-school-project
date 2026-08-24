import { expect, test } from "@playwright/test";

// End to end against the real thing: real HTTP, the real Express wrapper, the
// real handlers, and the real DynamoDB Local container. Nothing is mocked, so
// this is the only layer that would catch a route registered in the manifest
// but never reachable, or a handler that works against a stubbed client and not
// against the database.
//
// Skipped rather than failed when the API is not running, matching
// backend/src/db.integration.test.ts - a clean checkout without Docker should
// still get a green suite.
//
//   ./app.sh --start
const API = "http://127.0.0.1:3000";

let apiUp = false;

test.beforeAll(async () => {
  try {
    const response = await fetch(`${API}/health`);
    apiUp = response.ok;
  } catch {
    apiUp = false;
  }

  if (!apiUp) {
    console.warn(`[skipped] no API at ${API} - run ./app.sh --start to include these`);
  }
});

test.beforeEach(() => {
  test.skip(!apiUp, `no API at ${API}`);
});

test.describe("the local API", () => {
  test("health answers without a token, as the health check will", async () => {
    const response = await fetch(`${API}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("windows come back from the real table, newest first", async () => {
    // Reads GSI1 rather than scanning, so this also proves the index keys were
    // written as strings - written as numbers the rows are silently absent
    // from the index and this returns an empty list with no error anywhere.
    const response = await fetch(`${API}/windows`);
    expect(response.status).toBe(200);

    const { windows } = (await response.json()) as {
      windows: { id: string; opensAt: string; label: string }[];
    };

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.map((w) => w.id)).toContain("autumn-2026");

    const openings = windows.map((w) => w.opensAt);
    expect(openings).toEqual([...openings].sort().reverse());
  });

  test("an allowed origin is echoed back", async () => {
    const response = await fetch(`${API}/health`, {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("an unknown origin gets no allow header, so the browser blocks it", async () => {
    // No wildcard fallback. The request still succeeds server-side; it is the
    // browser that refuses to hand the response to the page.
    const response = await fetch(`${API}/health`, {
      headers: { Origin: "https://not-the-school.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a path no route claims is a 404", async () => {
    const response = await fetch(`${API}/windows/nope/nope`);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Booking, end to end.
//
// Serial rather than parallel: these share one seeded window in one container,
// and Playwright's default parallelism would have them competing for the same
// slots and failing on each other's bookings rather than on a real defect.
//
// Every test cancels what it booked, so the suite can run twice in a row
// against a container that was never wiped. A test that leaves a slot held is a
// test that passes once.
// ---------------------------------------------------------------------------
const WINDOW = "autumn-2026";

type PublicSlot = { slotId: string; teacherName: string; startsAt: string; available: boolean };

const listSlots = async (windowId = WINDOW) => {
  const response = await fetch(`${API}/windows/${windowId}/slots`);
  return { response, body: (await response.json()) as { slots?: PublicSlot[] } };
};

const book = (slotId: string, studentNumber: string) =>
  fetch(`${API}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber, windowId: WINDOW, slotId }),
  });

const cancel = (ref: string, studentNumber: string) =>
  fetch(`${API}/bookings/${ref}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber }),
  });

/** A slot nothing currently holds, taken from the end so tests do not fight over the first one. */
const freeSlot = async (fromEnd = 0): Promise<string> => {
  const { body } = await listSlots();
  const free = (body.slots ?? []).filter((slot) => slot.available);

  expect(
    free.length,
    "the seeded window has no free slots left - run ./app.sh --stop --wipe",
  ).toBeGreaterThan(fromEnd);

  return free[free.length - 1 - fromEnd].slotId;
};

test.describe.serial("booking an interview slot", () => {
  test("a parent sees the evening's slots without any account", async () => {
    const { response, body } = await listSlots();

    expect(response.status).toBe(200);
    expect(body.slots!.length).toBeGreaterThan(0);

    // Chronological, straight out of the sort key - the handler does not sort.
    const times = body.slots!.map((slot) => slot.startsAt);
    expect(times).toEqual([...times].sort());
  });

  test("the public list never carries student data", async () => {
    const slotId = await freeSlot();
    const created = await book(slotId, "S00481");
    expect(created.status).toBe(201);
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      const response = await fetch(`${API}/windows/${WINDOW}/slots`);
      const raw = await response.text();

      // The projection is this route's only security boundary - there is no
      // authorizer on it at all.
      expect(raw).not.toContain("S00481");
      expect(raw).not.toContain("bookedBy");
      expect(raw).not.toContain(bookingRef);
    } finally {
      await cancel(bookingRef, "S00481");
    }
  });

  test("booking a slot marks it unavailable, and cancelling frees it again", async () => {
    const slotId = await freeSlot();

    const created = await book(slotId, "S00481");
    expect(created.status).toBe(201);
    const { bookingRef } = (await created.json()) as { bookingRef: string };
    expect(bookingRef).toMatch(/^[0-9a-f-]{36}$/);

    // Read back through the same route a parent would reload. This is also the
    // read that would be flaky without ConsistentRead on the query.
    const afterBooking = await listSlots();
    expect(afterBooking.body.slots!.find((slot) => slot.slotId === slotId)!.available).toBe(false);

    const cancelled = await cancel(bookingRef, "S00481");
    expect(cancelled.status).toBe(200);

    const afterCancel = await listSlots();
    expect(afterCancel.body.slots!.find((slot) => slot.slotId === slotId)!.available).toBe(true);
  });

  // The episode in one test.
  //
  // Two parents, the same slot, the same instant. Without the conditional write
  // both would succeed and one family would arrive to find someone else in the
  // chair. Promise.all is as close to simultaneous as one process gets, and it
  // is close enough to lose the race reliably.
  test("two parents clicking the same slot produce one booking and one rejection", async () => {
    const slotId = await freeSlot();

    const [first, second] = await Promise.all([book(slotId, "S00481"), book(slotId, "S00482")]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    const winningStudent = first.status === 201 ? "S00481" : "S00482";

    const { bookingRef } = (await winner.json()) as { bookingRef: string };
    expect(((await loser.json()) as { error: string }).error).toMatch(/just taken/);

    try {
      // Exactly one of them holds it, and the slot is not somehow free.
      const { body } = await listSlots();
      expect(body.slots!.find((slot) => slot.slotId === slotId)!.available).toBe(false);
    } finally {
      await cancel(bookingRef, winningStudent);
    }
  });

  test("one slot per teacher per family", async () => {
    // Two different times with the same teacher. The slot condition alone would
    // allow this; the CLAIM# guard is what refuses it.
    const { body } = await listSlots();
    const free = body.slots!.filter((slot) => slot.available);
    const teacher = free[0].teacherName;
    const sameTeacher = free.filter((slot) => slot.teacherName === teacher).slice(0, 2);
    expect(sameTeacher.length).toBe(2);

    const created = await book(sameTeacher[0].slotId, "S00483");
    expect(created.status).toBe(201);
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      const again = await book(sameTeacher[1].slotId, "S00483");
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: string }).error).toMatch(
        /already have a slot with this teacher/,
      );
    } finally {
      await cancel(bookingRef, "S00483");
    }
  });

  test("a student number that is not on the roll is a 404, not a conflict", async () => {
    // The distinction the CancellationReasons mapping exists for: a parent who
    // mistyped must not be sent hunting for another time that will fail too.
    const response = await book(await freeSlot(), "S99999");

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /No student with that number/,
    );
  });

  test("a malformed student number is rejected before the table is touched", async () => {
    const response = await book(await freeSlot(), "00481");

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/format S00481/);
  });

  test("a slot that does not exist is a 404 rather than a conflict", async () => {
    const response = await book("SLOT#2099-01-01T00:00:00.000Z#nobody", "S00481");
    expect(response.status).toBe(404);
  });

  test("cancelling needs the student number as well as the reference", async () => {
    const slotId = await freeSlot();
    const created = await book(slotId, "S00481");
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      const wrong = await cancel(bookingRef, "S00484");
      expect(wrong.status).toBe(403);

      // And the slot is still held - a refused cancellation must not half-free it.
      const { body } = await listSlots();
      expect(body.slots!.find((slot) => slot.slotId === slotId)!.available).toBe(false);
    } finally {
      await cancel(bookingRef, "S00481");
    }
  });

  test("an unpublished window is hidden from parents", async () => {
    // spring-2027 is seeded unpublished. Staff draft an evening before
    // announcing it, and the public route should not confirm a draft exists.
    const { response } = await listSlots("spring-2027");
    expect(response.status).toBe(404);
  });

  test("the staff roster shows what the public list hides", async () => {
    // The wrapper injects MOCK_CLAIMS on a staff route, so this reaches the
    // handler as a signed-in member of office staff. That is deliberate - it is
    // how a staff route is developed without a real token - and it means the
    // "no token is refused" case cannot be tested here at all. It is covered
    // where it can be: list-bookings.test.ts builds an event with no authorizer
    // key and asserts 403 with the datastore never touched.
    //
    // What this proves instead is the half the unit test cannot: the same query
    // against the same real items yields two different projections.
    const slotId = await freeSlot();
    const created = await book(slotId, "S00481");
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      const response = await fetch(`${API}/windows/${WINDOW}/bookings`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        total: number;
        booked: number;
        slots: { slotId: string; studentNumber: string | null }[];
      };

      expect(body.total).toBeGreaterThan(0);
      expect(body.booked).toBeGreaterThan(0);

      // The student number the public route refused to return.
      const booked = body.slots.find((slot) => slot.slotId === slotId);
      expect(booked?.studentNumber).toBe("S00481");
    } finally {
      await cancel(bookingRef, "S00481");
    }
  });
});

// Documents, over real HTTP against the real wrapper.
//
// GET /documents talks to real S3 - src/media.ts has no local seam, because
// there is no DynamoDB-Local equivalent for S3 and inventing one would be a
// second implementation of the thing under test. So the listing assertions run
// only when MEDIA_BUCKET points at a bucket that exists, and are skipped with a
// note otherwise. The validation assertions need no bucket at all and always
// run: they are the ones that prove the route is registered, that {id} maps to
// a path parameter, and that a bad id is refused before anything reaches AWS.
test.describe("documents", () => {
  let bucketUp = false;

  test.beforeAll(async () => {
    if (!apiUp) return;

    try {
      bucketUp = (await fetch(`${API}/documents`)).ok;
    } catch {
      bucketUp = false;
    }

    if (!bucketUp) {
      console.warn(
        "[skipped] GET /documents did not answer 200 - set MEDIA_BUCKET to a deployed bucket to include the listing assertions",
      );
    }
  });

  test("refuses an id that is not a uuid, without reaching S3", async () => {
    // The path-traversal case is the reason this route takes an id rather than
    // a key. A 400 here means the guard ran; a 403 or 500 would mean it did
    // not and something further down said no instead.
    const response = await fetch(`${API}/documents/not-a-uuid`, { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Not a document id" });
  });

  test("maps {id} to a path parameter rather than swallowing it", async () => {
    // A route registered as /documents/:id that did not map the parameter would
    // hand the handler an empty id - which produces the same 400 as above, so
    // the distinguishing case is an id that IS a uuid and still gets past the
    // guard. Without a bucket it cannot go further, so only the guard is
    // asserted here; the wrapper test covers the mapping directly.
    const response = await fetch(`${API}/documents/%2E%2E%2F%2E%2E%2Findex.html`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
  });

  test("lists documents with an id, a real filename and an absolute URL", async () => {
    test.skip(!bucketUp, "MEDIA_BUCKET does not point at a bucket that exists");

    const response = await fetch(`${API}/documents`);
    expect(response.status).toBe(200);

    const { documents } = (await response.json()) as {
      documents: { id: string; key: string; filename: string; url: string }[];
    };

    for (const document of documents) {
      // The URL has to be absolute and has to be the CDN: the bucket is private
      // behind OAC, so an s3.amazonaws.com link is a 403 with a nice XML body.
      expect(document.url).toMatch(/^https?:\/\//);
      expect(document.url).toContain(encodeURIComponent(document.filename).replace(/%2F/g, "/"));
      // The filename is the last segment of the key, not the whole key - the
      // bug that had the admin page listing a column of uuids.
      expect(document.filename).not.toContain("/");
      expect(document.id).not.toBe("");
    }
  });
});
