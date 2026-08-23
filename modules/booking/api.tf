# ---------------------------------------------------------------------------
# The HTTP API.
#
# HTTP API, not REST API: about a third of the price per million requests, and
# the JWT authorizer is built in rather than needing a Lambda of its own. The
# cost is fewer features - no request validation, no usage plans - none of which
# this system was going to use.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"

  # Preflight is answered here and never reaches a Lambda. The handlers build
  # their own CORS headers for the actual response from the same origin list -
  # see local.env_values.ALLOWED_ORIGINS in lambda.tf.
  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 300
  }
}

# Validates signature, issuer, audience and expiry, and answers 401 itself, so
# no handler re-verifies a token.
#
# It cannot check an arbitrary claim like cognito:groups - and Cognito scopes
# are granted per app client rather than per user - so the group check lives in
# the handler. That is the standard shape, not a workaround.
resource "aws_apigatewayv2_authorizer" "staff" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "${var.name_prefix}-staff"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = var.jwt_audience
    issuer   = var.jwt_issuer
  }
}

resource "aws_apigatewayv2_integration" "handler" {
  for_each = local.routes

  api_id           = aws_apigatewayv2_api.this.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.handler[each.key].invoke_arn

  # 2.0, matching what the handlers and the local wrapper both build. Set this
  # to 1.0 and every handler reads undefined from requestContext.http.
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "handler" {
  for_each = local.routes

  api_id = aws_apigatewayv2_api.this.id

  # "GET /windows". The manifest already stores gateway syntax, so nothing is
  # translated here - the Express form is derived from this, not the other way
  # around.
  route_key = "${each.value.method} ${each.value.path}"
  target    = "integrations/${aws_apigatewayv2_integration.handler[each.key].id}"

  authorization_type = each.value.auth == "staff" ? "JWT" : "NONE"
  authorizer_id      = each.value.auth == "staff" ? aws_apigatewayv2_authorizer.staff.id : null
}

# Scoped to the one route, not to the whole API. A wildcard here would let any
# route invoke any function, which is invisible until it matters.
resource "aws_lambda_permission" "api" {
  for_each = local.routes

  statement_id  = "AllowInvokeFrom${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/${each.value.method}${each.value.path}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.this.id

  # $default, so the API answers on its bare URL with no stage segment and the
  # front end needs no path prefix.
  name        = "$default"
  auto_deploy = true

  # The whole API, including the public booking routes a later episode adds.
  # This is a spend guard, not a capacity limit: the public routes need no
  # account, so the thing being throttled is a stranger with a loop, and the
  # budget for the entire system is under $20 a month.
  default_route_settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }

  # No access logging. It bills per ingested GB and answers questions nobody is
  # asking here; the handlers' own console.error lands in their log groups with
  # a week of retention. Turning it on is a decision, not a default.
}
