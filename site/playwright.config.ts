import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Run against the real production build, not the dev server - the SPA
  // fallback and the hashed asset names only exist after a build.
  webServer: {
    command: "npm run build && npm run preview",
    // A stand-in pool, so the built bundle takes the configured code path.
    // Every call to cognito-idp is intercepted in the specs - no build, and no
    // test, ever reaches AWS.
    env: {
      VITE_COGNITO_CLIENT_ID: "e2eclientid",
      VITE_COGNITO_REGION: "ca-central-1",
    },
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
