// Layer 3: the assertions that only exist because there is no
// Template.fromStack for Terraform.
//
// This is the file that satisfies the repo's third golden rule - every handler
// env var declared in the IaC and asserted in a test - and the only defence
// against the failure mode that makes this architecture worth being careful
// about: a variable that is set process-wide locally, so the feature works and
// the suite is green, and absent on the deployed function, where the handler
// quietly does nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ROUTES_JSON, serialiseRoutes } from "../scripts/emit-routes.js";
import { routes } from "./routes.js";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const buildTf = read("../../modules/booking/build.tf");
const lambdaTf = read("../../modules/booking/lambda.tf");
const apiTf = read("../../modules/booking/api.tf");

describe("routes.json", () => {
  it("is current", () => {
    // Terraform reads the committed JSON, because it cannot run node at plan
    // time. That makes a stale file possible, so a forgotten `npm run
    // routes:emit` fails here rather than deploying yesterday's route list.
    expect(readFileSync(ROUTES_JSON, "utf8")).toBe(serialiseRoutes());
  });

  it("is what Terraform actually reads", () => {
    expect(buildTf).toContain('jsondecode(file("${local.backend_dir}/routes.json"))');
  });
});

describe("environment variables", () => {
  // The transitive check. A handler "uses" a variable if anything it imports
  // reads one - a shared helper, a client module - and reading that off the
  // import graph by hand is exactly the step people skip. So each handler is
  // imported into a fresh module registry and asked what it actually wanted.
  const namesReadBy = async (entry: string): Promise<string[]> => {
    vi.resetModules();

    // env.js first, so the handler below populates this very instance of it.
    const { readEnvNames } = await import("./env.js");
    await import(entry.replace(/^src\//, "./").replace(/\.ts$/, ".js"));

    return readEnvNames();
  };

  for (const route of routes) {
    it(`${route.name} declares every variable it reads, transitively`, async () => {
      const read = await namesReadBy(route.entry);
      const declared: readonly string[] = route.env;

      // The safety property. Anything read but undeclared is a variable no
      // Terraform block passes, and the deployed function fails on its first
      // invocation - which is the good outcome, and still a bug.
      expect(read.filter((name) => !declared.includes(name))).toEqual([]);
    });

    it(`${route.name} declares nothing it does not read`, async () => {
      // Equality, not just containment, which also enforces the convention that
      // variables are read at module load. A variable resolved lazily inside a
      // function would not be captured above and would fail here - the fix is
      // to hoist the requireEnv call, not to relax this.
      const read = await namesReadBy(route.entry);
      expect([...route.env].sort()).toEqual(read);
    });
  }

  it("Terraform knows a value for every name any route declares", () => {
    // local.env_values is a map, and the lookup is not defaulted, so a route
    // naming something absent from it fails the plan with the key in the
    // message. This test says the same thing one step earlier and without
    // credentials.
    const block = lambdaTf.match(/env_values = \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    const known = [...block.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);

    const declared = [...new Set(routes.flatMap((route) => [...route.env]))];
    expect(declared.filter((name) => !known.includes(name))).toEqual([]);
  });

  it("passes each function only the variables its own route declared", () => {
    // Not a shared block for every function. Locally one process holds them
    // all; deployed, this comprehension is the boundary.
    expect(lambdaTf).toContain("for key in each.value.env : key => local.env_values[key]");
  });
});

describe("routes reach the deployed API", () => {
  it("builds the route key from the manifest rather than a second list", () => {
    expect(apiTf).toContain('route_key = "${each.value.method} ${each.value.path}"');
  });

  it("attaches the authorizer to staff routes and to nothing else", () => {
    expect(apiTf).toContain('each.value.auth == "staff" ? "JWT" : "NONE"');
    expect(apiTf).toContain(
      'each.value.auth == "staff" ? aws_apigatewayv2_authorizer.staff.id : null',
    );
  });

  it("has at least one public route and at least one staff route to prove both", () => {
    // If every route were staff, the wrapper's "public routes get no
    // authorizer" path would never run in either runtime.
    const auths = new Set(routes.map((route) => route.auth));
    expect(auths).toEqual(new Set(["public", "staff"]));
  });

  it("integrates with payload format 2.0, which is what the handlers speak", () => {
    // 1.0 would leave every handler reading undefined from requestContext.http
    // while returning a 200 with an empty body.
    expect(apiTf).toContain('payload_format_version = "2.0"');
  });
});

describe("least privilege", () => {
  it("grants table access only to routes that asked for it", () => {
    expect(lambdaTf).toContain(
      'for name, route in local.routes : name => route if route.access != "none"',
    );
  });

  it("gives a read-only route no write actions", () => {
    const readOnly = lambdaTf.split('] : [')[1] ?? "";
    expect(readOnly).toContain("dynamodb:Query");
    expect(readOnly).not.toContain("dynamodb:PutItem");
  });

  it("covers the indexes as well as the table, or a GSI query is denied", () => {
    expect(lambdaTf).toContain('"${aws_dynamodb_table.school.arn}/index/*"');
  });
});

describe("log groups", () => {
  it("creates them explicitly with retention", () => {
    // Left to Lambda, a group appears with retention "never" and outlives
    // terraform destroy as an orphan nobody agreed to pay for.
    expect(lambdaTf).toContain("resource \"aws_cloudwatch_log_group\" \"handler\"");
    expect(lambdaTf).toContain("retention_in_days = var.log_retention_days");
  });

  it("does not grant CreateLogGroup, which would recreate one after a destroy", () => {
    expect(lambdaTf).not.toContain("logs:CreateLogGroup");
  });
});
