# Bucket names are globally unique across all of AWS, so they need a suffix
# that is stable across destroy/apply cycles. The account ID is both.
data "aws_caller_identity" "current" {}

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
