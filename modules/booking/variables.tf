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
