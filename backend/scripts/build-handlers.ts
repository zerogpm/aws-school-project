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
import { routes } from "../src/routes.js";

const backendDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = resolve(backendDir, "dist");

await rm(distDir, { recursive: true, force: true });

for (const route of routes) {
  await build({
    entryPoints: [resolve(backendDir, route.entry)],

    // index.mjs, so the nodejs22.x runtime loads it as an ES module without a
    // package.json travelling in the zip. The Terraform sets handler
    // "index.handler", which has to match `export const handler`.
    outfile: resolve(distDir, route.name, "index.mjs"),

    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",

    // The runtime already ships AWS SDK v3. Bundling it would add megabytes to
    // every zip and seconds to every cold start, for a version the runtime
    // would otherwise keep patched.
    external: ["@aws-sdk/*"],

    minify: true,

    // Nothing reads a source map on a Lambda, and shipping one doubles the
    // artifact. The stack traces that matter name the bundled line, and the
    // handlers are small enough that the log tells you which one.
    sourcemap: false,
  });

  console.log(`  + ${route.name}`);
}

console.log(`==> bundled ${routes.length} handlers into backend/dist`);
