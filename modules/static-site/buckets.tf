locals {
  site_bucket_name  = "${var.name_prefix}-site-${var.bucket_suffix}"
  media_bucket_name = "${var.name_prefix}-media-${var.bucket_suffix}"
}

# ---------------------------------------------------------------------------
# Site bucket - the static front end. Small, cheap, read constantly.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "site" {
  bucket        = local.site_bucket_name
  force_destroy = var.force_destroy
}

# Versioning is the entire backup story. Nobody here is going to manage
# snapshots, so the bucket keeps its own history.
resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# ACLs off. Every object is owned by the bucket, so access is decided by the
# bucket policy alone - one place to reason about instead of two.
resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.site]
}

# ---------------------------------------------------------------------------
# Media bucket - ~40GB of photos and event video, growing ~15GB/year, and
# almost never read after the first month. This is where the lifecycle rules
# actually earn their keep.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = local.media_bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "archive-cold-media"
    status = "Enabled"

    filter {}

    transition {
      days          = var.media_ia_transition_days
      storage_class = "STANDARD_IA"
    }

    # Glacier IR, not Glacier Flexible. Flexible is cheaper per GB but needs a
    # restore job before anything can be read, which would mean a parent
    # clicking a photo from last year's concert and getting nothing for hours.
    # Instant Retrieval reads immediately and still serves through CloudFront.
    transition {
      days          = var.media_glacier_ir_transition_days
      storage_class = "GLACIER_IR"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.media]
}

# Parents upload straight to this bucket with a presigned URL, so the browser
# origin has to be allowed to PUT. Uploads never pass through Lambda.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST", "GET", "HEAD"]
    allowed_origins = ["https://${aws_cloudfront_distribution.this.domain_name}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
