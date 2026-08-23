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
  description = "Needed by a later stage to attach a stream to the table."
  value       = aws_dynamodb_table.school.arn
}

output "function_names" {
  description = "Deployed function name per route, for reading logs without guessing."
  value       = local.function_names
}
