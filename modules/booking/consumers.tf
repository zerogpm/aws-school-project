# ---------------------------------------------------------------------------
# The Lambda nothing calls.
#
# Every other function in this module exists because a route in routes.json
# points at it. This one is woken by the table's own stream, and it is the
# exception .claude/rules/handlers.md names in as many words: "a non-HTTP
# trigger - is a deliberate, commented exception, not a quiet one".
#
# It is a parallel of lambda.tf rather than an extension of it. The resources
# there are keyed `for_each = local.routes` and routes.parity.test.ts asserts
# those expressions by string, so widening them would break the assertions that
# make the route half trustworthy. Same shapes, different key set.
#
# Two things are deliberately absent, and their absence is the lesson:
#
#   - No aws_apigatewayv2_* anything. There is no URL. Nothing routes to this.
#   - No aws_lambda_permission. API Gateway *pushes*, so it needs a resource
#     policy naming it as an allowed caller. An event source mapping *pulls*,
#     using this function's own execution role - so the authorisation lives in
#     the role below, and a resource policy here would be cargo cult.
#
# The whole block evaporates when local.notify is false, which is what 03 and
# 04 see: no identity to send through, no consumer, no stream reads.
# ---------------------------------------------------------------------------

locals {
  # A plan-time bool, not a test on the SES ARN.
  #
  # The obvious version - `var.ses_identity_arn != ""` - is what was written
  # first, and terraform validate accepts it happily. It fails at plan: 05 wires
  # that ARN from an aws_sesv2_email_identity, so it is unknown until apply, so
  # the KEYS of every for_each below are unknown, so nothing can be planned.
  # Keys must be static; apply-time values belong on the right-hand side only.
  notify = var.email_enabled

  consumer_function_names = {
    for name, consumer in local.consumers : name => "${var.name_prefix}-${name}"
  }
}

resource "aws_cloudwatch_log_group" "consumer" {
  for_each = local.consumers

  name              = "/aws/lambda/${local.consumer_function_names[each.key]}"
  retention_in_days = var.log_retention_days
}

# Reuses the assume-role document from lambda.tf. It has no for_each, so there
# is one policy document shared by every function in the module - the only part
# of a role that genuinely is identical everywhere.
resource "aws_iam_role" "consumer" {
  for_each = local.consumers

  name               = "${local.consumer_function_names[each.key]}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "aws_iam_policy_document" "consumer_logs" {
  for_each = local.consumers

  statement {
    effect = "Allow"
    # No logs:CreateLogGroup. The group is created above with a retention, and a
    # function able to create its own would quietly recreate it after a destroy -
    # with no retention, forever, as an orphan nobody agreed to pay for.
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.consumer[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "consumer_logs" {
  for_each = local.consumers

  name   = "logs"
  role   = aws_iam_role.consumer[each.key].id
  policy = data.aws_iam_policy_document.consumer_logs[each.key].json
}

# ---------------------------------------------------------------------------
# Reading the stream.
#
# This is a grant on the stream, not on the table, and they are different ARNs.
# The consumer also needs table access for its own reasons - the parent's
# address and the send-once marker - and that is the separate policy below.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "consumer_stream" {
  for_each = local.consumers

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
    ]
    resources = [aws_dynamodb_table.school.stream_arn]
  }

  # ListStreams is not resource-scoped - it enumerates, so there is nothing to
  # scope it to. Naming the stream ARN here is the plausible-looking mistake,
  # and it produces an event source mapping stuck in Creating with a message
  # that never mentions this line.
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:ListStreams"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "consumer_stream" {
  for_each = local.consumers

  name   = "table-stream"
  role   = aws_iam_role.consumer[each.key].id
  policy = data.aws_iam_policy_document.consumer_stream[each.key].json
}

# The table itself: reading the student profile for the parent's address, and
# writing the marker that keeps a retried batch from mailing twice.
data "aws_iam_policy_document" "consumer_table" {
  for_each = { for name, consumer in local.consumers : name => consumer if consumer.access != "none" }

  statement {
    effect = "Allow"
    actions = each.value.access == "readwrite" ? [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      ] : [
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.school.arn]
  }
}

resource "aws_iam_role_policy" "consumer_table" {
  for_each = { for name, consumer in local.consumers : name => consumer if consumer.access != "none" }

  name   = "table"
  role   = aws_iam_role.consumer[each.key].id
  policy = data.aws_iam_policy_document.consumer_table[each.key].json
}

# Sending.
#
# Both the identity and the configuration set are named as resources. When a
# configuration set is attached to the identity, IAM evaluates it as a second
# resource on the same call - and a grant covering only the identity fails with
# an AccessDeniedException that names neither of them.
data "aws_iam_policy_document" "consumer_ses" {
  for_each = local.consumers

  statement {
    effect  = "Allow"
    actions = ["ses:SendEmail"]
    # Every identity, plus the configuration set.
    #
    # Two things here are not obvious and both were found the hard way:
    #
    # The RECIPIENT is a resource. SES evaluates a recipient that is itself a
    # verified identity in the account as a resource on SendEmail - and in the
    # sandbox every recipient is one, because that is what the sandbox requires.
    # Granting only the sender fails with an AccessDeniedException that names
    # the recipient, which reads like the recipient is misconfigured.
    #
    # The configuration set is a resource too, when one is attached to the
    # identity. Granting only the identities fails the same way, naming neither.
    resources = concat(
      var.ses_identity_arns,
      [var.ses_configuration_set_arn],
    )
  }
}

resource "aws_iam_role_policy" "consumer_ses" {
  for_each = local.consumers

  name   = "ses-send"
  role   = aws_iam_role.consumer[each.key].id
  policy = data.aws_iam_policy_document.consumer_ses[each.key].json
}

resource "aws_lambda_function" "consumer" {
  for_each = local.consumers

  function_name = local.consumer_function_names[each.key]
  role          = aws_iam_role.consumer[each.key].arn

  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = each.value.timeout

  filename         = data.archive_file.consumer[each.key].output_path
  source_code_hash = data.archive_file.consumer[each.key].output_base64sha256

  environment {
    variables = { for key in each.value.env : key => local.env_values[key] }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.consumer[each.key].name
  }
}

# ---------------------------------------------------------------------------
# The mapping, where most of the decisions live.
# ---------------------------------------------------------------------------
resource "aws_lambda_event_source_mapping" "consumer" {
  for_each = local.consumers

  event_source_arn  = aws_dynamodb_table.school.stream_arn
  function_name     = aws_lambda_function.consumer[each.key].arn
  starting_position = "LATEST"

  # LATEST, never TRIM_HORIZON. A replaced mapping with TRIM_HORIZON re-reads up
  # to 24 hours of stream and re-sends a confirmation for every booking in it.
  # The send-once markers would catch most of that, and "most" is not a thing to
  # rely on when the blast radius is every parent in the school.

  batch_size = each.value.batchSize

  # A cost control before it is a latency one. With no window the poller issues
  # GetRecords several times a second per shard, all year, against a table that
  # is idle for most of it. Five seconds of delay on a confirmation email is
  # invisible to a parent; the polling line item is not invisible on a $20
  # budget. The real number belongs in 06-cost.
  maximum_batching_window_in_seconds = var.stream_batching_window_seconds

  # The default is -1: retry until the record ages out, which is 24 hours. One
  # poison record would then block the shard for a day and every confirmation
  # behind it waits. Three attempts, then bisect to isolate the bad record.
  maximum_retry_attempts         = 3
  bisect_batch_on_function_error = true

  # Lets the handler report which records failed instead of failing the batch.
  function_response_types = ["ReportBatchItemFailures"]

  # One booking writes four items - the slot, the CLAIM# guard, the TIME# guard
  # and the booking itself - and only the last carries the parent's address. The
  # filter means the other three never cost an invocation.
  #
  # Note this can only filter on the `dynamodb` key: DynamoDB sources do not
  # support filtering on eventName, so INSERT-versus-REMOVE is decided in the
  # handler. jsonencode rather than a hand-escaped string, because the escaped
  # form is where the typos hide and a malformed pattern fails open into
  # "matches nothing" rather than into an error.
  filter_criteria {
    filter {
      pattern = jsonencode({
        dynamodb = {
          Keys = {
            PK = { S = [{ prefix = each.value.keyPrefix }] }
          }
        }
      })
    }
  }

  # Terraform cannot infer this. The mapping references the stream and the
  # function, never the policy, so without it the mapping races its own IAM
  # grant - failing on a first apply and succeeding on the second, which is the
  # most confusing shape a bug can have.
  depends_on = [aws_iam_role_policy.consumer_stream]
}
