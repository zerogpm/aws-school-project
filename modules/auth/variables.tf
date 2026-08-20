variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
}

variable "domain_suffix" {
  description = "Suffix making the hosted UI domain prefix globally unique. The account ID works and is stable across destroy/apply cycles."
  type        = string

  validation {
    condition     = !can(regex("aws|amazon|cognito", lower("${var.name_prefix}-staff-${var.domain_suffix}")))
    error_message = "Cognito rejects a hosted UI domain prefix containing 'aws', 'amazon' or 'cognito'. Caught here instead of 40 seconds into an apply."
  }
}

variable "callback_urls" {
  description = "Exact URLs the hosted UI may redirect back to after sign-in. Cognito matches these literally - no wildcards, no trailing-slash leniency."
  type        = list(string)

  validation {
    condition     = length(var.callback_urls) > 0
    error_message = "At least one callback URL is required, or the hosted UI has nowhere to return to."
  }
}

variable "logout_urls" {
  description = "Exact URLs the hosted UI may redirect to after sign-out."
  type        = list(string)
  default     = []
}

variable "user_pool_tier" {
  description = <<-EOT
    Cognito feature plan: LITE, ESSENTIALS or PLUS.

    Set explicitly because the AWS default for a new pool is ESSENTIALS, not the
    cheapest option. Sixty staff sit inside the free MAU allowance on any plan,
    so this is not about today's bill - it is about not silently sitting on a
    higher per-MAU rate that nobody chose.

    LITE means the classic hosted UI rather than the newer managed login
    branding, and no threat protection, password history, or refresh token
    rotation. This school has no security team to read threat findings.
  EOT
  type        = string
  default     = "LITE"

  validation {
    condition     = contains(["LITE", "ESSENTIALS", "PLUS"], var.user_pool_tier)
    error_message = "user_pool_tier must be LITE, ESSENTIALS or PLUS."
  }
}

variable "deletion_protection" {
  description = <<-EOT
    ACTIVE blocks terraform destroy on the user pool.

    INACTIVE is right for this repo, whose workflow is apply, verify, destroy,
    six times over. It is the wrong answer for a pool holding real staff
    accounts: a deleted pool cannot be restored and every account has to be
    recreated by hand.
  EOT
  type        = string
  default     = "INACTIVE"

  validation {
    condition     = contains(["ACTIVE", "INACTIVE"], var.deletion_protection)
    error_message = "deletion_protection must be ACTIVE or INACTIVE."
  }
}

variable "mfa_configuration" {
  description = "OFF, ON (required) or OPTIONAL. Only TOTP is enabled - SMS costs per message and needs an SNS role."
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "ON", "OPTIONAL"], var.mfa_configuration)
    error_message = "mfa_configuration must be OFF, ON or OPTIONAL."
  }
}

variable "password_minimum_length" {
  description = "Minimum staff password length. Length beats symbol soup, and nobody here can reset a locked-out account at 8pm."
  type        = number
  default     = 12

  validation {
    condition     = var.password_minimum_length >= 8
    error_message = "Cognito's own floor is 8 characters."
  }
}

variable "temporary_password_validity_days" {
  description = "How long an invited staff member has to use their temporary password before the office has to re-invite them."
  type        = number
  default     = 14
}

variable "access_token_validity_minutes" {
  description = "Access token lifetime. Short, because revocation only takes effect when a token expires."
  type        = number
  default     = 60
}

variable "id_token_validity_minutes" {
  description = "ID token lifetime."
  type        = number
  default     = 60
}

variable "refresh_token_validity_days" {
  description = "How long before a teacher has to sign in again. Long enough that the hosted UI is not a daily tax; short enough that a departing staff member's session dies on its own."
  type        = number
  default     = 30
}

variable "groups" {
  description = "Groups created in the pool. Lower precedence wins when a user is in several. Groups are free and land in the token as cognito:groups, which is what the API authorizer reads later."
  type = map(object({
    description = string
    precedence  = number
  }))
  default = {
    office = {
      description = "Office staff: open interview windows, publish the timetable, manage accounts"
      precedence  = 1
    }
    teacher = {
      description = "Teachers: view their own rosters, upload media"
      precedence  = 10
    }
  }
}

variable "hosted_ui_css" {
  description = <<-EOT
    Stylesheet for the classic hosted UI. Empty creates no customization at all.

    Cognito accepts only a fixed set of `*-customizable` class names, with a
    restricted property list per class, and rejects the whole stylesheet if it
    sees anything else. It cannot change the page layout - only how the existing
    elements look.
  EOT
  type        = string
  default     = <<-CSS
    /* This is the card, not the page - Cognito does not expose the outer
       background at all. Paper, so the labels below are readable; a dark card
       needs every text colour inverted and Cognito will not let you restyle
       the "Forgot your password?" link to match. */
    .background-customizable {
      background: #fbfaf7;
    }
    .banner-customizable {
      background: #235437;
      padding: 20px 0 20px 0;
    }
    .label-customizable {
      color: #16211b;
      font-weight: 600;
    }
    .textDescription-customizable {
      color: #5b6b62;
      padding-top: 10px;
      padding-bottom: 10px;
    }
    .inputField-customizable {
      border-color: #e3e0d8;
      border-radius: 6px;
      border-width: 1px;
      color: #16211b;
      font-size: 15px;
      padding: 10px;
    }
    .inputField-customizable:focus {
      border-color: #2f6b46;
      outline: 0;
    }
    .submitButton-customizable {
      background-color: #235437;
      border-radius: 6px;
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      margin: 18px 0 10px 0;
      padding: 12px;
    }
    .submitButton-customizable:hover {
      background-color: #2f6b46;
      color: #ffffff;
    }
    .redirect-customizable {
      padding: 8px;
    }
    .errorMessage-customizable {
      background: #fbfaf7;
      border-color: #e3e0d8;
      color: #16211b;
      padding: 12px;
    }
  CSS
}

variable "ses_source_arn" {
  description = "ARN of a verified SES identity to send Cognito email through. Empty uses Cognito's built-in sender, which is capped at 50 emails a day."
  type        = string
  default     = ""
}

variable "ses_from_email_address" {
  description = "From address for Cognito email. Only used when ses_source_arn is set, and must be an address SES has verified."
  type        = string
  default     = ""

  validation {
    condition     = var.ses_from_email_address == "" || var.ses_source_arn != ""
    error_message = "ses_from_email_address does nothing without ses_source_arn - Cognito's default sender uses its own address."
  }
}
