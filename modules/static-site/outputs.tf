output "site_bucket_name" {
  description = "Static site bucket. Deploy the front end here."
  value       = aws_s3_bucket.site.id
}

output "site_bucket_arn" {
  value = aws_s3_bucket.site.arn
}

output "media_bucket_name" {
  description = "Media bucket. Presigned uploads target this."
  value       = aws_s3_bucket.media.id
}

output "media_bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "cloudfront_domain_name" {
  description = "Public URL of the site until a custom domain is attached."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_distribution_id" {
  description = "Needed for cache invalidation after a deploy."
  value       = aws_cloudfront_distribution.this.id
}
