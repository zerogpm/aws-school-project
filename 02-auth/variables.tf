variable "aws_region" {
  description = "Region for all resources."
  type        = string
  default     = "ca-central-1"

  validation {
    condition     = startswith(var.aws_region, "ca-")
    error_message = "Region must be Canadian - student data residency is not negotiable."
  }
}

variable "project_name" {
  description = "Prefix for resource names and the value of the Project tag."
  type        = string
  default     = "school"
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete buckets that still hold objects. True suits this repo's apply/verify/destroy cycle; set false for real data."
  type        = bool
  default     = true
}

variable "deploy_site" {
  description = "Build the front end and upload it as part of terraform apply. Requires node and the AWS CLI locally."
  type        = bool
  default     = true
}

variable "dev_origins" {
  description = <<-EOT
    Extra origins allowed to complete a hosted UI sign-in, for running the front
    end locally - e.g. ["http://localhost:5173"]. Each becomes a callback URL of
    <origin>/staff and a logout URL of <origin>.

    Empty by default: a deployed client should only redirect to the deployed
    site. Uncomment it while working on the sign-in flow, and take it back out.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for origin in var.dev_origins :
      startswith(origin, "https://") || startswith(origin, "http://localhost")
    ])
    error_message = "Cognito only accepts a plain http callback for localhost. Anything else must be https."
  }

  validation {
    condition     = alltrue([for origin in var.dev_origins : !endswith(origin, "/")])
    error_message = "Drop the trailing slash - these are concatenated with /staff, and Cognito matches redirect URLs literally."
  }
}

variable "domain_name" {
  description = "Custom domain for the site, e.g. \"school.example.com\". Empty keeps the *.cloudfront.net name and creates no Route53 or ACM resources."
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = "Route53 zone that owns domain_name, e.g. \"example.com\". Required when domain_name is set. Using a subdomain of a zone you already have avoids a second hosted zone at $0.50/month."
  type        = string
  default     = ""
}
