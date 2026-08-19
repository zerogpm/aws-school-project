# Module: static-site

Private S3 storage for a static site and its media, fronted by a single
CloudFront distribution using Origin Access Control.

## Creates

- Site bucket and media bucket — versioned, SSE-S3 encrypted, all public access
  blocked, `BucketOwnerEnforced` ownership
- Media lifecycle: Standard → Standard-IA at 30d → Glacier IR at 90d
- Noncurrent version expiry and incomplete-multipart cleanup on both buckets
- CORS on the media bucket for direct browser uploads via presigned URLs
- CloudFront distribution with two origins and an OAC, `/media/*` routed to the
  media bucket
- Bucket policies granting `s3:GetObject` only to this distribution's ARN

## Inputs

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `name_prefix` | string | — | Prefix for resource names |
| `bucket_suffix` | string | — | Makes bucket names globally unique; the account ID works and is stable across destroy/apply |
| `media_ia_transition_days` | number | `30` | Days before media moves to Standard-IA |
| `media_glacier_ir_transition_days` | number | `90` | Days before media moves to Glacier IR |
| `noncurrent_version_expiration_days` | number | `90` | Days before old versions are purged |
| `cloudfront_price_class` | string | `PriceClass_100` | North America + Europe only |

`media_glacier_ir_transition_days` is validated to be at least 30 days after the
Standard-IA transition, because S3 rejects a shorter gap at apply time rather
than at plan time.

## Outputs

`site_bucket_name`, `site_bucket_arn`, `media_bucket_name`, `media_bucket_arn`,
`cloudfront_domain_name`, `cloudfront_distribution_id`

## Notes

- No custom domain. Attaching one requires an ACM certificate in `us-east-1`,
  which is a CloudFront requirement, not a regional choice — the data itself
  stays in `ca-central-1`.
- Objects smaller than 128KB are not transitioned between storage classes. This
  is an S3 default and is fine for photos and video.
