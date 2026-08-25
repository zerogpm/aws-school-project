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

variable "alert_email" {
  description = <<-EOT
    Where both guardrails send. Empty creates neither.

    One address, not a list, and it is the maintainer's rather than the staff
    roll - one teacher runs this and there is no IT staff, so a budget threshold
    or a dead API is not something the other fifty-nine can act on.

    The budgets mail this address directly. The health alarm reaches it through
    SNS, which means AWS sends a subscription confirmation that a human has to
    click once. Until that click the topic has no confirmed subscriber, and an
    apply that succeeded is not yet an alarm that can reach anybody.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.alert_email == "" || can(regex("^[^@]+@[^@]+[.][^@]+$", var.alert_email))
    error_message = "alert_email must be an address or empty - a typo here fails silently, because nothing tests that an alert arrived."
  }
}

variable "monthly_budget_usd" {
  description = <<-EOT
    Monthly cost budget, in USD. Three notifications hang off it: actual at 50%,
    actual at 100%, and forecast at 100%.

    Ten, not twenty. Twenty is the hard cap; ten is the target. Budgeting the cap
    means the first warning lands at ten dollars and the last one lands after the
    month is already lost. Budgeting the target puts the first mail at five, with
    fifteen dollars of runway still ahead of it.

    The forecast threshold is the one that earns its place - it says on day
    twelve that ten is coming, rather than on day thirty that it went.
  EOT
  type        = number
  default     = 10

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than zero - a budget of zero notifies on the first cent and then every day after."
  }
}

variable "daily_budget_usd" {
  description = <<-EOT
    Daily cost budget, in USD. One notification, actual at 100%.

    The tripwire for a runaway - the self-retriggering Lambda in MISTAKES.md,
    billed per invocation and per request on every turn. A monthly budget takes
    weeks to notice that. This narrows it to about a day.

    About a day, not the same day. AWS evaluates daily budgets against prior
    full-day data and refreshes up to three times a day, so the mail arrives the
    morning after. It is a detector, not a control; the control is the
    prefix-scoped trigger and reserved concurrency.

    One threshold on purpose. A tripwire with three settings is three chances to
    learn to ignore it.

    Free, because AWS gives sixty budget-days a month and this is the second of
    two. A third budget would start costing $0.02 a day.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.daily_budget_usd > 0
    error_message = "daily_budget_usd must be greater than zero - the stack burns a few cents a day even idle, so zero mails every morning forever."
  }
}

variable "health_check_regions" {
  description = <<-EOT
    Which Route53 health-checker regions probe the API. Three is the minimum the
    API accepts, and three is what this asks for.

    The most expensive-looking cheap line in the stage. Left unset, Route53
    probes from every location it has - AWS documents the endpoint receiving a
    request "about every two seconds", which is roughly 1.3 million requests a
    month against a system built for near-dead traffic. That is API Gateway
    charges plus enough invocations to eat the Lambda free tier, to watch a site
    nobody is visiting. Three checkers on a 30 second interval is roughly 260
    thousand.

    Deleting this argument breaks nothing. It raises the bill, quietly, and
    nothing goes red - which is why routes.parity.test.ts asserts it.
  EOT
  type        = list(string)
  default     = ["us-east-1", "us-west-1", "eu-west-1"]

  validation {
    condition     = length(var.health_check_regions) >= 3
    error_message = "Route53 requires at least three health-checker regions - fewer is rejected at apply, and more only raises the request count the endpoint pays for."
  }
}
