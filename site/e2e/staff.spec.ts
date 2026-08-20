import { expect, test, type Page, type Route } from "@playwright/test";

// One endpoint for every operation - AWS JSON 1.1 names the operation in a
// header rather than a path, so the intercept branches on X-Amz-Target.
const IDP = "https://cognito-idp.ca-central-1.amazonaws.com/";

function idTokenFor(claims: Record<string, unknown>) {
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature-not-checked-here`;
}

function tokens(email: string, refreshToken: string | undefined = "refresh-token") {
  return {
    AuthenticationResult: {
      IdToken: idTokenFor({ email }),
      AccessToken: "access-token",
      ...(refreshToken ? { RefreshToken: refreshToken } : {}),
      ExpiresIn: 3600,
    },
  };
}

function target(route: Route) {
  const headers = route.request().headers();
  return (headers["x-amz-target"] ?? "").split(".").pop() ?? "";
}

/** Stands in for Cognito. `handlers` is keyed by operation name. */
async function stubIdp(
  page: Page,
  handlers: Record<string, { body: unknown; status?: number }>,
  seen: string[] = [],
) {
  await page.route(IDP, async (route) => {
    const operation = target(route);
    seen.push(operation);
    const handler = handlers[operation];
    if (!handler) {
      await route.fulfill({ status: 400, body: JSON.stringify({ __type: "Unexpected" }) });
      return;
    }
    await route.fulfill({
      status: handler.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(handler.body),
    });
  });
}

async function signInAs(page: Page, password = "hunter2hunter2") {
  await page.getByLabel(/school email/i).fill("teacher@maplewood.example");
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

test.describe("staff authentication", () => {
  test("the sign-in form is the school's own page, not a redirect", async ({ page }) => {
    await page.goto("/staff");

    // Still on our origin: no hop to an amazoncognito.com hosted page.
    await expect(page).toHaveURL("http://localhost:4173/staff");
    await expect(page.getByRole("heading", { name: /sign in to the staff area/i })).toBeVisible();
    await expect(page.getByLabel(/school email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
  });

  test("a correct password lands the teacher on the admin page", async ({ page }) => {
    await stubIdp(page, { InitiateAuth: { body: tokens("teacher@maplewood.example") } });

    await page.goto("/staff");
    await signInAs(page);

    await expect(page).toHaveURL("http://localhost:4173/admin");
    await expect(page.getByText("teacher@maplewood.example")).toBeVisible();
  });

  test("a wrong password is refused without leaving the page", async ({ page }) => {
    await stubIdp(page, {
      InitiateAuth: {
        status: 400,
        body: {
          __type: "NotAuthorizedException",
          message: "Incorrect username or password.",
        },
      },
    });

    await page.goto("/staff");
    await signInAs(page, "wrong-password");

    await expect(page.getByRole("alert")).toContainText("Incorrect username or password.");
    await expect(page).toHaveURL("http://localhost:4173/staff");
  });

  // Every account the office creates starts in FORCE_CHANGE_PASSWORD, so this
  // is the path every teacher takes on their first sign-in.
  test("a first sign-in is asked for a new password before anything else", async ({ page }) => {
    await stubIdp(page, {
      InitiateAuth: {
        body: { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "challenge-session" },
      },
      RespondToAuthChallenge: { body: tokens("teacher@maplewood.example") },
    });

    await page.goto("/staff");
    await signInAs(page, "TempPass123!");

    await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();

    await page.getByLabel(/new password/i).fill("BrandNewPass1");
    await page.getByRole("button", { name: /set password and continue/i }).click();

    await expect(page).toHaveURL("http://localhost:4173/admin");
  });

  test("admin refuses a visitor who never signed in", async ({ page }) => {
    await page.goto("/admin");

    await expect(page).toHaveURL("http://localhost:4173/staff");
    await expect(page.getByRole("heading", { name: /sign in to the staff area/i })).toBeVisible();
  });

  // Tokens live 60 minutes; refresh tokens 30 days. A teacher who leaves a tab
  // open over lunch must be renewed, not bounced mid-upload.
  test("an expired session is renewed from its refresh token, not thrown away", async ({
    page,
  }) => {
    await stubIdp(page, {
      InitiateAuth: { body: tokens("renewed@maplewood.example", undefined) },
    });
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "staff.session",
        JSON.stringify({
          idToken: "stale",
          accessToken: "stale",
          refreshToken: "still-good-for-30-days",
          expiresAt: Date.now() - 1,
          email: "stale@maplewood.example",
          groups: [],
        }),
      );
    });

    await page.goto("/admin");

    await expect(page).toHaveURL("http://localhost:4173/admin");
    await expect(page.getByText("renewed@maplewood.example")).toBeVisible();
  });

  test("a session with no refresh token cannot be renewed and is sent to sign in", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "staff.session",
        JSON.stringify({
          idToken: "stale",
          accessToken: "stale",
          refreshToken: "",
          expiresAt: Date.now() - 1,
          email: "stale@maplewood.example",
          groups: [],
        }),
      );
    });

    await page.goto("/admin");

    await expect(page).toHaveURL("http://localhost:4173/staff");
  });

  test("signing out revokes the refresh token and returns to the public site", async ({
    page,
  }) => {
    const seen: string[] = [];
    await stubIdp(
      page,
      {
        InitiateAuth: { body: tokens("teacher@maplewood.example") },
        RevokeToken: { body: {} },
      },
      seen,
    );

    await page.goto("/staff");
    await signInAs(page);
    await expect(page).toHaveURL("http://localhost:4173/admin");

    await page.getByRole("button", { name: /sign out/i }).click();

    await expect(page).toHaveURL("http://localhost:4173/");
    expect(seen).toContain("RevokeToken");
  });

  // Signing in used to leave "Staff sign in" in the header with no route back
  // to /admin from anywhere else on the site.
  test("the header offers the way back to admin from a public page", async ({ page }) => {
    await stubIdp(page, { InitiateAuth: { body: tokens("teacher@maplewood.example") } });

    await page.goto("/staff");
    await signInAs(page);
    await expect(page).toHaveURL("http://localhost:4173/admin");

    await page.getByRole("link", { name: /^home$/i }).click();
    await expect(page).toHaveURL("http://localhost:4173/");

    // Not "Staff sign in" - the teacher already is.
    const back = page.getByRole("link", { name: /staff admin/i });
    await expect(back).toBeVisible();
    await back.click();

    await expect(page).toHaveURL("http://localhost:4173/admin");
    await expect(page.getByRole("heading", { name: /staff admin/i })).toBeVisible();
  });

  test("the header invites a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: /staff sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /staff admin/i })).toHaveCount(0);
  });
});
