# ---------------------------------------------------------------------------
# The availability half of the guardrails.
#
# A prober, an alarm on what it reports, and an email. Route53 calls GET /health
# from three locations, CloudWatch watches the result, SNS mails the maintainer.
#
# Why pay for a prober at all, when API Gateway publishes its own 5xx metric for
# free: an alarm on 5xx needs traffic to produce a datapoint, and this site has
# near-dead traffic for ten months of the year. An alarm that cannot fire while
# nobody is looking is not a guardrail. A prober is what buys a signal at zero
# traffic, and that is the whole reason this costs anything.
#
# It watches the API rather than the site because /health was built for exactly
# this caller - see backend/src/handlers/health.ts, which says so - and because
# a health check on a CloudFront alias record is not supported at all, which
# modules/static-site/dns.tf already records where the alias is created.
# ---------------------------------------------------------------------------

# us-east-1, and the reason is one line down rather than here: a CloudWatch
# alarm can only publish to a topic in its own region, and the alarm below has
# no choice about its region. So the topic follows the alarm rather than the
# rest of the stack.
#
# This is the one place the project leaves Canada. It carries a health check id,
# a state transition and the maintainer's own address - no student data, no
# parent address, nothing a booking touches. CLAUDE.md calls the region
# non-negotiable for data, and none of this is data.
resource "aws_sns_topic" "alerts" {
  provider = aws.us_east_1
  count    = var.alert_email != "" ? 1 : 0

  name = "${var.project_name}-alerts"
}

# Terraform reports this as "pending confirmation" and leaves it there. AWS
# mails a link the moment the subscription is created and delivers nothing until
# a human clicks it, so a green apply is not yet an alarm that can reach anyone.
# Same shape as the SES recipient verification in 05, and the same one-time cost.
resource "aws_sns_topic_subscription" "alerts_email" {
  provider = aws.us_east_1
  count    = var.alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_route53_health_check" "api" {
  count = var.alert_email != "" ? 1 : 0

  # The API's own hostname, not the custom domain. So this guardrail works with
  # domain_name = "" - the stack minus the domain, not a broken stack.
  #
  # trimsuffix is load-bearing, not tidiness. A $default stage's invoke_url ends
  # in a slash, and "host/" is not a hostname - Route53 accepts the value, every
  # checker fails to resolve it, and the alarm reports the API down forever. The
  # front end strips the same slash for the same reason; see site/src/api.
  fqdn          = trimsuffix(replace(module.booking.api_url, "https://", ""), "/")
  type          = "HTTPS"
  port          = 443
  resource_path = "/health"

  request_interval  = 30
  failure_threshold = 3

  # Three checkers. The arithmetic is in variables.tf; the short version is that
  # deleting this line costs roughly a million extra requests a month against an
  # endpoint that otherwise serves a few hundred.
  regions = var.health_check_regions

  # Chargeable optional features, both declined.
  #
  # measure_latency buys a graph nobody here reads. String matching is the more
  # tempting one - it would catch a 200 carrying the wrong body - but /health
  # returns a constant from a handler that touches no datastore, so the failure
  # it would catch cannot happen without the 200 disappearing too.
  measure_latency = false

  tags = {
    Name = "${var.project_name}-api-health"
  }
}

# us-east-1, and NOT out of provider habit. This is the quietest failure in the
# stage.
#
# Route53 publishes HealthCheckStatus into AWS/Route53 in us-east-1 and nowhere
# else. Created in ca-central-1 this alarm finds no metric, sits in
# INSUFFICIENT_DATA forever and never fires - with no error at validate, none at
# plan, none at apply, and nothing in any log. Nothing about the stack looks
# wrong. It is simply not watching.
#
# routes.parity.test.ts asserts this line for that reason.
resource "aws_cloudwatch_metric_alarm" "api_down" {
  provider = aws.us_east_1
  count    = var.alert_email != "" ? 1 : 0

  alarm_name        = "${var.project_name}-api-down"
  alarm_description = "GET /health stopped answering the Route53 checkers. The booking path is down."

  namespace   = "AWS/Route53"
  metric_name = "HealthCheckStatus"
  dimensions = {
    HealthCheckId = aws_route53_health_check.api[0].id
  }

  # Minimum, not Average. One checker reporting unhealthy is worth knowing;
  # averaged across three it stays above the threshold until two of them agree.
  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 3

  # Missing data is the outage case here, not the quiet case. If Route53 stops
  # reporting on this check at all, that is not health.
  #
  # Known consequence: for the first few minutes after an apply there is no
  # metric yet, so the alarm opens in ALARM and settles to OK once the checkers
  # report. That is one pair of emails per apply, and in a workflow built on
  # apply / verify / destroy it is also the cheapest proof the path works.
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.alerts[0].arn]
  ok_actions    = [aws_sns_topic.alerts[0].arn]
}
