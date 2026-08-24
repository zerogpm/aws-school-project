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

      // Read by src/mail.ts at module load, so without these every test that
      // imports the booking-email handler throws before its first assertion.
      // A .test address, never a real one: nothing here sends, but a typo that
      // reached SES should fail rather than reach a person.
      SES_FROM_ADDRESS: "interviews@school.test",
      SITE_BASE_URL: "https://school.test",
    },
  },
});
