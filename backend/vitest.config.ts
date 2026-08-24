import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "local/**/*.test.ts"],

    // The variables modules/booking/lambda.tf supplies to the deployed
    // functions. They have no defaults in src/ on purpose - a handler that
    // reads one is supposed to fail loudly when nobody wired it - so the suite
    // has to supply them the same way the local server does.
    env: {
      TABLE_NAME: "local-school",
      MEDIA_BUCKET: "local-media",
      MEDIA_BASE_URL: "https://cdn.test",
      ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    },
  },
});
