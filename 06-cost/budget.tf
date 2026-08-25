# ---------------------------------------------------------------------------
# The cost half of the guardrails.
#
# Two budgets, and neither of them is a CloudWatch alarm. CloudWatch does carry
# a cost metric - AWS/Billing EstimatedCharges - and it is the worse tool three
# times over: it publishes only in us-east-1, it needs "Receive Billing Alerts"
# switched on by hand in the Billing console so Terraform cannot set it, and it
# alarms only on money already spent. An alarm on it applies clean, looks wired,
# and silently never fires.
#
# Budgets forecasts, and mails the address directly - no SNS topic, no topic
# policy, no confirmation click on this path.
#
# Both are free. AWS gives sixty budget-days a month, which is exactly two
# budgets running every day of one; a third would start costing $0.02 a day.
# That is the reason there are two here and not five.
#
# Account-wide, with no cost filter, and the trade is worth stating because this
# account does run unrelated workloads - README.md says so under Running costs.
#
# Both ways of narrowing it are wrong in a way that matters more:
#
# Filtering on ca-central-1 is what README.md recommends for reading Cost
# Explorer, and it is right there - immediate and retroactive. It is wrong here,
# because it would miss most of this stage. The health check, its SNS topic and
# alarm, CloudFront and Route53 are billed in us-east-1 or as global, and by the
# estimate in the README they are roughly seventy percent of what this costs. A
# budget that cannot see the largest line is not a budget.
#
# Filtering on the Project tag scopes correctly but only going forward: cost
# allocation tags are not retroactive, they need activating by hand under
# Billing, and a tag key does not appear there until a resource carrying it has
# existed for up to 24 hours. A guardrail that silently covers nothing for the
# first day is the failure mode this whole episode is about.
#
# So: the whole account, and monthly_budget_usd is set against the whole
# account's baseline rather than this project's. It over-reports by whatever
# else runs here, which fails safe - it warns early rather than late.
#
# Both are destroyed with the stage. A destroyed stack spends nothing, so that
# is correct - but it does mean the account has no budget between recordings,
# and the standing net for that is a second budget made by hand. See the README.
# ---------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  count = var.alert_email != "" ? 1 : 0

  name         = "${var.project_name}-monthly"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"

  # Half the target, as the early warning.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # The target itself, as the fact.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # The one that actually saves the month. The two above report; this one warns.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

resource "aws_budgets_budget" "daily" {
  count = var.alert_email != "" ? 1 : 0

  name         = "${var.project_name}-daily"
  budget_type  = "COST"
  time_unit    = "DAILY"
  limit_amount = tostring(var.daily_budget_usd)
  limit_unit   = "USD"

  # One threshold, and no forecast. A daily budget is a tripwire, and AWS
  # evaluates it against prior full-day data anyway - forecasting a day that has
  # already closed is not a thing.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
