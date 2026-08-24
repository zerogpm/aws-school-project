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
const staffTf = read("../../04-booking/staff.tf");
const cloudfrontTf = read("../../modules/static-site/cloudfront.tf");

/**
 * The same file with comments removed.
 *
 * These assertions are about what the configuration *does*, and the comments
 * here discuss the very things being asserted absent - "not an
 * aws_cognito_user", "cannot call terraform output". Matching raw text made
 * both tests fail on their own explanation.
 */
const staffCode = staffTf
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

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

  it("grants ConditionCheckItem, which TransactWriteItems does not imply", () => {
    // create-booking's transaction opens with a ConditionCheck on the student.
    // That entry is authorised by its own action; without it the whole
    // transaction fails with AccessDenied even though every write in it was
    // permitted. DynamoDB Local grants everything, so only a deployed stage
    // ever showed this.
    expect(lambdaTf).toContain("dynamodb:ConditionCheckItem");
  });

  it("covers the indexes as well as the table, or a GSI query is denied", () => {
    expect(lambdaTf).toContain('"${aws_dynamodb_table.school.arn}/index/*"');
  });
});

describe("the demo staff account", () => {
  it("is a script, not an aws_cognito_user", () => {
    // password and temporary_password are both sensitive, which in Terraform
    // means plaintext in state - and destroy would delete every account in a
    // workflow built on apply/verify/destroy. Decided in 02; this keeps it.
    expect(staffCode).not.toContain("aws_cognito_user");
    expect(staffCode).toContain("scripts/create-staff.sh");
  });

  it("keeps the password out of state", () => {
    // triggers_replace is persisted. The password reaches the script through
    // the provisioner environment, which is not.
    const triggers = staffCode.split("triggers_replace")[1]?.split("}")[0] ?? "";
    expect(triggers).not.toContain("password");
    expect(staffCode).toContain("STAFF_PASSWORD = var.demo_staff_password");
  });

  it("passes the pool id in rather than reading its own output", () => {
    // A provisioner running inside an apply of this stage cannot call
    // terraform output on it - the state is locked.
    expect(staffCode).toContain("USER_POOL_ID = module.auth.user_pool_id");
    expect(staffCode).not.toContain("terraform output");
  });

  it("creates nothing unless an address is configured", () => {
    expect(staffCode).toContain('count = var.demo_staff_email != "" ? 1 : 0');
  });
});

describe("media bucket grants", () => {
  it("grants the bucket only to routes that asked for it", () => {
    expect(lambdaTf).toContain(
      'for name, route in local.routes : name => route if try(route.bucket, null) != null',
    );
  });

  it("scopes object access to the docs/ prefix, never the whole bucket", () => {
    // A grant wider than docs/ would let a handler write where the storage
    // economics differ - photos/ ages into Glacier IR and docs/ does not.
    expect(lambdaTf).toContain('resources = ["${var.media_bucket_arn}/${local.docs_prefix}*"]');
  });

  it("puts ListBucket on the bucket arn with a prefix condition, not on the prefix", () => {
    // The classic S3 IAM mistake: ListBucket is a bucket-level action, so
    // granting it against "arn:.../docs/*" validates fine and then denies every
    // list at runtime. The prefix has to be a condition instead.
    expect(lambdaTf).toContain("resources = [var.media_bucket_arn]");
    expect(lambdaTf).toContain('variable = "s3:prefix"');
  });

  it("gives a read-only route no PutObject", () => {
    const readRoutes = routes.filter((route) => "bucket" in route && route.bucket === "read");
    expect(readRoutes.length).toBeGreaterThan(0);
    // The write statement is gated on the value, so a read route generates no
    // PutObject statement at all.
    expect(lambdaTf).toContain('each.value.bucket == "write" ? [1] : []');
  });

  it("gives the delete route DeleteObject and nothing that could read a file", () => {
    const deleteRoutes = routes.filter((route) => "bucket" in route && route.bucket === "delete");
    expect(deleteRoutes.length).toBeGreaterThan(0);

    // Each object-level verb is gated on its own value, so a delete route
    // generates no GetObject and no PutObject statement at all. A role that can
    // only remove things cannot exfiltrate them.
    expect(lambdaTf).toContain('each.value.bucket == "delete" ? [1] : []');
    expect(lambdaTf).toContain('each.value.bucket == "read" ? [1] : []');
  });

  it("lets the delete route list, because it is handed a uuid rather than a key", () => {
    // delete-document takes an id and builds the prefix itself - a caller never
    // names a path. The cost of that is having to list the prefix to discover
    // the filename on the end, so ListBucket has to cover both values.
    expect(lambdaTf).toContain('contains(["read", "delete"], each.value.bucket)');
  });

  it("declares MEDIA_BUCKET for every route that touches the bucket", () => {
    for (const route of routes) {
      if (!("bucket" in route) || route.bucket === undefined) continue;
      expect([...route.env], route.name).toContain("MEDIA_BUCKET");
    }
  });
});

describe("published documents are reachable", () => {
  // The assertion this file was missing, and it cost a whole debugging session.
  //
  // Uploading worked, listing worked, and the URL answered 200 - with
  // Content-Type: text/html and the SPA's index.html in the body. CloudFront's
  // media behaviour matched "/media/*" while the objects were written under
  // "docs/", CloudFront does not strip a matched prefix, S3 answered 403, and
  // the distribution's SPA fallback turned that into a 200. Nothing published
  // was ever downloadable, and every layer reported success.
  //
  // Two files have to agree and neither imports the other: media.ts decides
  // where objects go, cloudfront.tf decides which paths reach the bucket.
  const declared = [
    ...(cloudfrontTf.match(/media_prefixes = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);

  it("routes the prefix the uploads are actually written to", async () => {
    const { DOCS_PREFIX } = await import("./media.js");

    expect(declared).not.toHaveLength(0);
    expect(declared).toContain(DOCS_PREFIX.replace(/\/$/, ""));
  });

  it("builds the path pattern from that prefix rather than a name of its own", () => {
    // "/media/*" was a path nothing in the bucket has ever lived under.
    expect(cloudfrontTf).toContain('path_pattern               = "/${ordered_cache_behavior.value}/*"');
    expect(cloudfrontTf).not.toContain('path_pattern               = "/media/*"');
  });

  it("hands list-documents the distribution to build links from", () => {
    // The bucket is private behind OAC, so an s3.amazonaws.com URL is a 403.
    // Only the distribution works, and only if Terraform passes it.
    const listDocuments = routes.find((route) => route.name === "list-documents");
    expect(listDocuments?.env).toContain("MEDIA_BASE_URL");
    expect(lambdaTf).toContain("MEDIA_BASE_URL  = var.media_base_url");
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
