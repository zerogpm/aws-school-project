# Bucket names and the Cognito hosted UI domain are globally unique across all
# of AWS, so both need a suffix that is stable across destroy/apply cycles. The
# account ID is both.
data "aws_caller_identity" "current" {}

locals {
  # The custom domain when there is one, the distribution's own name otherwise.
  # This is what the front end and the outputs call the site.
  site_url = module.static_site.site_url

  # The existing /staff page doubles as the OAuth redirect target: the hosted UI
  # sends the browser back there with ?code=, and the SPA exchanges it. No extra
  # route, and no server to host one on.
  staff_url = "${local.site_url}/staff"
}

module "static_site" {
  source = "../modules/static-site"

  # The module needs a us-east-1 provider for the ACM certificate even when no
  # custom domain is configured - a module cannot declare one conditionally.
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix   = var.project_name
  bucket_suffix = data.aws_caller_identity.current.account_id
  force_destroy = var.force_destroy

  domain_name      = var.domain_name
  hosted_zone_name = var.hosted_zone_name
}

module "auth" {
  source = "../modules/auth"

  name_prefix   = var.project_name
  domain_suffix = data.aws_caller_identity.current.account_id

  # Cognito matches redirect URLs literally, so these are built from the module
  # rather than typed by hand into a tfvars file. A destroyed and recreated
  # distribution changes its name, and the client follows it in the same apply.
  #
  # Every origin the site answers on, not just the canonical one: with a custom
  # domain attached the distribution still responds to its *.cloudfront.net
  # name, and the front end derives redirect_uri from whichever origin the
  # browser is actually on. Registering only the custom domain would turn a
  # visit to the old URL into a redirect_mismatch on Cognito's own error page.
  callback_urls = concat(
    [for origin in module.static_site.site_origins : "${origin}/staff"],
    [for origin in var.dev_origins : "${origin}/staff"],
  )
  logout_urls = concat(module.static_site.site_origins, var.dev_origins)
}

module "booking" {
  source = "../modules/booking"

  name_prefix = var.project_name

  # Every origin the site answers on, plus any local one being developed
  # against. The API reads this twice - API Gateway answers the CORS preflight
  # from it, and each Lambda receives it as ALLOWED_ORIGINS - so there is one
  # list rather than two implementations of one policy.
  #
  # With a custom domain attached the distribution still responds to its
  # *.cloudfront.net name, and the front end derives its API calls from whatever
  # origin the browser is on, so both have to be allowed.
  allowed_origins = concat(module.static_site.site_origins, var.dev_origins)

  # The authorizer validates against the pool this stage just created. Taken
  # from the module rather than typed into a tfvars file: a destroyed and
  # recreated pool changes both values, and they follow it in the same apply.
  jwt_issuer   = module.auth.issuer_url
  jwt_audience = [module.auth.user_pool_client_id]

  # The bucket modules/static-site already created. Routes that declare
  # `bucket` in the manifest receive the name as MEDIA_BUCKET and an IAM grant
  # scoped to docs/ built from the arn.
  media_bucket_name = module.static_site.media_bucket_name
  media_bucket_arn  = module.static_site.media_bucket_arn

  # The distribution, not the bucket. list-documents turns each key into a URL
  # with this on the front, and the bucket is private - only CloudFront can read
  # it. Taken from the module so a recreated distribution carries the links with
  # it in the same apply.
  media_base_url = module.static_site.site_url

  build_handlers = var.build_handlers
}
