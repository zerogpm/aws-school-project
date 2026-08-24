output "api_url" {
  description = "Base URL of the HTTP API. The front end calls this."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_id" {
  description = "API identifier, for the AWS CLI and for reading logs."
  value       = aws_apigatewayv2_api.this.id
}

output "table_name" {
  description = "The single table. Every handler that reads it receives this as TABLE_NAME."
  value       = aws_dynamodb_table.school.name
}

output "table_arn" {
  description = "The table itself. Handler IAM policies are scoped to this and its indexes."
  value       = aws_dynamodb_table.school.arn
}

output "table_stream_arn" {
  description = "Stream the booking-email consumer reads. Empty when stream_enabled is false."
  value       = aws_dynamodb_table.school.stream_arn
}

output "function_names" {
  description = "Deployed function name per route, for reading logs without guessing."
  value       = local.function_names
}

output "consumer_function_names" {
  description = "Deployed function name per stream consumer. Empty until a stage wires SES."
  value       = local.consumer_function_names
}
