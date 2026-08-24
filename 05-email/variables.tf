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

variable "build_handlers" {
  description = "Bundle backend/src with esbuild as part of the apply. Requires node locally. False expects backend/dist to already hold a bundle per route."
  type        = bool
  default     = true
}

variable "demo_staff_email" {
  description = <<-EOT
    Create one office-staff account with this address after the pool is up.
    Empty creates nothing, which is the right default for a real deployment.

    Exists because the pool is recreated on every apply, and signing in to the
    admin page otherwise means making a user in the console first. The account
    is created by scripts/create-staff.sh and never enters Terraform state.
  EOT
  type        = string
  default     = ""
}

variable "demo_staff_password" {
  description = <<-EOT
    Password for demo_staff_email. Empty means Cognito emails a temporary one
    and forces a change at first sign-in, which is correct for a real account
    and tedious for a demo.

    Set it in terraform.tfvars, which is gitignored. It is passed to the script
    through the provisioner environment and is never written to state.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "verified_recipients" {
  description = <<-EOT
    Addresses to verify as SES recipients, for demos while the account is in the
    sandbox.

    Verifying the domain authorises the sender. It says nothing about who may
    receive: in the sandbox SES accepts a message to an unverified address and
    delivers it nowhere. Each address here gets a link from AWS that a human has
    to click once.

    Empty is correct once ca-central-1 has production access.
  EOT
  type        = list(string)
  default     = ["uptimeunicorn@gmail.com"]
}

variable "cognito_email_via_ses" {
  description = <<-EOT
    Send Cognito's staff email through SES instead of its built-in sender.

    Off, and it has to stay off until this region has SES production access.
    Cognito's own sender is capped at 50 messages a day but reaches anyone; SES
    in the sandbox is uncapped but reaches only verified addresses, which sixty
    staff accounts are not. Flipping this early takes staff invites from limited
    to impossible, and fails this stage's apply at the demo-staff script.

    Turn it on, then apply again, once production access lands.
  EOT
  type        = bool
  default     = false
}

variable "seed_demo_data" {
  description = <<-EOT
    Write the four demo students, both interview windows and the whole slot grid
    after the table is created.

    On by default because this repo's workflow is apply / verify / destroy, and
    destroy takes the table with it - so without this every apply produces a
    booking page that correctly says "not open yet" and a demo that cannot
    start.

    Nothing about the rows reaches Terraform state; the provisioner runs the
    same seeder a human would. Set false for a real deployment, which wants a
    real roll loaded by the office rather than four fictional students.
  EOT
  type        = bool
  default     = true
}
