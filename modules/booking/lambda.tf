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
    MEDIA_BUCKET    = var.media_bucket_name
    MEDIA_BASE_URL  = var.media_base_url
  }

  # Staff-uploaded PDFs. modules/static-site scopes its lifecycle by prefix, so
  # a grant wider than this would let a handler write where the storage
  # economics are different - photos/ ages into Glacier IR and docs/ does not.
  docs_prefix = "docs/"

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

      # Its own action, and not implied by TransactWriteItems. A ConditionCheck
      # entry inside a transaction is authorised separately from the writes
      # around it, so a transaction that reads "is this student real?" fails
      # with AccessDenied while every Put and Update in the same call would have
      # been allowed. Invisible locally - the container grants everything - and
      # the first booking against a deployed stage is where it surfaces.
      "dynamodb:ConditionCheckItem",
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

# Only the routes that declared `bucket` in the manifest, and only with the
# verbs that value implies. Same shape as the table policy above and for the
# same reason: the grant is documentation of what the handler does.
#
# "write" is PutObject on the prefix. It is deliberately not paired with
# ListBucket - the upload route signs a policy and never reads the bucket, and
# a function that cannot list cannot enumerate what other people uploaded.
data "aws_iam_policy_document" "bucket" {
  for_each = { for name, route in local.routes : name => route if try(route.bucket, null) != null }

  dynamic "statement" {
    # Object-level verbs, on the prefix rather than the bucket.
    for_each = each.value.bucket == "write" ? [1] : []

    content {
      effect    = "Allow"
      actions   = ["s3:PutObject"]
      resources = ["${var.media_bucket_arn}/${local.docs_prefix}*"]
    }
  }

  dynamic "statement" {
    for_each = each.value.bucket == "read" ? [1] : []

    content {
      effect    = "Allow"
      actions   = ["s3:GetObject"]
      resources = ["${var.media_bucket_arn}/${local.docs_prefix}*"]
    }
  }

  # "delete" gets DeleteObject and nothing else at the object level. Notably no
  # GetObject: unpublishing does not require being able to read the file, and a
  # role that can only remove things cannot exfiltrate them.
  dynamic "statement" {
    for_each = each.value.bucket == "delete" ? [1] : []

    content {
      effect    = "Allow"
      actions   = ["s3:DeleteObject"]
      resources = ["${var.media_bucket_arn}/${local.docs_prefix}*"]
    }
  }

  # ListBucket is a *bucket*-level action, not an object one, and it takes the
  # bucket arn with no key suffix. Granting it against "arn:.../docs/*" is the
  # classic S3 IAM mistake: the policy validates, and every list returns
  # AccessDenied. The prefix is constrained by a condition instead.
  #
  # Both read and delete need it. The delete route is handed a uuid rather than
  # a key - deliberately, so a caller cannot shape a path - which leaves it
  # having to list the prefix to discover the filename on the end.
  dynamic "statement" {
    for_each = contains(["read", "delete"], each.value.bucket) ? [1] : []

    content {
      effect    = "Allow"
      actions   = ["s3:ListBucket"]
      resources = [var.media_bucket_arn]

      condition {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = ["${local.docs_prefix}*"]
      }
    }
  }
}

resource "aws_iam_role_policy" "bucket" {
  for_each = { for name, route in local.routes : name => route if try(route.bucket, null) != null }

  name   = "media-bucket"
  role   = aws_iam_role.handler[each.key].id
  policy = data.aws_iam_policy_document.bucket[each.key].json
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
