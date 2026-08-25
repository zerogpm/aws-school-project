output "site_bucket_name" {
  description = "Static site bucket. Deploy the front end here."
  value       = module.static_site.site_bucket_name
}

output "media_bucket_name" {
  description = "Media bucket. Presigned uploads target this."
  value       = module.static_site.media_bucket_name
}

output "site_url" {
  description = "Canonical public URL of the site - the custom domain when one is configured."
  value       = local.site_url
}

output "cloudfront_distribution_id" {
  description = "Needed for cache invalidation after a deploy."
  value       = module.static_site.cloudfront_distribution_id
}

output "user_pool_id" {
  description = "Pool ID. Needed to create staff accounts from the CLI."
  value       = module.auth.user_pool_id
}

output "aws_region" {
  description = "Region the pool lives in. The sign-in form needs it to build the cognito-idp endpoint."
  value       = var.aws_region
}

output "user_pool_client_id" {
  description = "Public app client ID. Safe to ship in the front end bundle."
  value       = module.auth.user_pool_client_id
}

output "hosted_ui_domain" {
  description = "Hosted UI domain for the staff sign-in page."
  value       = module.auth.hosted_ui_domain
}

output "hosted_ui_login_url" {
  description = "Paste this in a browser to test sign-in before the front end knows anything about Cognito."
  value       = module.auth.hosted_ui_login_url
}

output "issuer_url" {
  description = "OIDC issuer. The API Gateway JWT authorizer validates against this in a later stage."
  value       = module.auth.issuer_url
}

output "api_url" {
  description = "Base URL of the HTTP API. The front end calls this; curl it to check the stack is answering."
  value       = module.booking.api_url
}

output "table_name" {
  description = "The single table. Handlers that read it receive this as TABLE_NAME."
  value       = module.booking.table_name
}

output "function_names" {
  description = "Deployed function name per route, so reading a log group needs no guessing."
  value       = module.booking.function_names
}

output "ses_from_address" {
  description = "The address parents see on a confirmation."
  value       = try(module.email[0].from_address, "")
}

output "ses_verified_for_sending" {
  description = "False right after the first apply - DKIM takes minutes. Check this before the first demo booking, or the send is retried three times and dropped."
  value       = try(module.email[0].verified_for_sending, false)
}

output "ses_dkim_tokens" {
  description = "The three DKIM tokens, for confirming the CNAMEs resolved."
  value       = try(module.email[0].dkim_tokens, [])
}

output "consumer_function_names" {
  description = "The stream consumer, for reading its log group without guessing."
  value       = module.booking.consumer_function_names
}

output "guardrails_enabled" {
  description = "False when alert_email is unset. The stack minus the guardrails is a valid way to apply this stage, not a broken one."
  value       = var.alert_email != ""
}

output "alerts_topic_arn" {
  description = "The topic the health alarm publishes to. In us-east-1, because the alarm has to be."
  value       = try(aws_sns_topic.alerts[0].arn, "")
}

output "health_check_id" {
  description = "For aws route53 get-health-check-status - confirms three checkers are reporting, not a dozen."
  value       = try(aws_route53_health_check.api[0].id, "")
}

output "health_check_target" {
  description = "The URL Route53 probes. The API, not the site."
  value       = try("https://${aws_route53_health_check.api[0].fqdn}/health", "")
}

output "alarm_name" {
  description = "For aws cloudwatch set-alarm-state, which proves the email path without breaking the API. Region us-east-1."
  value       = try(aws_cloudwatch_metric_alarm.api_down[0].alarm_name, "")
}

output "budget_names" {
  description = "The monthly receipt and the daily tripwire, for aws budgets describe-budgets."
  value = compact([
    try(aws_budgets_budget.monthly[0].name, ""),
    try(aws_budgets_budget.daily[0].name, ""),
  ])
}
