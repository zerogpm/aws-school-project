# ---------------------------------------------------------------------------
# DKIM, in the zone Route53 already hosts.
#
# This is the reason to verify a domain rather than a single address: the
# verification is three CNAMEs, so it lives in code and survives a destroy and
# re-apply. Verifying an address instead means clicking a link every time, which
# is not reproducible and cannot be filmed twice.
# ---------------------------------------------------------------------------

data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}

resource "aws_route53_record" "dkim" {
  # Static keys, apply-time values.
  #
  # for_each over the tokens themselves reads better and cannot be planned: the
  # tokens do not exist until SES has created the identity, so the KEYS of this
  # resource would be unknown and Terraform refuses. Easy DKIM always returns
  # exactly three, so the index is the key and the token is the value - which is
  # what the error message means by "define the map keys statically".
  for_each = toset(["0", "1", "2"])

  zone_id = data.aws_route53_zone.this.zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[tonumber(each.key)]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[tonumber(each.key)]}.dkim.amazonses.com"]

  # Short, because these are the records a verification failure makes you want
  # to change quickly.
  ttl = 600

  # A destroy leaves the zone; a re-apply writes the same names. Without this
  # the second apply fails on records it is about to manage anyway - the same
  # reasoning as the certificate validation records in modules/static-site.
  allow_overwrite = true
}
