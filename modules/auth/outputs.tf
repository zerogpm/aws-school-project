output "user_pool_id" {
  description = "Pool ID. Needed to create staff accounts from the CLI."
  value       = aws_cognito_user_pool.staff.id
}

output "user_pool_arn" {
  description = "Pool ARN. The API Gateway JWT authorizer references this in a later stage."
  value       = aws_cognito_user_pool.staff.arn
}

output "user_pool_client_id" {
  description = "Public app client ID. Safe to ship in the front end bundle - it identifies the app, it does not authorise anything."
  value       = aws_cognito_user_pool_client.web.id
}

output "user_pool_endpoint" {
  description = "Pool endpoint without a scheme, as Cognito reports it."
  value       = aws_cognito_user_pool.staff.endpoint
}

output "issuer_url" {
  description = "OIDC issuer. This is the value a JWT authorizer validates tokens against."
  value       = "https://${aws_cognito_user_pool.staff.endpoint}"
}

output "hosted_ui_domain" {
  description = "Hosted UI domain, e.g. school-staff-123456789012.auth.ca-central-1.amazoncognito.com"
  value       = "${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
}

output "hosted_ui_login_url" {
  description = "Full sign-in URL for the first callback URL. Paste this in a browser to test the pool before any front end exists."
  value = join("", [
    "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com/login",
    "?client_id=${aws_cognito_user_pool_client.web.id}",
    "&response_type=code",
    "&scope=${urlencode(join(" ", ["openid", "email", "profile"]))}",
    "&redirect_uri=${urlencode(var.callback_urls[0])}",
  ])
}

output "group_names" {
  description = "Groups created in the pool."
  value       = sort(keys(aws_cognito_user_group.this))
}
