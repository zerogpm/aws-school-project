output "identity_arn" {
  description = "The domain identity. Named in the consumer's ses:SendEmail policy and, when a stage opts in, in Cognito's email configuration."
  value       = aws_sesv2_email_identity.domain.arn
}

output "identity_arns" {
  description = <<-EOT
    Every identity a send has to be authorised against: the sending domain, and
    each verified recipient.

    The recipients belong here and it is not obvious why. SES evaluates the
    recipient identity as a resource on SendEmail when that address is itself a
    verified identity in the account - which, in the sandbox, every recipient is.
    A policy naming only the sender fails with an AccessDeniedException that
    names the recipient, which reads like the wrong thing entirely.
  EOT
  value = concat(
    [aws_sesv2_email_identity.domain.arn],
    [for identity in aws_sesv2_email_identity.recipient : identity.arn],
  )
}

output "from_address" {
  description = "The address parents see. Built from the verified domain rather than typed into a tfvars file, so it cannot drift from the identity that authorises it."
  value       = "${var.from_local_part}@${var.domain_name}"
}

output "configuration_set_arn" {
  description = "Needed in the send policy: IAM evaluates the configuration set as a second resource on the same SendEmail call."
  value       = aws_sesv2_configuration_set.this.arn
}

output "configuration_set_name" {
  description = "Attached to the identity, so senders never name it and need no third environment variable."
  value       = aws_sesv2_configuration_set.this.configuration_set_name
}

output "dkim_tokens" {
  description = "The three DKIM tokens, for checking the records resolved before the first demo booking."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "verified_for_sending" {
  description = "Whether SES considers the domain verified. False right after an apply - DKIM propagation takes minutes, and a send before it finishes is retried three times and then dropped."
  value       = aws_sesv2_email_identity.domain.verified_for_sending_status
}
