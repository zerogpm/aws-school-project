// Does the artifact Terraform actually uploads still load?
//
// Every other test in this repo imports TypeScript source. Lambda runs a bundle,
// and the two can differ in exactly one way that matters: bundling. This file
// exists because that difference cost a deploy.
//
// What prompted it: the AWS SDK is CommonJS, and bundling CJS into
// `format: "esm"` makes esbuild emit a `__require` shim that threw
//
//   Dynamic require of "node:https" is not supported
//
// at module load on Lambda - before the handler ran, before any log line the
// handler would have written. Source fine, unit tests green, parity test green,
// function dead on arrival, and the only place that said so was CloudWatch.
//
// **This test does not reproduce that.** It was tried: bare node loads the
// unbannered bundle happily, and so does node with AWS_LAMBDA_FUNCTION_NAME and
// friends set. Whatever makes the SDK reach for node:https during init only
// happens in the real runtime. So the honest boundary is:
//
//   caught here      a bundle that fails to load at all, or exports no handler
//   caught deployed  a bundle that loads locally and dies in Lambda's loader
//
// The fix for the original bug is the createRequire banner in
// scripts/build-handlers.ts, not this file. This is the cheap half of the
// check - worth having, and not worth mistaking for the whole of it. The
// smoke-test checklist in 05-email/README.md is the other half.
//
// Skipped rather than failed when backend/dist is absent, matching
// db.integration.test.ts: a clean checkout that has never run the bundler
// should still get a green suite.
//
//   npm run build:handlers
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { consumers, routes } from "./routes.js";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

const bundleFor = (name: string) => `${distDir}${name}/index.mjs`;

// Probed at module scope, not in a hook. describe.skipIf is evaluated while
// tests are collected, which happens before any hook has run - deciding from a
// hook leaves the flag false and silently skips everything it was meant to gate.
const built = [...routes, ...consumers].every((entry) => existsSync(bundleFor(entry.name)));

if (!built) {
  console.warn("[skipped] no backend/dist - run npm run build:handlers to include these");
}

describe.skipIf(!built)("the built bundles", () => {
  for (const entry of [...routes, ...consumers]) {
    it(`${entry.name} loads and exports a handler`, async () => {
      // A real import of the real artifact. Nothing is invoked - the point is
      // module load, which is where requireEnv runs, where the SDK is
      // constructed, and where a bad bundle dies.
      //
      // The env this needs is already supplied by vitest.config.ts, the same
      // way Terraform supplies it to the deployed function.
      const module = await import(bundleFor(entry.name));

      // "index.handler" is what modules/booking sets as the Lambda handler, so
      // a bundle exporting anything else is a function AWS cannot invoke.
      expect(module.handler, `${entry.name} must export \`handler\``).toBeTypeOf("function");
    });
  }
});
