# ---------------------------------------------------------------------------
# One verified identity, two consumers.
#
# The stream consumer in modules/booking mails parents through it, and the
# Cognito pool in modules/auth can send staff invites through it. That is the
# whole reason this is its own module rather than a few resources inside
# modules/booking: an identity is not owned by the thing that happens to send
# the most mail through it.
#
# Region matters here in a way it does not elsewhere in this stack. SES identity
# verification, sandbox status and sending quota are all per-region, and a domain
# verified in one region is not "partially set up" in another - it is unknown.
# Everything below exists in var.aws_region, which is Canadian, because a
# parent's address and their child's interview time are exactly the data the
# region choice was made for.
# ---------------------------------------------------------------------------

# Bounce and complaint suppression, which is the part that protects the sending
# reputation nobody is watching. An address that hard-bounces is suppressed
# account-wide rather than retried into a spam classification.
#
# No event destination. That would be the bounce feed, and CLAUDE.md's entire
# monitoring story is a Budgets alarm and a health check - a Kinesis Firehose to
# read bounce events would cost more than the system it monitors.
resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = "${var.name_prefix}-mail"

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  delivery_options {
    tls_policy = var.tls_policy
  }

  reputation_options {
    reputation_metrics_enabled = true
  }
}

# The sender. DKIM signing is what makes a receiving server believe the mail is
# ours; without it a school newsletter from a domain nobody can verify is a
# spam-folder message at best.
resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.domain_name
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# The recipients, and the thing that surprises people about the sandbox.
#
# Verifying the domain above lets us *send*. It does nothing about who may
# *receive*: until the account has production access in this region, SES accepts
# a message to an unverified address and delivers it nowhere. So a demo inbox is
# an identity in its own right.
#
# Terraform creates it; AWS emails it a link; a human clicks the link. There is
# no resource that waits for that, and none that can do it.
resource "aws_sesv2_email_identity" "recipient" {
  for_each = toset(var.verified_recipients)

  email_identity = each.value
}
