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
  description = "The distribution's own name. Still reachable when a custom domain is attached - CloudFront does not stop answering to it."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "site_url" {
  description = "Canonical URL of the site. The custom domain when there is one, the distribution name otherwise. Callers should build redirect and callback URLs from this rather than from cloudfront_domain_name, which changes whenever the distribution is recreated."
  value       = local.custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "site_origins" {
  description = "Every origin the browser may load the site from. Both names when a custom domain is attached, because the distribution answers to both."
  value = local.custom_domain ? [
    "https://${var.domain_name}",
    "https://${aws_cloudfront_distribution.this.domain_name}",
  ] : ["https://${aws_cloudfront_distribution.this.domain_name}"]
}

output "cloudfront_distribution_id" {
  description = "Needed for cache invalidation after a deploy."
  value       = aws_cloudfront_distribution.this.id
}
