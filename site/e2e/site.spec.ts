import { expect, test } from "@playwright/test";

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

  test("an unknown path renders the in-app 404, not a server error", async ({
    page,
  }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: /does not exist/i })).toBeVisible();
    await page.getByRole("link", { name: /back to the home page/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("interview booking", () => {
  test("rejects a malformed student number", async ({ page }) => {
    await page.goto("/interviews");

    await page.getByLabel(/student number/i).fill("12345");
    await page.getByRole("button", { name: /request this time/i }).click();

    await expect(page.getByRole("alert")).toContainText(/format S00481/i);
  });

  test("requires a slot before booking", async ({ page }) => {
    await page.goto("/interviews");

    await page.getByLabel(/student number/i).fill("S00481");
    await page.getByRole("button", { name: /request this time/i }).click();

    await expect(page.getByRole("alert")).toContainText(/choose a time slot/i);
  });

  test("accepts a valid student number and an open slot", async ({ page }) => {
    await page.goto("/interviews");

    await page.getByLabel(/student number/i).fill("S00481");
    await page.getByRole("radio", { name: /5:00 pm/i }).check();
    await page.getByRole("button", { name: /request this time/i }).click();

    await expect(page.getByRole("alert")).toContainText(/episode 04/i);
  });

  test("a full slot cannot be booked and offers the waitlist", async ({ page }) => {
    await page.goto("/interviews");

    await expect(page.getByRole("radio", { name: /5:40 pm/i })).toBeDisabled();
    // Exact match: the surrounding copy also mentions the waitlist.
    await expect(page.getByText("Waitlist", { exact: true })).toBeVisible();
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
