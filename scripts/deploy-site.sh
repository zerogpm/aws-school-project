#!/usr/bin/env bash
# Build the Vite SPA and publish it to the stage's S3 bucket.
#
#   ./scripts/deploy-site.sh [stage]        default: 01-storage
#
# Also called by terraform apply via a local-exec provisioner, which passes
# SITE_BUCKET and DISTRIBUTION_ID directly - Terraform cannot shell out to
# `terraform output` in the middle of its own apply.
set -euo pipefail

STAGE="${1:-01-storage}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BUCKET="${SITE_BUCKET:-$(terraform -chdir="$ROOT/$STAGE" output -raw site_bucket_name)}"
DIST="${DISTRIBUTION_ID:-$(terraform -chdir="$ROOT/$STAGE" output -raw cloudfront_distribution_id)}"

echo "==> building"
(cd "$ROOT/site" && npm run build)

# Filenames under assets/ carry a content hash, so a changed file is a changed
# URL. They can be cached forever.
echo "==> uploading immutable assets"
aws s3 sync "$ROOT/site/dist/assets" "s3://$BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable" \
  --delete

# index.html is the entry point for every route and has a stable URL, so it must
# revalidate or a deploy is invisible to anyone with a warm cache.
echo "==> uploading html"
aws s3 sync "$ROOT/site/dist" "s3://$BUCKET" \
  --exclude "assets/*" \
  --cache-control "public,max-age=0,must-revalidate" \
  --delete

echo "==> invalidating cache"
aws cloudfront create-invalidation \
  --distribution-id "$DIST" \
  --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "==> done: https://$(aws cloudfront get-distribution --id "$DIST" --query 'Distribution.DomainName' --output text)"
