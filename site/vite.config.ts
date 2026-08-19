import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // CloudFront serves this straight out of S3; the hashed filenames under
    // assets/ are what let the deploy script mark them immutable for a year.
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright owns e2e/. Vitest must not try to run those files.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
