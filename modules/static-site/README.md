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
| `media_ia_transition_days` | number | `30` | Days before cold media moves to Standard-IA |
| `media_glacier_ir_transition_days` | number | `90` | Days before cold media moves to Glacier IR |
| `noncurrent_version_expiration_days` | number | `90` | Days before old versions are purged |
| `cloudfront_price_class` | string | `PriceClass_100` | North America + Europe only |
| `domain_name` | string | `""` | Custom domain, e.g. `school.chrissu.online`. Empty creates no Route53 or ACM resources |
| `hosted_zone_name` | string | `""` | Zone that owns `domain_name`, e.g. `chrissu.online`. Required when `domain_name` is set |

`media_glacier_ir_transition_days` is validated to be at least 30 days after the
Standard-IA transition, because S3 rejects a shorter gap at apply time rather
than at plan time.

## Media bucket layout

The lifecycle transitions are scoped by prefix, so where an object is uploaded
decides what it costs:

| Prefix | Storage | Why |
| --- | --- | --- |
| `photos/`, `video/` | Standard → IA → Glacier IR | Bulk of the bytes, cold after a month |
| `docs/` | Standard, no transitions | School PDFs — small, and read all year |

Anything uploaded outside a cold prefix stays in Standard. That is the safe
direction to fail: a mis-filed video costs a little more, where a mis-filed
permission form would earn a Glacier IR retrieval fee and a 90-day minimum
charge every time it was revised.

## Outputs

`site_bucket_name`, `site_bucket_arn`, `media_bucket_name`, `media_bucket_arn`,
`cloudfront_domain_name`, `cloudfront_distribution_id`, `site_url`, `site_origins`

## Notes

- A custom domain is optional. Set `domain_name` and `hosted_zone_name` and the
  module requests an ACM certificate, publishes its DNS validation records,
  waits for issuance, attaches it to the distribution and points an alias record
  at it. Leave them empty and none of that exists — the distribution keeps its
  `*.cloudfront.net` name and default certificate.
- The certificate is created in `us-east-1`, which is a CloudFront requirement
  rather than a regional choice: CloudFront reads certificates from that region
  and nowhere else. Every bucket, record and byte of data stays in
  `ca-central-1`. The caller must pass an `aws.us_east_1` provider alias even
  with no custom domain configured, because a module cannot take a provider
  conditionally.
- Prefer a subdomain of a zone you already own. A new hosted zone is
  $0.50/month; a subdomain of an existing one is free.
- Build redirect and callback URLs from the `site_url` and `site_origins`
  outputs, never from `cloudfront_domain_name` — that name changes every time
  the distribution is recreated, and a distribution with a custom domain still
  answers to both names.
- Objects smaller than 128KB are not transitioned between storage classes. This
  is an S3 default and is fine for photos and video.
