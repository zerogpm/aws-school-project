# ---------------------------------------------------------------------------
# One Lambda, one log group, one role and one policy per route in the manifest.
# ---------------------------------------------------------------------------

locals {
  # The values behind the names a route lists in `env`. A route naming anything
  # absent from this map fails the plan with the key in the message, which is
  # the whole point: the alternative is a deployed function reading undefined
  # from a variable nobody wired, and behaving as though the feature is off.
  env_values = {
    ALLOWED_ORIGINS = join(",", var.allowed_origins)
    TABLE_NAME      = aws_dynamodb_table.school.name
  }

  function_names = { for name, route in local.routes : name => "${var.name_prefix}-${name}" }
}

# Created explicitly, and named to match what Lambda would create on its own.
# Left to Lambda the group appears with no retention and survives a destroy
# forever, as an orphan nobody remembers agreeing to pay for.
resource "aws_cloudwatch_log_group" "handler" {
  for_each = local.routes

  name              = "/aws/lambda/${local.function_names[each.key]}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# A role per function rather than one shared role. The grant is documentation of
# what the handler does, and a single role big enough for every handler says
# nothing about any of them.
resource "aws_iam_role" "handler" {
  for_each = local.routes

  name               = "${local.function_names[each.key]}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "aws_iam_policy_document" "logs" {
  for_each = local.routes

  statement {
    effect = "Allow"

    # No CreateLogGroup. The group is created above, and granting it here is how
    # a function quietly recreates a group after a destroy, retention and all.
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.handler[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.routes

  name   = "logs"
  role   = aws_iam_role.handler[each.key].id
  policy = data.aws_iam_policy_document.logs[each.key].json
}

# Only the routes that touch the table, and only with the verbs they use. A
# missing grant is invisible locally - the container accepts dummy credentials
# and grants everything - and surfaces deployed as AccessDeniedException.
data "aws_iam_policy_document" "table" {
  for_each = { for name, route in local.routes : name => route if route.access != "none" }

  statement {
    effect = "Allow"

    actions = each.value.access == "readwrite" ? [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:TransactWriteItems",
      ] : [
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]

    # The table and its indexes. A query against GSI1 is denied by a policy that
    # names only the table, and the error says AccessDenied on the index arn -
    # which is at least a clear message, unlike most of this file's failure
    # modes.
    resources = [
      aws_dynamodb_table.school.arn,
      "${aws_dynamodb_table.school.arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "table" {
  for_each = { for name, route in local.routes : name => route if route.access != "none" }

  name   = "table"
  role   = aws_iam_role.handler[each.key].id
  policy = data.aws_iam_policy_document.table[each.key].json
}

resource "aws_lambda_function" "handler" {
  for_each = local.routes

  function_name = local.function_names[each.key]
  role          = aws_iam_role.handler[each.key].arn

  # index.handler, matching `export const handler` in the bundled index.mjs.
  handler = "index.handler"
  runtime = "nodejs22.x"

  # Graviton. The bundle is JavaScript and does not care, and arm64 is about a
  # fifth cheaper per GB-second than x86 for identical work.
  architectures = ["arm64"]

  memory_size = 512

  # Local has no timeout at all, so this bound is only ever exercised deployed.
  # Anything slower than this returns 502 to a parent who will simply try again.
  timeout = each.value.timeout

  filename         = data.archive_file.handler[each.key].output_path
  source_code_hash = data.archive_file.handler[each.key].output_base64sha256

  environment {
    # Exactly the variables this route declared, and nothing else. Locally every
    # handler shares one process and sees them all, so this list is the only
    # thing standing between "works on my machine" and a feature that silently
    # does nothing in production.
    variables = { for key in each.value.env : key => local.env_values[key] }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.handler[each.key].name
  }
}
