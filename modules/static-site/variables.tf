variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
}

variable "bucket_suffix" {
  description = "Suffix making bucket names globally unique. The account ID works and is stable across destroy/apply cycles."
  type        = string
}

variable "media_ia_transition_days" {
  description = "Days before media moves to Standard-IA."
  type        = number
  default     = 30
}

variable "media_glacier_ir_transition_days" {
  description = "Days before media moves to Glacier Instant Retrieval."
  type        = number
  default     = 90

  validation {
    condition     = var.media_glacier_ir_transition_days >= var.media_ia_transition_days + 30
    error_message = "S3 requires at least 30 days in Standard-IA before transitioning to Glacier IR."
  }
}

variable "noncurrent_version_expiration_days" {
  description = "Days before old object versions are purged. Versioning is the backup story, but keeping every version forever is a cost leak."
  type        = number
  default     = 90
}

variable "force_destroy" {
  description = <<-EOT
    Let terraform destroy delete the buckets while they still hold objects.

    True is right for this repo: every stage is applied, verified and destroyed,
    and versioning means an ordinary `aws s3 rm --recursive` does not actually
    empty a bucket - it writes a delete marker over each key and leaves every
    old version behind, so DeleteBucket still fails while `aws s3 ls` shows
    nothing. force_destroy makes Terraform purge versions and delete markers
    itself.

    Set it to false for anything holding real data. It is the difference between
    a failed destroy and a silently deleted photo archive.
  EOT
  type        = bool
  default     = true
}

variable "cloudfront_price_class" {
  description = "PriceClass_100 is North America + Europe only. The audience is one school."
  type        = string
  default     = "PriceClass_100"
}
