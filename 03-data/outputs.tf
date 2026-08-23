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
