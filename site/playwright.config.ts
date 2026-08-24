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

      // The local wrapper, so the built bundle books against the real handlers
      // and the real container rather than a stub. localhost:4173 is already in
      // ALLOWED_ORIGINS (backend/local/env.ts), so CORS passes as it would from
      // CloudFront. The interview specs skip themselves when it is not running.
      VITE_API_URL: "http://127.0.0.1:3000",
    },
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
