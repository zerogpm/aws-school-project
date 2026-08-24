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

  # Empty when no domain is configured, which is what every reference below
  # then sees. modules/booking treats an empty identity as "no consumer at all",
  # so a stage applied without a domain is the stack minus the email - not a
  # broken stack.
  ses_identity_arn          = try(module.email[0].identity_arn, "")
  ses_identity_arns         = try(module.email[0].identity_arns, [])
  ses_from_address          = try(module.email[0].from_address, "")
  ses_configuration_set_arn = try(module.email[0].configuration_set_arn, "")
}

# ---------------------------------------------------------------------------
# The episode.
#
# Counted rather than unconditional: SES verification here is DNS, so it needs a
# hosted zone. With no domain configured this creates nothing and the rest of
# the stage still applies.
# ---------------------------------------------------------------------------
module "email" {
  source = "../modules/email"
  count  = var.domain_name != "" ? 1 : 0

  name_prefix      = var.project_name
  domain_name      = var.domain_name
  hosted_zone_name = var.hosted_zone_name

  # The sandbox verifies senders and recipients separately, so a demo inbox has
  # to be named here or the mail is accepted and delivered nowhere.
  verified_recipients = var.verified_recipients
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

  # The hook 02 left for this stage, behind a switch that starts off.
  #
  # Flipping it while the account is still in the SES sandbox makes staff email
  # worse, not better: Cognito's built-in sender reaches anyone at 50 a day,
  # and SES in the sandbox reaches only verified addresses - which sixty staff
  # accounts are not. It would also fail this stage's own apply, because
  # scripts/create-staff.sh asks Cognito to email the demo account.
  #
  # Turn it on once ca-central-1 has production access, and apply again.
  ses_source_arn         = var.cognito_email_via_ses ? local.ses_identity_arn : ""
  ses_from_email_address = var.cognito_email_via_ses ? local.ses_from_address : ""
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

  # Turns on the table stream and, with an identity to send through, creates the
  # booking-email consumer that reads it. 03 and 04 call this same module and
  # pass none of these, so they get neither.
  stream_enabled = true

  # Known at plan time - it is a variable, not a resource attribute. Without a
  # domain there is no SES identity, so there is nothing for a consumer to send
  # through and it is correct to create none.
  email_enabled = var.domain_name != ""

  ses_identity_arns         = local.ses_identity_arns
  ses_from_address          = local.ses_from_address
  ses_configuration_set_arn = local.ses_configuration_set_arn

  # Where the confirmation email tells a parent to go to change or cancel.
  site_base_url = local.site_url

  build_handlers = var.build_handlers
}
