// Bundles every handler in the manifest into a Lambda deployment artifact.
//
//   npm run build:handlers
//
// modules/booking/build.tf runs this during an apply, and modules/booking/
// lambda.tf zips dist/<name>/ per route. One entry point per function, because
// each Lambda should carry only what it imports - a shared bundle would put the
// booking code in the health check's cold start.
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { consumers, routes } from "../src/routes.js";

const backendDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = resolve(backendDir, "dist");

// The runtime already ships the DynamoDB and S3 clients. Bundling those would
// add megabytes to every zip and seconds to every cold start, for a version the
// runtime would otherwise keep patched.
const RUNTIME_PROVIDED = [
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/util-dynamodb",
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-presigned-post",
];

// Everything else gets bundled, and the SES client is the reason this list is
// spelled out rather than left as the "@aws-sdk/*" wildcard it used to be.
// Which clients a managed runtime provides is a moving target, and an external
// that turns out not to be there fails at import on the first real invocation -
// after the apply, on camera, with a stack trace about a missing module rather
// than about anything you changed. Bundling it costs a few hundred kilobytes.
const targets = [
  ...routes.map((route) => ({ name: route.name, entry: route.entry })),
  ...consumers.map((consumer) => ({ name: consumer.name, entry: consumer.entry })),
];

await rm(distDir, { recursive: true, force: true });

for (const target of targets) {
  await build({
    entryPoints: [resolve(backendDir, target.entry)],

    // index.mjs, so the nodejs22.x runtime loads it as an ES module without a
    // package.json travelling in the zip. The Terraform sets handler
    // "index.handler", which has to match `export const handler`.
    outfile: resolve(distDir, target.name, "index.mjs"),

    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",

    external: RUNTIME_PROVIDED,

    // Gives the ESM bundle a real `require`.
    //
    // The AWS SDK is CommonJS. Bundling it into `format: "esm"` makes esbuild
    // emit a `__require` shim, and that shim throws `Dynamic require of
    // "node:https" is not supported` the moment the SDK reaches for a Node
    // builtin - at module load, before the handler runs, so the whole function
    // is dead and the log says nothing about SES.
    //
    // Only bundled dependencies can hit this, which is why eleven route
    // handlers were fine: everything they import is in RUNTIME_PROVIDED and
    // never gets bundled at all. The consumer is the first function here to
    // bundle a CJS dependency, so it is the first to need this.
    banner: {
      js: [
        "import { createRequire as __nodeCreateRequire } from 'node:module';",
        "const require = __nodeCreateRequire(import.meta.url);",
      ].join("\n"),
    },

    minify: true,

    // Nothing reads a source map on a Lambda, and shipping one doubles the
    // artifact. The stack traces that matter name the bundled line, and the
    // handlers are small enough that the log tells you which one.
    sourcemap: false,
  });

  console.log(`  + ${target.name}`);
}

console.log(
  `==> bundled ${routes.length} handlers and ${consumers.length} consumers into backend/dist`,
);
