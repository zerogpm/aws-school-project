variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
}

variable "bucket_suffix" {
  description = "Suffix making bucket names globally unique. The account ID works and is stable across destroy/apply cycles."
  type        = string
}

variable "domain_name" {
  description = <<-EOT
    Custom domain for the site, e.g. "school.example.com".

    Empty means no custom domain: the distribution keeps its *.cloudfront.net
    name and its default certificate, and no Route53 or ACM resources are
    created at all. That is what 01-storage used before the domain existed, and
    it stays the default so the module works in an account with no hosted zone.
  EOT
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = <<-EOT
    Route53 zone that owns domain_name, e.g. "example.com". Required when
    domain_name is set.

    Named rather than derived from domain_name: a subdomain can be several
    labels deep, and there is no way to tell from the name alone where the
    zone boundary falls. Using a subdomain of an existing zone also avoids a
    second hosted zone at $0.50/month.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || var.hosted_zone_name != ""
    error_message = "hosted_zone_name is required when domain_name is set - the records have to be written into some zone."
  }

  validation {
    condition     = var.domain_name == "" || endswith(var.domain_name, var.hosted_zone_name)
    error_message = "domain_name must sit inside hosted_zone_name, e.g. school.example.com inside example.com."
  }
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
