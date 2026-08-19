output "site_bucket_name" {
  description = "Static site bucket. Deploy the front end here."
  value       = module.static_site.site_bucket_name
}

output "media_bucket_name" {
  description = "Media bucket. Presigned uploads target this."
  value       = module.static_site.media_bucket_name
}

output "site_url" {
  description = "Public URL until a custom domain is attached."
  value       = "https://${module.static_site.cloudfront_domain_name}"
}

output "cloudfront_distribution_id" {
  description = "Needed for cache invalidation after a deploy."
  value       = module.static_site.cloudfront_distribution_id
}
