# Bucket names are globally unique across all of AWS, so they need a suffix
# that is stable across destroy/apply cycles. The account ID is both.
data "aws_caller_identity" "current" {}

module "static_site" {
  source = "../modules/static-site"

  name_prefix   = var.project_name
  bucket_suffix = data.aws_caller_identity.current.account_id
  force_destroy = var.force_destroy
}
