variable "name_prefix" {
  description = "Prefix for resource names and the value of the Project tag."
  type        = string
}

variable "allowed_origins" {
  description = <<-EOT
    Origins allowed to call the API. One list, read twice: API Gateway answers
    the CORS preflight from it, and every Lambda receives it as ALLOWED_ORIGINS
    and echoes an allowed origin back on the actual response. Two
    implementations of one policy is survivable only because the policy itself
    has a single source.
  EOT
  type        = list(string)

  validation {
    condition     = alltrue([for origin in var.allowed_origins : !endswith(origin, "/")])
    error_message = "Drop the trailing slash - an Origin header never has one, and the comparison is literal."
  }
}

variable "jwt_issuer" {
  description = "Cognito OIDC issuer URL. The authorizer validates tokens against it."
  type        = string
}

variable "jwt_audience" {
  description = "App client IDs the authorizer accepts, matching the token's aud claim."
  type        = list(string)
}

variable "media_bucket_name" {
  description = <<-EOT
    The media bucket from modules/static-site. Routes declaring `bucket` in the
    manifest receive it as MEDIA_BUCKET and get an IAM grant scoped to docs/.

    Passed in rather than looked up, so this module stays independent of how the
    bucket is named and a stage can point it somewhere else.
  EOT
  type        = string
}

variable "media_bucket_arn" {
  description = "ARN of the same bucket. The IAM grants need the arn; the handler needs the name."
  type        = string
}

variable "media_base_url" {
  description = <<-EOT
    Origin a browser fetches a published document from, with no trailing slash.
    Reaches list-documents as MEDIA_BASE_URL, which builds one URL per object.

    The CloudFront distribution, not the bucket. Both buckets are private and
    reached only through OAC, so an s3.amazonaws.com URL answers 403 - and the
    distribution already serves the site from the same origin, which is what
    makes a download link same-origin and `<a download>` work at all.
  EOT
  type        = string
}

variable "build_handlers" {
  description = <<-EOT
    Run esbuild over backend/src as part of the apply. Requires node locally.
    False expects backend/dist to already hold a bundle per route - useful when
    Terraform runs somewhere node does not.
  EOT
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch retention for the handler log groups. Lambda's own default is never, which bills forever."
  type        = number
  default     = 7
}

variable "throttle_rate_limit" {
  description = <<-EOT
    Steady-state requests per second across the whole API. Deliberately low:
    traffic is near-dead most of the year and spikes to roughly 300 parents in
    one evening twice a year, and the thing being protected is a $20/month
    budget rather than a capacity limit.
  EOT
  type        = number
  default     = 20
}

variable "throttle_burst_limit" {
  description = "Requests the API will absorb above the rate limit before shedding."
  type        = number
  default     = 50
}

variable "point_in_time_recovery" {
  description = "PITR on the table. A booking cannot be lost, so this is on by default; it roughly doubles storage cost on a table this small, which is cents."
  type        = bool
  default     = true
}

variable "stream_enabled" {
  description = "DynamoDB stream on the table, which the booking-email consumer reads. Off by default so 03 and 04 - which share this module and predate the stream - see no diff on their next apply. 05 turns it on."
  type        = bool
  default     = false
}

variable "email_enabled" {
  description = "Create the booking-email consumer. A plain bool, and deliberately not derived from ses_identity_arn: that arrives from an SES resource and is unknown until apply, and a for_each whose KEYS are unknown cannot be planned."
  type        = bool
  default     = false
}

variable "ses_identity_arns" {
  description = "Every SES identity the send must be authorised against - the sending domain, and each verified recipient, because SES evaluates a recipient that is itself a verified identity as a resource on SendEmail."
  type        = list(string)
  default     = []
}

variable "ses_from_address" {
  description = "From address on parent confirmations. Must belong to ses_identity_arn."
  type        = string
  default     = ""

  validation {
    condition     = var.ses_from_address == "" || length(var.ses_identity_arns) > 0
    error_message = "ses_from_address does nothing without ses_identity_arns - there is no identity to send through."
  }
}

variable "ses_configuration_set_arn" {
  description = "SES configuration set attached to the identity, named in the send policy because IAM evaluates it as a second resource on the same call."
  type        = string
  default     = ""
}

variable "stream_batching_window_seconds" {
  description = "How long the poller waits to fill a batch. Higher is fewer GetRecords calls against a table that is idle most of the year, at the cost of that much delay on a confirmation email."
  type        = number
  default     = 5
}

variable "site_base_url" {
  description = "Canonical site URL. The confirmation email links back to it so a parent can cancel without hunting for the address."
  type        = string
  default     = ""
}
