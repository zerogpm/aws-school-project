import { expect, test, type Page } from "@playwright/test";

test.describe("public site", () => {
  test("home page shows the school and both calls to action", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /takes the details seriously/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /book a parent-teacher interview/i }),
    ).toBeVisible();
    await expect(page.getByText("800")).toBeVisible();
  });

  test("home page leads with news and upcoming events", async ({ page }) => {
    await page.goto("/");

    const news = page.getByRole("region", { name: /latest news/i });
    await expect(news).toBeVisible();
    await expect(
      news.getByRole("heading", { name: /semester 1 timetables are published/i }),
    ).toBeVisible();

    const events = page.getByRole("region", { name: /upcoming events/i });
    await expect(events).toBeVisible();
    await expect(events.getByText("First day of classes")).toBeVisible();
  });

  test("timetable page carries the bell schedule as well as courses", async ({
    page,
  }) => {
    await page.goto("/timetable");

    const bells = page.getByRole("region", { name: /bell schedule/i });
    await expect(bells).toBeVisible();
    await expect(
      bells.getByRole("columnheader", { name: /late start/i }),
    ).toBeVisible();
    await expect(bells.getByRole("rowheader", { name: "Warning bell" })).toBeVisible();
  });

  test("navigates to the published timetable", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Timetable", exact: true }).click();

    await expect(page).toHaveURL(/\/timetable$/);
    await expect(
      page.getByRole("heading", { name: /published timetable/i }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "Mathematics 11" })).toBeVisible();
  });

  test("deep link to a route loads directly", async ({ page }) => {
    // The whole reason CloudFront rewrites unmatched keys to /index.html with a
    // 200. Without that, this request hits S3, finds no timetable object, and
    // returns 403.
    await page.goto("/timetable");
    await expect(
      page.getByRole("heading", { name: /published timetable/i }),
    ).toBeVisible();
  });

  test("navigates to the published documents", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Documents", exact: true }).click();

    await expect(page).toHaveURL(/\/documents$/);
    await expect(
      page.getByRole("heading", { name: /newsletters and forms/i }),
    ).toBeVisible();
  });

  test("the documents page explains itself before the list arrives", async ({ page }) => {
    // Reached directly, and without assuming an API is answering. A built
    // bundle with no VITE_API_URL still has to be a page rather than a blank
    // panel - the list is the only part that depends on the network.
    await page.goto("/documents");

    await expect(
      page.getByRole("heading", { name: /newsletters and forms/i }),
    ).toBeVisible();
    await expect(page.getByText(/download it to print and sign/i)).toBeVisible();
  });

  test("the interviews page sets expectations without an API", async ({ page }) => {
    // Reached directly and without a running API, like the documents test
    // above: the notes are static, and they are the page's promise to a parent.
    // The waiting list was designed and then cut, so the promise not to offer
    // one is the part worth pinning.
    await page.goto("/interviews");

    await expect(
      page.getByRole("heading", { name: /parent-teacher interviews/i }),
    ).toBeVisible();
    await expect(page.getByText(/one slot per teacher per family/i)).toBeVisible();
    await expect(page.getByText(/there is no waiting list/i)).toBeVisible();
    await expect(page.getByText(/join the wait/i)).toHaveCount(0);
  });

  test("an unknown path renders the in-app 404, not a server error", async ({
    page,
  }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: /does not exist/i })).toBeVisible();
    await page.getByRole("link", { name: /back to the home page/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

// Booking through the browser, against the real API and the real container.
//
// This is the only layer that exercises the whole path a parent takes: the
// built bundle, a real fetch across origins, the Express wrapper, the handlers,
// and DynamoDB Local. The unit tests stub fetch and the API specs skip the
// browser - neither would catch a CORS policy that rejects the preview origin,
// or a bundle built without VITE_API_URL.
//
// Skipped rather than failed when the API is not running, so a checkout without
// Docker still goes green.
const API = "http://127.0.0.1:3000";

let apiUp = false;

test.beforeAll(async () => {
  try {
    apiUp = (await fetch(`${API}/health`)).ok;
  } catch {
    apiUp = false;
  }

  if (!apiUp) {
    console.warn(`[skipped] no API at ${API} - run ./app.sh --start to include these`);
  }
});

// Serial, like api.spec.ts: these share one seeded window in one container,
// and fullyParallel would have them booking slots out from under each other and
// failing on that rather than on a defect.
test.describe.serial("interview booking", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!apiUp, `no API at ${API}`);
    await page.goto("/interviews");
    // The times arrive over the network now, so nothing can be clicked until
    // the first radio exists.
    await expect(page.getByRole("radio").first()).toBeVisible();
  });

  /**
   * The booking panel, and the cancel panel below it.
   *
   * Both carry a "Student number" field, so every selector here is scoped to
   * one of them. An unscoped getByLabel matches two elements and Playwright's
   * strict mode rightly refuses to guess.
   */
  const booking = (page: Page) => page.getByRole("region", { name: /request a time/i });
  const manage = (page: Page) => page.getByRole("region", { name: /change or cancel/i });

  /**
   * A slot nothing currently holds.
   *
   * Positional (`.first()`, `.nth(2)`) breaks the moment an earlier test books
   * that slot and the state carries over - which is exactly what a suite run
   * twice against one container does.
   */
  const freeRadio = (page: Page) => page.locator('input[name="slot"]:not([disabled])').first();

  /**
   * Students reserved for this file.
   *
   * Playwright parallelises across files, so this suite and api.spec.ts hit one
   * database at the same time. Sharing a student number means one suite's
   * in-flight booking trips the other's time-conflict guard, and the failure
   * reads as a bug in the page rather than as two tests colliding.
   */
  const STUDENT = { a: "S00485", b: "S00486", c: "S00487", d: "S00488" };

  test("rejects a malformed student number", async ({ page }) => {
    await booking(page).getByLabel(/student number/i).fill("12345");
    await booking(page).getByRole("button", { name: /request this time/i }).click();

    await expect(booking(page).getByRole("alert")).toContainText(/format S00481/i);
  });

  test("requires a slot before booking", async ({ page }) => {
    await booking(page).getByLabel(/student number/i).fill(STUDENT.a);
    await booking(page).getByRole("button", { name: /request this time/i }).click();

    await expect(booking(page).getByRole("alert")).toContainText(/choose a time slot/i);
  });

  test("shows the real evening, not a fixture", async ({ page }) => {
    // Four teachers across nine twenty-minute steps. A hardcoded list could
    // never be this, which is the point of the test.
    // Six rows on screen, thirty-six in the evening. The count line is what
    // carries the total now that the list is paged.
    await expect(page.getByRole("radio")).toHaveCount(6);
    await expect(booking(page)).toContainText(/of 36 times free/i);
    await expect(booking(page)).toContainText(/Page 1 of 6/i);

    // Four teachers, from the picker rather than the rows: an <option> inside a
    // closed <select> is hidden, so a getByText would resolve to it and fail.
    const teachers = booking(page).getByLabel(/teacher/i);
    await expect(teachers.locator("option")).toHaveCount(5); // four, plus "All teachers"
    await expect(teachers).toContainText("Ms. Okafor - Mathematics");
    await expect(teachers).toContainText("Mrs. Whitfield - English");
  });

  test("books a slot, and the slot is gone on reload", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    await booking(page).getByLabel(/student number/i).fill(STUDENT.d);
    await radio.check();
    await booking(page).getByRole("button", { name: /request this time/i }).click();

    // The booking reference is the only way back to this booking, so the page
    // has to show it.
    const status = page.getByRole("status");
    await expect(status).toContainText(/booked/i);
    const reference = (await status.textContent())!.match(/[0-9a-f-]{36}/)![0];

    // Reload as a different parent would, and the slot is no longer offered.
    await page.reload();
    await expect(page.getByRole("radio").first()).toBeVisible();
    await expect(page.locator(`input[value="${slotId}"]`)).toBeDisabled();

    // Put it back, so the suite can run twice against one container.
    await fetch(`${API}/bookings/${reference}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentNumber: STUDENT.d }),
    });
  });

  test("a slot someone else holds cannot be selected", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    // Booked out of band - another parent, in another browser.
    const created = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentNumber: STUDENT.c,
        windowId: "autumn-2026",
        slotId,
      }),
    });
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      await page.reload();
      await expect(page.getByRole("radio").first()).toBeVisible();

      await expect(page.locator(`input[value="${slotId}"]`)).toBeDisabled();
      await expect(page.getByText("Booked", { exact: true }).first()).toBeVisible();
    } finally {
      await fetch(`${API}/bookings/${bookingRef}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: STUDENT.c }),
      });
    }
  });

  test("losing the race shows the server's message, not a generic failure", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    await booking(page).getByLabel(/student number/i).fill(STUDENT.a);
    await radio.check();

    // Another parent takes it between the page loading and the click landing.
    const created = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentNumber: STUDENT.b, windowId: "autumn-2026", slotId }),
    });
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      await booking(page).getByRole("button", { name: /request this time/i }).click();

      await expect(booking(page).getByRole("alert")).toContainText(/just taken/i);
      // And the list has refreshed, so the next choice is against reality.
      await expect(page.locator(`input[value="${slotId}"]`)).toBeDisabled();
    } finally {
      await fetch(`${API}/bookings/${bookingRef}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: STUDENT.b }),
      });
    }
  });

  test("pages through the evening rather than listing all thirty-six at once", async ({ page }) => {
    await expect(booking(page)).toContainText(/Page 1 of 6/i);
    await expect(booking(page).getByRole("button", { name: /earlier/i })).toBeDisabled();

    await booking(page).getByRole("button", { name: /later/i }).click();
    await expect(booking(page)).toContainText(/Page 2 of 6/i);

    // Picking a teacher shortens the evening to their nine times.
    await booking(page).getByLabel(/teacher/i).selectOption("Ms. Okafor - Mathematics");
    await expect(booking(page)).toContainText(/of 9 times free/i);
    await expect(booking(page)).toContainText(/Page 1 of 2/i);
  });

  test("the evening reads as 5 pm local, not shifted by a timezone", async ({ page }) => {
    // The seed stores the real instant in UTC and the page formats it in
    // America/Toronto. Store "17:00:00Z" meaning "5 pm" and this reads 1:00 p.m.
    await expect(page.getByText(/5:00 p\.?m\.?/i).first()).toBeVisible();
  });

  test("a parent books, then changes their mind from the confirmation", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    await booking(page).getByLabel(/student number/i).fill(STUDENT.b);
    await radio.check();
    await booking(page).getByRole("button", { name: /request this time/i }).click();

    await expect(booking(page).getByRole("status")).toContainText(/booked/i);

    // Cancel needs no typing here - the page already holds both halves.
    await booking(page).getByRole("button", { name: /cancel this time/i }).click();

    await expect(booking(page).getByRole("alert")).toContainText(/given up/i);
    // And the freed slot is offered again, which is what "change" means.
    await expect(page.locator(`input[value="${slotId}"]`)).toBeEnabled();
  });

  test("books a second teacher for the same child without retyping the number", async ({ page }) => {
    // A realistic second booking, which has to clear both guards at once.
    const { slots } = (await (await fetch(`${API}/windows/autumn-2026/slots`)).json()) as {
      slots: { slotId: string; teacherName: string; startsAt: string; available: boolean }[];
    };
    const free = slots.filter((one) => one.available);
    const first = free[0];

    // Different teacher AND a different time. Either alone is refused, by the
    // one-per-teacher guard and the time guard respectively - which is the
    // whole point of both, and a second interview is legitimately both.
    const later = free.find(
      (one) => one.startsAt !== first.startsAt && one.teacherName !== first.teacherName,
    )!;

    // Cleanup in a finally, collected as we go: a failure part-way through
    // otherwise leaves this student holding a slot, and the *next* run fails on
    // the time guard with an error that looks nothing like the real cause.
    const refs: string[] = [];

    const bookByValue = async (slotId: string) => {
      await page.locator(`input[value="${slotId}"]`).check();
      await booking(page).getByRole("button", { name: /request this time/i }).click();
      await expect(booking(page).getByRole("status")).toContainText(/booked/i);
      const text = (await booking(page).getByRole("status").textContent())!;
      refs.push(text.match(/[0-9a-f-]{36}/)![0]);
    };

    try {
      await booking(page).getByLabel(/student number/i).fill(STUDENT.a);
      await bookByValue(first.slotId);

      // The route through that the first cut of this page did not have: one
      // child, several teachers on the same evening.
      await booking(page).getByRole("button", { name: /book another teacher/i }).click();
      await expect(booking(page).getByLabel(/student number/i)).toHaveValue(STUDENT.a);

      await bookByValue(later.slotId);

      // Both are listed, so the parent can see the evening taking shape.
      await expect(booking(page).getByRole("status")).toContainText(
        new RegExp(`Booked for ${STUDENT.a} this evening`, "i"),
      );
    } finally {
      for (const ref of refs) {
        await fetch(`${API}/bookings/${ref}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentNumber: STUDENT.a }),
        });
      }
    }
  });

  test("refuses two teachers at the same time - one parent, two rooms", async ({ page }) => {
    // CLAIM# stops the same teacher twice. This is the other mistake: working
    // down the list and taking 5:00 from two different teachers.
    const slots = (await (await fetch(`${API}/windows/autumn-2026/slots`)).json()) as {
      slots: { slotId: string; startsAt: string; available: boolean }[];
    };
    const free = slots.slots.filter((one) => one.available);
    const first = free[0];
    const clash = free.find(
      (one) => one.startsAt === first.startsAt && one.slotId !== first.slotId,
    )!;

    const created = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentNumber: STUDENT.b,
        windowId: "autumn-2026",
        slotId: first.slotId,
      }),
    });
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      await page.reload();
      await expect(page.getByRole("radio").first()).toBeVisible();

      await booking(page).getByLabel(/student number/i).fill(STUDENT.b);
      await page.locator(`input[value="${clash.slotId}"]`).check();
      await booking(page).getByRole("button", { name: /request this time/i }).click();

      await expect(booking(page).getByRole("alert")).toContainText(
        /already have an interview at that time/i,
      );
    } finally {
      await fetch(`${API}/bookings/${bookingRef}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: STUDENT.b }),
      });
    }
  });

  test("a parent who closed the tab cancels with their reference", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    // Booked in an earlier session, from a tab that is long gone.
    const created = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentNumber: STUDENT.a, windowId: "autumn-2026", slotId }),
    });
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    await page.reload();
    await expect(page.getByRole("radio").first()).toBeVisible();
    await expect(page.locator(`input[value="${slotId}"]`)).toBeDisabled();

    // Two steps now: find the family's evening, then choose which to give up.
    await manage(page).getByLabel(/booking reference/i).fill(bookingRef);
    await manage(page).getByLabel(/student number/i).fill(STUDENT.a);
    await manage(page).getByRole("button", { name: /find my bookings/i }).click();

    await expect(manage(page).getByRole("button", { name: /^cancel$/i })).toBeVisible();
    await manage(page).getByRole("button", { name: /^cancel$/i }).click();

    await expect(manage(page).getByRole("status")).toContainText(/given up/i);

    // The slot list above must update on its own. Two panels, two pieces of
    // state - without a shared signal it stays struck through until a reload,
    // which reads as the cancel having failed.
    await expect(page.locator(`input[value="${slotId}"]`)).toBeEnabled();

    // And it survives a reload, so it really was given back.
    await page.reload();
    await expect(page.getByRole("radio").first()).toBeVisible();
    await expect(page.locator(`input[value="${slotId}"]`)).toBeEnabled();
  });

  test("the wrong student number will not cancel someone else's booking", async ({ page }) => {
    const radio = freeRadio(page);
    const slotId = await radio.getAttribute("value");

    const created = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentNumber: STUDENT.c, windowId: "autumn-2026", slotId }),
    });
    const { bookingRef } = (await created.json()) as { bookingRef: string };

    try {
      await manage(page).getByLabel(/booking reference/i).fill(bookingRef);
      await manage(page).getByLabel(/student number/i).fill(STUDENT.d);
      await manage(page).getByRole("button", { name: /find my bookings/i }).click();

      // Refused at the lookup, before anything can be chosen - the reference
      // alone is not enough.
      await expect(manage(page).getByRole("alert")).toContainText(/does not match this booking/i);
      await expect(manage(page).getByRole("button", { name: /^cancel$/i })).toHaveCount(0);

      // And it is still held.
      await page.reload();
      await expect(page.getByRole("radio").first()).toBeVisible();
      await expect(page.locator(`input[value="${slotId}"]`)).toBeDisabled();
    } finally {
      await fetch(`${API}/bookings/${bookingRef}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: STUDENT.c }),
      });
    }
  });

  test("a student number that is not on the roll says so", async ({ page }) => {
    await booking(page).getByLabel(/student number/i).fill("S99999");
    await freeRadio(page).check();
    await booking(page).getByRole("button", { name: /request this time/i }).click();

    await expect(booking(page).getByRole("alert")).toContainText(/No student with that number/i);
  });
});

test.describe("staff", () => {
  // The flow itself lives in staff.spec.ts. This only guards the way in.
  test("staff sign in is reachable from the header on every page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /staff sign in/i }).click();

    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByLabel(/school email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
  });
});
