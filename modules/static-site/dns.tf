# ---------------------------------------------------------------------------
# Custom domain. Everything here is skipped when var.domain_name is empty, so
# the module still works in an account with no hosted zone.
#
# The whole chain has to happen in one apply and in order: request a
# certificate, publish the records that prove the domain is yours, wait for ACM
# to see them, then hand the validated certificate to CloudFront. Attaching an
# unvalidated certificate fails the distribution update, not the certificate.
# ---------------------------------------------------------------------------

locals {
  custom_domain = var.domain_name != ""
}

data "aws_route53_zone" "this" {
  count = local.custom_domain ? 1 : 0

  name         = var.hosted_zone_name
  private_zone = false
}

# us-east-1, because CloudFront reads certificates from nowhere else. The data
# stays in ca-central-1; this is a certificate, which is metadata.
resource "aws_acm_certificate" "this" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  # A certificate cannot be replaced while a distribution is using it, so the
  # new one has to exist before the old one goes.
  lifecycle {
    create_before_destroy = true
  }
}

# DNS validation rather than email: it needs no mailbox, and it renews itself
# for as long as these records stay published. Email validation expires and
# needs a human every time.
resource "aws_route53_record" "cert_validation" {
  for_each = local.custom_domain ? {
    for option in aws_acm_certificate.this[0].domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}

  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  # A re-apply after a destroyed certificate writes the same record name again.
  # Without this Terraform refuses to touch a record it did not create.
  allow_overwrite = true
}

# Not a real resource - it blocks until ACM reports the certificate issued.
# This is what makes the distribution wait rather than fail.
resource "aws_acm_certificate_validation" "this" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# An alias record, not a CNAME. Alias is free to resolve, and it is the only
# option at a zone apex - which this subdomain is not, but there is no reason
# to use a different record type here than the one that works everywhere.
#
# A only, no AAAA: the distribution does not enable IPv6, and an AAAA record
# pointing at a distribution with no IPv6 address is a black hole for anyone
# on an IPv6-only network.
resource "aws_route53_record" "site" {
  count = local.custom_domain ? 1 : 0

  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name    = aws_cloudfront_distribution.this.domain_name
    zone_id = aws_cloudfront_distribution.this.hosted_zone_id

    # Health checks on an alias to CloudFront are not supported and cost extra
    # where they are. 06-cost adds a Route53 health check as a separate thing.
    evaluate_target_health = false
  }
}
