#!/usr/bin/env bash
# Confirm a stage really is gone.
#
#   ./scripts/check-destroyed.sh [project_name]      default: school
#
# terraform destroy reports success per resource, but a partial failure - a
# CloudFront deletion that timed out, a bucket that would not empty - scrolls
# past in a wall of output, and nothing in this repo is free to leave running.
#
# Read-only. It never deletes anything; that stays a decision you make.
# Exits non-zero if anything was found, so it can gate a "safe to move on".
set -euo pipefail

PROJECT="${1:-school}"
REGION="${AWS_REGION:-ca-central-1}"
found=0

note() { printf '  %s\n' "$1"; found=1; }

echo "==> sweeping for '$PROJECT' in $REGION"

# ---------------------------------------------------------------------------
# By tag. Every stage sets default_tags { Project = <name> }, so this finds
# anything tagged without the script needing to know the resource type - which
# is what keeps it honest as later stages add Lambda, DynamoDB and API Gateway.
#
# One region, the project's own. Nothing here is ever created anywhere else -
# data residency is the whole reason var.aws_region validates for ca-*.
# ---------------------------------------------------------------------------
echo "Tagged Project=$PROJECT"
# A failed call is reported, never swallowed. Treating an error as "nothing
# found" would turn the whole script into a green light that means nothing,
# which is the one outcome worse than not checking at all.
if ! arns="$(aws resourcegroupstaggingapi get-resources \
    --tag-filters "Key=Project,Values=$PROJECT" \
    --region "$REGION" \
    --query 'ResourceTagMappingList[].ResourceARN' \
    --output text 2>&1)"; then
  printf '  !! could not query %s: %s\n' "$REGION" "$arns"
  found=1
elif [ -n "$arns" ]; then
  for arn in $arns; do note "$arn"; done
else
  echo "  none"
fi

# ---------------------------------------------------------------------------
# CloudFront, which the tag sweep above does not reach.
#
# It is a global service: its resources are not in any region, so a regional
# get-resources call cannot see them. The CloudFront API is global too, which
# is the useful half - these calls work from ca-central-1 and never name
# another region.
#
# Distributions are checked by comment rather than tag because the point here
# is a distribution that outlived its stage, and a half-deleted one is exactly
# where tags are least trustworthy. Enabled is printed because a disabled
# distribution still exists, and still has to be deleted, which is the state a
# timed-out destroy leaves behind.
# ---------------------------------------------------------------------------
echo "CloudFront distributions"
if ! dists="$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?contains(Comment, '${PROJECT}')].[Id,Enabled,Comment]" \
    --output text 2>&1)"; then
  printf '  !! could not list distributions: %s\n' "$dists"
  found=1
elif [ -n "$dists" ] && [ "$dists" != "None" ]; then
  while read -r id enabled comment; do
    [ -n "$id" ] && note "$id enabled=$enabled ($comment)"
  done <<< "$dists"
else
  echo "  none"
fi

# An origin access control takes no tags at all - the resource has no tags
# argument, so default_tags never lands on it and no tag sweep can see it.
# It is also a top-level account resource rather than a child of the
# distribution, so a destroy that dies between the two leaves it behind. Free,
# but it counts against a quota and accumulates unnoticed.
echo "Origin access controls (untaggable, checked by name)"
if ! oacs="$(aws cloudfront list-origin-access-controls \
    --query "OriginAccessControlList.Items[?starts_with(Name, '${PROJECT}-')].[Id,Name]" \
    --output text 2>&1)"; then
  printf '  !! could not list origin access controls: %s\n' "$oacs"
  found=1
elif [ -n "$oacs" ] && [ "$oacs" != "None" ]; then
  while read -r id name; do
    [ -n "$id" ] && note "$name ($id)"
  done <<< "$oacs"
else
  echo "  none"
fi

# Buckets are listed by name too, not because tags miss them, but because the
# object-version count is the number that decides whether a leftover is costing
# anything. An empty bucket is free; 40GB of Glacier IR video is not.
echo "S3 buckets (with object versions)"
if ! buckets="$(aws s3api list-buckets \
    --query "Buckets[?starts_with(Name, '${PROJECT}-')].Name" \
    --output text 2>&1)"; then
  printf '  !! could not list buckets: %s\n' "$buckets"
  found=1
elif [ -n "$buckets" ]; then
  for b in $buckets; do
    n="$(aws s3api list-object-versions --bucket "$b" \
      --query 'length(Versions[])' --output text 2>/dev/null || echo '?')"
    note "$b (object versions: $n)"
  done
else
  echo "  none"
fi

# ---------------------------------------------------------------------------
# The same tag sweep again, in us-east-1.
#
# 06 is the first stage to put anything there, and it had no choice: Route53
# publishes HealthCheckStatus into AWS/Route53 in us-east-1 and nowhere else, so
# the alarm lives there and its SNS topic has to live beside it. Global services
# register their tags in us-east-1 as well, which is why README.md has always
# described teardown as a two-region check while this script did only one.
# ---------------------------------------------------------------------------
echo "Tagged Project=$PROJECT in us-east-1"
if ! use1="$(aws resourcegroupstaggingapi get-resources \
    --tag-filters "Key=Project,Values=$PROJECT" \
    --region us-east-1 \
    --query 'ResourceTagMappingList[].ResourceARN' \
    --output text 2>&1)"; then
  printf '  !! could not query us-east-1: %s\n' "$use1"
  found=1
elif [ -n "$use1" ]; then
  for arn in $use1; do note "$arn"; done
else
  echo "  none"
fi

# A budget takes no tags at all - the resource has no tags argument, so
# default_tags never reaches it and neither sweep above can see one. It is also
# account-scoped rather than regional, so a destroy that dies early leaves a
# budget quietly mailing about an account that no longer runs anything.
echo "Budgets (untaggable, checked by name)"
if ! account="$(aws sts get-caller-identity --query Account --output text 2>&1)"; then
  printf '  !! could not resolve account id: %s\n' "$account"
  found=1
elif ! budgets="$(aws budgets describe-budgets --account-id "$account" \
    --query "Budgets[?starts_with(BudgetName, '${PROJECT}-')].BudgetName" \
    --output text 2>&1)"; then
  # An account with no budgets answers NotFoundException rather than an empty
  # list, and that is the clean case here, not a failure.
  if printf '%s' "$budgets" | grep -qi 'NotFound'; then
    echo "  none"
  else
    printf '  !! could not list budgets: %s\n' "$budgets"
    found=1
  fi
elif [ -n "$budgets" ] && [ "$budgets" != "None" ]; then
  for b in $budgets; do note "budget $b"; done
else
  echo "  none"
fi

# Health checks are global, so no regional sweep reaches them, and the API gives
# them no name - only the tag does, and get-resources does not return them.
#
# So this lists every health check in the account and lets you read the endpoint.
# In an account that runs only this project that is exactly right; in a shared
# one it will name checks that were never ours, which is the safer way round for
# a script whose whole job is "did something survive".
echo "Route53 health checks (global, unnamed in the API)"
if ! checks="$(aws route53 list-health-checks \
    --query 'HealthChecks[].[Id,HealthCheckConfig.FullyQualifiedDomainName]' \
    --output text 2>&1)"; then
  printf '  !! could not list health checks: %s\n' "$checks"
  found=1
elif [ -n "$checks" ] && [ "$checks" != "None" ]; then
  while read -r id fqdn; do
    [ -n "$id" ] && note "health check $id ($fqdn)"
  done <<< "$checks"
else
  echo "  none"
fi

echo
if [ "$found" -eq 0 ]; then
  echo "==> clean - nothing left running"
else
  echo "==> LEFTOVERS ABOVE. Re-run terraform destroy in the stage that owns them."
  exit 1
fi
