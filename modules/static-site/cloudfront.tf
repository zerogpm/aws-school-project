# Managed policies rather than hand-rolled ones: AWS keeps them current, and
# there is nothing school-specific about caching a static asset.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

# Origin Access Control replaces the old Origin Access Identity. Both buckets
# stay fully private; CloudFront signs each origin request with SigV4 and the
# bucket policy trusts nothing except this distribution.
resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name_prefix}-oac"
  description                       = "SigV4 access from CloudFront to the site and media buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "${var.name_prefix} site and media"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  # The names this distribution will answer to. Empty without a custom domain,
  # which leaves it reachable only at its own *.cloudfront.net name.
  aliases = local.custom_domain ? [var.domain_name] : []

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  origin {
    origin_id                = "media"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  # Media is immutable once uploaded and rarely read, but when it is read it
  # should come from the edge - pulling a 200MB concert video out of Glacier IR
  # in ca-central-1 on every view is the expensive path.
  ordered_cache_behavior {
    path_pattern               = "/media/*"
    target_origin_id           = "media"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  # SPA fallback. React Router owns the URL space, so /timetable is not an
  # object in S3 - it is a route the JS bundle resolves once index.html loads.
  # Without this, a deep link or a refresh hits S3, finds no such key, and dies.
  #
  # S3 returns 403 rather than 404 for a missing key, because the bucket policy
  # grants GetObject but not ListBucket - it cannot say whether a key exists
  # without also allowing enumeration. Both have to be mapped.
  #
  # The 200 matters: returning index.html under a 404 would render the app but
  # tell crawlers every route is broken.
  #
  # error_caching_min_ttl = 0 so a newly deployed asset is not masked by a
  # cached error from before it existed.
  #
  # Trade-off, stated because custom error responses are distribution-wide: a
  # genuinely missing asset under /media/* also returns index.html rather than a
  # real 404. Fixing that needs a CloudFront Function, which is not worth it
  # here - React Router renders its own 404 for unknown routes.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Two mutually exclusive shapes in one block: the free *.cloudfront.net
  # certificate, or the ACM one. A null argument is omitted entirely, which is
  # what lets a single block cover both - CloudFront rejects a request that
  # sets the default certificate flag and an ACM ARN together.
  #
  # The ARN comes from the validation resource rather than the certificate, so
  # the distribution cannot be updated until ACM has actually issued it.
  viewer_certificate {
    cloudfront_default_certificate = local.custom_domain ? null : true

    acm_certificate_arn = local.custom_domain ? aws_acm_certificate_validation.this[0].certificate_arn : null
    ssl_support_method  = local.custom_domain ? "sni-only" : null

    # Only applies with a custom certificate. sni-only plus TLS 1.2 is the
    # cheap combination: a dedicated IP costs $600/month.
    minimum_protocol_version = local.custom_domain ? "TLSv1.2_2021" : null
  }

  # No access logging. It is a second bucket accumulating charges to answer
  # questions nobody at this school is going to ask.
}

# ---------------------------------------------------------------------------
# Bucket policies - the only principal allowed in is this distribution.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

data "aws_iam_policy_document" "media" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media.json

  depends_on = [aws_s3_bucket_public_access_block.media]
}
