variable "name_prefix" {
  description = "Prefix for resource names, matching the rest of the stack."
  type        = string
}

variable "domain_name" {
  description = "Domain to verify as a sender, e.g. \"school.example.com\". This is the identity SES signs mail with."
  type        = string
}

variable "hosted_zone_name" {
  description = "Route53 zone that owns domain_name. The DKIM records are written into it, which is what makes verification reproducible instead of a console click."
  type        = string
}

variable "from_local_part" {
  description = "Local part of the sender address. Becomes <local_part>@<domain_name>."
  type        = string
  default     = "interviews"
}

variable "verified_recipients" {
  description = <<-EOT
    Addresses to verify as recipients.

    Verifying a domain authorises a *sender*. While the account is in the SES
    sandbox, every *recipient* has to be verified separately - so a demo inbox
    belongs here or the mail is accepted by SES and delivered nowhere.

    Each one gets an email from AWS with a link that has to be clicked. Terraform
    creates the identity; a human finishes it. Empty is correct for a real
    deployment with production access.
  EOT
  type        = list(string)
  default     = []
}

variable "tls_policy" {
  description = "REQUIRE refuses a receiver that cannot do STARTTLS. Correct for a system whose region choice is about data residency; OPTIONAL if a receiver turns out to be that old."
  type        = string
  default     = "REQUIRE"
}
