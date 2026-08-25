// Layer 3: the assertions that only exist because there is no
// Template.fromStack for Terraform.
//
// This is the file that satisfies the repo's third golden rule - every handler
// env var declared in the IaC and asserted in a test - and the only defence
// against the failure mode that makes this architecture worth being careful
// about: a variable that is set process-wide locally, so the feature works and
// the suite is green, and absent on the deployed function, where the handler
// quietly does nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CONSUMERS_JSON, ROUTES_JSON, serialiseConsumers, serialiseRoutes } from "../scripts/emit-routes.js";
import { consumers, routes } from "./routes.js";
import { bookingPk } from "./booking/keys.js";
import { tables } from "./schema.js";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const buildTf = read("../../modules/booking/build.tf");
const lambdaTf = read("../../modules/booking/lambda.tf");
const apiTf = read("../../modules/booking/api.tf");
const consumersTf = read("../../modules/booking/consumers.tf");
const tableTf = read("../../modules/booking/table.tf");
const cloudfrontTf = read("../../modules/static-site/cloudfront.tf");

/**
 * Every stage that ships the demo staff account, not just the newest one.
 *
 * This was pinned to `04-booking` back when 04 was the newest stage. 03 carries
 * a byte-identical copy that nothing checked, so the file could drift in one
 * stage while the suite stayed green - and any later stage would have been born
 * unchecked too. Discovered from disk instead, so a stage is covered the day it
 * grows a staff.tf.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const stageDirs = readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d\d-/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

/**
 * Stages that create the table, and therefore have to put rows in it.
 *
 * `terraform destroy` deletes the table, so a stage that creates one and does
 * not seed it produces a booking page saying "not open yet" on every single
 * apply. 03 and 04 shipped that way and it was rediscovered once per recording.
 *
 * Discovered rather than listed, for the same reason staffStages is: this is a
 * repo of cumulative stages, so anything true of one stage is usually true of
 * the next one somebody adds.
 */
const tableStages = stageDirs.filter((stage) =>
  existsSync(join(repoRoot, stage, "main.tf")) &&
  readFileSync(join(repoRoot, stage, "main.tf"), "utf8").includes('source = "../modules/booking"'),
);

const staffStages = stageDirs.filter((stage) => existsSync(join(repoRoot, stage, "staff.tf")));

/**
 * Stages that ship the guardrails.
 *
 * One today. Discovered rather than named, for the reason MISTAKES.md recorded
 * twice in a single day: an assertion pinned to the newest stage stops covering
 * it the moment a newer one arrives, and the copy nobody checks is the one that
 * drifts.
 */
const guardedStages = stageDirs.filter((stage) => existsSync(join(repoRoot, stage, "health.tf")));

/**
 * A .tf file with its comments removed.
 *
 * These assertions are about what the configuration *does*, and the comments in
 * these files discuss the very things being asserted absent - "not an
 * aws_cognito_user", "No logs:CreateLogGroup", "TRIM_HORIZON on a replaced
 * mapping". Matching raw text makes a file fail on its own explanation.
 */
const withoutComments = (tf: string): string =>
  tf
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

const consumersCode = withoutComments(consumersTf);

const staffCodeFor = (stage: string) => withoutComments(read(`../../${stage}/staff.tf`));

const healthCodeFor = (stage: string) => withoutComments(read(`../../${stage}/health.tf`));
const budgetCodeFor = (stage: string) => withoutComments(read(`../../${stage}/budget.tf`));
const stageVarsFor = (stage: string) => withoutComments(read(`../../${stage}/variables.tf`));

/**
 * Runs of spaces collapsed, so an assertion survives `terraform fmt`.
 *
 * fmt aligns `=` within a block, so the same argument is `count = ` in one
 * resource and `count    = ` in the next one that happens to carry a longer
 * attribute name. Matching raw text makes these tests fail on formatting.
 */
const squash = (tf: string): string => tf.replace(/[ 	]+/g, " ");

/**
 * One resource's body: from its header to the next `resource "`.
 *
 * Slicing to end-of-file instead is what made the first draft of the us-east-1
 * assertion decoration - the alarm's own provider line sat inside the slice
 * taken for the topic, so deleting the topic's provider kept the test green.
 */
const resourceBlock = (tf: string, header: string): string =>
  (tf.split(header)[1] ?? "").split('resource "')[0];

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

describe("consumers.json", () => {
  it("is current", () => {
    expect(readFileSync(CONSUMERS_JSON, "utf8")).toBe(serialiseConsumers());
  });

  it("is what Terraform actually reads", () => {
    expect(buildTf).toContain('jsondecode(file("${local.backend_dir}/consumers.json"))');
  });

  it("retriggers the bundle when it changes", () => {
    // source_hash covers src/**/*.ts and both manifests. Miss this and editing
    // only the manifest ships yesterday's zip against today's configuration.
    expect(buildTf).toContain('filesha256("${local.backend_dir}/consumers.json")');
  });

  it("names nothing that is also an HTTP route", () => {
    // The two lists key separate Terraform resources. A name in both would
    // collide on the function name, the log group and the role.
    // string[], not the literal union `routes` infers - the whole point is to
    // compare names across the two lists, which tsc would otherwise call a
    // mistake precisely because they are meant to be disjoint today.
    const routeNames: string[] = routes.map((route) => route.name);
    expect(consumers.filter((consumer) => routeNames.includes(consumer.name))).toEqual([]);
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

  // Routes and consumers together. The mechanism cares about an entry point,
  // not about what triggers it - a stream consumer reading an undeclared
  // variable is the same defect as a handler doing it, and fails the same way.
  for (const route of [...routes, ...consumers]) {
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

  it("Terraform knows a value for every name any route or consumer declares", () => {
    // local.env_values is a map, and the lookup is not defaulted, so a route
    // naming something absent from it fails the plan with the key in the
    // message. This test says the same thing one step earlier and without
    // credentials.
    const block = lambdaTf.match(/env_values = \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    const known = [...block.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);

    const declared = [
      ...new Set([...routes, ...consumers].flatMap((entry) => [...entry.env])),
    ];
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
  it("is shipped by at least one stage, or the cases below prove nothing", () => {
    // describe.each over an empty list is zero tests and a green run.
    expect(staffStages).not.toHaveLength(0);
  });

  describe.each(staffStages)("%s/staff.tf", (stage) => {
    const staffCode = staffCodeFor(stage);

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

describe("the table stream", () => {
  it("is on, and carries both images", () => {
    expect(tableTf).toContain("stream_enabled   = var.stream_enabled");
    expect(tableTf).toContain('"NEW_AND_OLD_IMAGES"');
  });

  it("is mirrored by the local schema, which nothing else keeps in sync", () => {
    // table.tf says outright that nothing keeps the two in sync. This is the
    // part where drift is silent: a NEW_IMAGE local table and a
    // NEW_AND_OLD_IMAGES deployed one pass every other test identically, and
    // the difference only shows up as a cancellation email with no recipient.
    expect(tables[0].StreamSpecification).toEqual({
      StreamEnabled: true,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    });
  });
});

describe("the stream consumer", () => {
  it("is not reachable over HTTP, by construction", () => {
    // The assertion that encodes the whole design decision. An event source
    // mapping pulls, using the function's own execution role, so a resource
    // policy here would be cargo cult - and an API Gateway route would be a
    // public URL onto a function nobody should be able to call.
    expect(consumersCode).not.toContain("aws_lambda_permission");
    expect(consumersCode).not.toContain("aws_apigatewayv2");
  });

  it("starts at LATEST, so a replacement does not re-mail the school", () => {
    // TRIM_HORIZON on a replaced mapping re-reads up to 24 hours of stream and
    // sends a confirmation for every booking in it.
    expect(consumersCode).toContain('starting_position = "LATEST"');
    expect(consumersCode).not.toContain("TRIM_HORIZON");
  });

  it("reports individual record failures rather than failing the batch", () => {
    expect(consumersCode).toContain('function_response_types = ["ReportBatchItemFailures"]');
  });

  it("bounds its retries and isolates a poison record", () => {
    // The default is retry-until-expiry, which is 24 hours of one bad record
    // blocking the shard while every confirmation behind it waits.
    expect(consumersTf).toContain("maximum_retry_attempts         = 3");
    expect(consumersTf).toContain("bisect_batch_on_function_error = true");
  });

  it("builds its filter from the manifest rather than a second copy of the prefix", () => {
    expect(consumersCode).toContain("each.value.keyPrefix");
    expect(consumersCode).not.toContain('prefix = "BOOKING#"');
  });

  it("filters on the key prefix the key builder actually produces", () => {
    // Rename the prefix in booking/keys.ts and the filter goes deaf: the
    // consumer simply stops being invoked, with no error anywhere and every
    // other test still green.
    for (const consumer of consumers) {
      expect(consumer.keyPrefix, consumer.name).toBe(bookingPk(""));
    }
  });

  it("scopes stream reads to the stream, and ListStreams to nothing", () => {
    // ListStreams enumerates, so it cannot be resource-scoped. Naming the
    // stream ARN there is the plausible-looking mistake, and it leaves the
    // mapping stuck in Creating with a message that never mentions the line.
    expect(consumersTf).toContain("resources = [aws_dynamodb_table.school.stream_arn]");
    expect(consumersTf).toContain('actions   = ["dynamodb:ListStreams"]');
    expect(consumersTf).toContain('resources = ["*"]');
  });

  it("waits for its own stream grant before creating the mapping", () => {
    // Terraform cannot infer this: the mapping references the stream and the
    // function, never the policy. Without it the first apply fails on
    // permissions and the second succeeds.
    expect(consumersTf).toContain("depends_on = [aws_iam_role_policy.consumer_stream]");
  });

  it("creates its log group explicitly, with retention", () => {
    expect(consumersCode).toContain('resource "aws_cloudwatch_log_group" "consumer"');
    expect(consumersCode).toContain("retention_in_days = var.log_retention_days");
    expect(consumersCode).not.toContain("logs:CreateLogGroup");
  });

  it("passes each consumer only the variables it declared", () => {
    expect(consumersTf).toContain("for key in each.value.env : key => local.env_values[key]");
  });

  it("creates nothing at all until a stage wires an identity to send through", () => {
    // 03 and 04 call this same module. Without the gate they would demand an
    // SES identity they have no reason to own.
    expect(consumersCode).toContain("notify = var.email_enabled");
    expect(buildTf).toContain("local.notify ?");
  });
});

describe("seeding a deployed stage", () => {
  it("is needed by at least one stage, or the case below proves nothing", () => {
    expect(tableStages).not.toHaveLength(0);
  });

  it.each(tableStages)("%s seeds the table it creates", (stage) => {
    // Without this the stage applies to an empty table and the booking page
    // says "not open yet" - correctly, and confusingly, because nothing looks
    // broken. It cost a recording before anyone connected the two.
    expect(existsSync(join(repoRoot, stage, "seed.tf")), `${stage} has no seed.tf`).toBe(true);
  });

  it.each(tableStages)("%s keeps the seeded rows out of Terraform state", (stage) => {
    // The reason seeding was left out originally, and still the constraint: a
    // student as an aws_dynamodb_table_item means `terraform destroy` deletes
    // the school roll. The provisioner shells out instead, exactly as staff.tf
    // does for the demo account.
    const seedTf = withoutComments(readFileSync(join(repoRoot, stage, "seed.tf"), "utf8"));
    expect(seedTf).toContain("local-exec");
    expect(seedTf).not.toContain("aws_dynamodb_table_item");
  });
});

describe("the guardrails", () => {
  it("are shipped by at least one stage, or the cases below prove nothing", () => {
    // describe.each over an empty list is zero tests and a green run.
    expect(guardedStages).not.toHaveLength(0);
  });

  describe.each(guardedStages)("%s", (stage) => {
    const healthCode = squash(healthCodeFor(stage));
    const budgetCode = squash(budgetCodeFor(stage));
    const varsCode = squash(stageVarsFor(stage));

    it("puts the alarm and its topic in us-east-1", () => {
      // The quietest failure in the stage, and the reason this block exists.
      //
      // Route53 publishes HealthCheckStatus into AWS/Route53 in us-east-1 and
      // nowhere else. This alarm created in ca-central-1 finds no metric, sits
      // in INSUFFICIENT_DATA forever and never fires - no error at validate, at
      // plan or at apply, and nothing in any log. Nothing looks wrong; it is
      // simply not watching. A CloudWatch alarm can also only publish to a
      // topic in its own region, so the topic has to follow the alarm.
      const alarm = resourceBlock(healthCode, 'resource "aws_cloudwatch_metric_alarm"');
      const topic = resourceBlock(healthCode, 'resource "aws_sns_topic" "alerts"');

      expect(alarm).toContain("provider = aws.us_east_1");
      expect(topic).toContain("provider = aws.us_east_1");
    });

    it("pins the health checker regions", () => {
      // Unpinned, Route53 probes from every location it has - AWS documents the
      // endpoint taking a request "about every two seconds", roughly 1.3 million
      // a month against a system built for near-dead traffic, instead of 260
      // thousand. Deleting the argument breaks nothing and raises the bill.
      expect(healthCode).toContain("regions = var.health_check_regions");
    });

    it("asks for at least the three checker regions the API requires", () => {
      const block = varsCode.split('variable "health_check_regions"')[1] ?? "";
      const defaults = block.split("default")[1]?.split("]")[0] ?? "";

      expect(defaults.split(",").filter((region) => region.includes("-")).length)
        .toBeGreaterThanOrEqual(3);
    });

    it("strips the trailing slash off the API url before using it as a hostname", () => {
      // A $default stage's invoke_url ends in a slash. "host/" is not a
      // hostname: Route53 accepts it, every checker fails to resolve it, and the
      // alarm reports the API permanently down - a guardrail that cries wolf
      // from the moment it is created is worse than no guardrail. The front end
      // strips the same slash for the same reason.
      const check = resourceBlock(healthCode, 'resource "aws_route53_health_check"');

      expect(check).toContain("trimsuffix(");
    });

    it("declines the chargeable optional features it said it would", () => {
      // Both are named as cuts in the README. A cut that quietly un-cuts itself
      // is worse than never having made it.
      expect(healthCode).not.toContain("search_string");
      expect(healthCode).not.toContain("measure_latency = true");
    });

    it("ships both budgets", () => {
      // The daily one is the runaway tripwire, and the easiest thing here to
      // lose in a refactor: nothing else in the repo references it, and the
      // monthly budget goes on looking like complete cost coverage without it.
      expect(budgetCode).toContain('time_unit = "MONTHLY"');
      expect(budgetCode).toContain('time_unit = "DAILY"');
    });

    it("budgets the target rather than the cap", () => {
      // CLAUDE.md caps the system at $20/month and targets $10. Budgeting the
      // cap puts the first warning at $10 and the last one after the month is
      // already lost.
      const block = varsCode.split('variable "monthly_budget_usd"')[1]?.split("validation")[0] ?? "";
      const configured = Number.parseInt(block.split("default")[1]?.split("=")[1]?.trim() ?? "", 10);

      expect(configured).toBeGreaterThan(0);
      expect(configured).toBeLessThanOrEqual(20);
    });

    it("creates nothing unless an address is configured", () => {
      // Same shape as staff.tf. Half-wired is worse than absent here: a topic
      // with no subscriber looks like monitoring and reaches nobody.
      // Every resource, not merely one of them. toContain over a whole file only
      // proves that *something* is gated, and a half-applied guardrail - a topic
      // with no alarm behind it, a health check nothing watches - is the failure
      // worth catching. This assertion was decoration until it counted.
      const gated = (tf: string) => tf.split('count = var.alert_email != "" ? 1 : 0').length - 1;
      const resources = (tf: string) => tf.split('resource "').length - 1;

      expect(gated(healthCode)).toBe(resources(healthCode));
      expect(gated(budgetCode)).toBe(resources(budgetCode));
    });
  });
});
