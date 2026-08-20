data "aws_region" "current" {}

locals {
  # Globally unique across every AWS account, like an S3 bucket name.
  domain_prefix = "${var.name_prefix}-staff-${var.domain_suffix}"

  use_ses = var.ses_source_arn != ""
}

# ---------------------------------------------------------------------------
# The pool. Roughly sixty staff accounts, created by the office. Parents and
# students never appear here - a parent books an interview with a student
# number, not an account, which is the entire reason this pool stays small
# enough to be free.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "staff" {
  name = "${var.name_prefix}-staff"

  # See the variable for why this is named rather than left to the AWS default.
  user_pool_tier = var.user_pool_tier

  deletion_protection = var.deletion_protection

  # The sign-in identifier is the school email address. This and the schema
  # block below are ForceNew: changing either replaces the pool, which deletes
  # every account in it. Decide them before the first real invite goes out.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    # Teachers will type their address however their phone capitalises it.
    case_sensitive = false
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }

  # No self-registration. There is no path from the public internet to an
  # account here - the office creates every one.
  admin_create_user_config {
    allow_admin_create_user_only = true

    # Deliberately does not name the hosted UI URL: the domain resource depends
    # on this pool, so referencing it here would be a cycle.
    invite_message_template {
      email_subject = "Your ${var.name_prefix} staff account"
      email_message = "Your username is {username} and your temporary password is {####}. Sign in from the Staff page on the school website and choose a new password."

      # Never sent. Invites go out with desired_delivery_mediums EMAIL, and this
      # pool has no SNS caller role to send SMS with even if something asked it
      # to. Cognito validates the whole template block regardless and rejects an
      # empty sms_message with "Member must have length greater than or equal to
      # 6", so the field has to be populated to create the pool at all.
      #
      # {username} and {####} are both required placeholders.
      sms_message = "{username}, your temporary ${var.name_prefix} password is {####}"
    }
  }

  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    temporary_password_validity_days = var.temporary_password_validity_days

    # No symbol requirement. It buys very little against an attacker and costs a
    # lot against sixty people who have no help desk to call. Length is the
    # control that matters, and password_history_size is an ESSENTIALS feature
    # this pool does not pay for.
    require_symbols = false
  }

  # TOTP only. SMS MFA needs an SNS caller role and bills per message to a
  # school with no phone numbers on file.
  mfa_configuration = var.mfa_configuration

  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration == "OFF" ? [] : [1]

    content {
      enabled = true
    }
  }

  # Email only. Recovering an account by SMS would mean collecting and storing
  # staff phone numbers, and paying per message to do it.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Cognito's built-in sender is capped at 50 emails a day, which is under the
  # sixty invites this pool eventually needs - so the first onboarding spans two
  # days unless SES is wired in. SES arrives properly in 05-waitlist; this hook
  # lets a stage pass it down without editing the module.
  email_configuration {
    email_sending_account = local.use_ses ? "DEVELOPER" : "COGNITO_DEFAULT"
    source_arn            = local.use_ses ? var.ses_source_arn : null
    from_email_address    = local.use_ses ? var.ses_from_email_address : null
  }
}

# Groups are free and ride along in the token as cognito:groups. The API
# authorizer in a later stage reads that claim; nothing checks it yet.
resource "aws_cognito_user_group" "this" {
  for_each = var.groups

  name         = each.key
  user_pool_id = aws_cognito_user_pool.staff.id
  description  = each.value.description
  precedence   = each.value.precedence
}

# ---------------------------------------------------------------------------
# Hosted UI. Nobody here is building a sign-in page, storing a password hash,
# or handling a forgot-password flow - that is the whole argument for Cognito
# in a project with one part-time maintainer.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool_domain" "this" {
  domain       = local.domain_prefix
  user_pool_id = aws_cognito_user_pool.staff.id

  # Version 1 is the classic hosted UI. Version 2 is managed login, whose
  # branding editor needs ESSENTIALS or PLUS. Named explicitly so the pool tier
  # and the sign-in page cannot drift apart.
  managed_login_version = 1

  # No custom auth.school.example domain: that needs an ACM certificate in
  # us-east-1 and an A record, for a page sixty people see a few times a term.
}
