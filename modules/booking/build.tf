# ---------------------------------------------------------------------------
# The route manifest, and the bundle built from it.
#
# backend/src/routes.ts is the source of truth for both runtimes. The Express
# wrapper imports it directly; Terraform reads the emitted JSON, because it
# cannot run node at plan time. backend/src/routes.parity.test.ts asserts the
# committed JSON is current, so a forgotten `npm run routes:emit` fails the test
# suite rather than deploying a stale route list.
# ---------------------------------------------------------------------------

locals {
  backend_dir = "${path.module}/../../backend"

  # Keyed by name, because every physical resource below is per-route.
  routes = {
    for route in jsondecode(file("${local.backend_dir}/routes.json")) :
    route.name => route
  }

  # Any change to a handler, a helper it imports, or the manifest itself means
  # a rebuild. Hashing the whole tree over-triggers on a test-only edit, which
  # costs one wasted esbuild run - the opposite mistake ships a stale bundle.
  source_hash = sha256(join("", concat(
    [for f in fileset("${local.backend_dir}/src", "**/*.ts") : filesha256("${local.backend_dir}/src/${f}")],
    [filesha256("${local.backend_dir}/routes.json")],
  )))
}

# Bundling is a shell-out for the same reason deploying the site is: Terraform
# evaluates fileset() at plan time, so a clean checkout with no backend/dist yet
# would plan zero files and silently ship nothing. The cost is that plan cannot
# show what changes inside here.
resource "terraform_data" "bundle" {
  count = var.build_handlers ? 1 : 0

  triggers_replace = {
    source_hash = local.source_hash
  }

  provisioner "local-exec" {
    working_dir = local.backend_dir
    command     = "npm run --silent build:handlers"
  }
}

# depends_on defers this to apply rather than plan, which is what lets it read a
# bundle the apply is about to create. Without it, a first apply zips a
# directory that does not exist yet.
data "archive_file" "handler" {
  for_each = local.routes

  type        = "zip"
  source_dir  = "${local.backend_dir}/dist/${each.key}"
  output_path = "${local.backend_dir}/dist/${each.key}.zip"

  depends_on = [terraform_data.bundle]
}
