// Emits backend/routes.json from src/routes.ts.
//
//   npm run routes:emit
//
// Terraform has to read the route list without running node, so the JSON is
// generated and committed rather than produced during an apply. That makes a
// stale routes.json possible, which is why src/routes.parity.test.ts asserts
// the committed file is byte-identical to what this script would write - a
// forgotten regen fails the test suite instead of the deploy.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { routes } from "../src/routes.js";

export const ROUTES_JSON = fileURLToPath(new URL("../routes.json", import.meta.url));

/** Two-space JSON with a trailing newline, so the file survives a diff cleanly. */
export function serialiseRoutes(): string {
  return `${JSON.stringify(routes, null, 2)}\n`;
}

// Only when invoked directly, so the test can import serialiseRoutes without
// rewriting the file it is about to check. Resolved paths, not string compare:
// `file://${process.argv[1]}` never matches import.meta.url on Windows.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  writeFileSync(ROUTES_JSON, serialiseRoutes(), "utf8");
  console.log(`==> wrote routes.json (${routes.length} routes)`);
}
