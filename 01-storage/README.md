# Episode 01: Storage

> **This is one episode's snapshot, not the finished project.** It deploys the
> full stack up to and including this stage. For the complete system, use
> [`06-cost/`](../06-cost/). Only one stage may be applied at a time — they
> collide on globally-unique names.

## What this episode adds

Two private S3 buckets behind one CloudFront distribution:

- **Site bucket** — the static front end. Small, read constantly.
- **Media bucket** — ~40GB of photos and event video, growing ~15GB/year, and
  almost never read after the first month.

Both are fully private. CloudFront reaches them through Origin Access Control,
and the bucket policies trust nothing except this distribution.

Media served under `/media/*` routes to the media bucket; everything else goes
to the site bucket.

## Decisions

| Decision | Why | Rejected |
| --- | --- | --- |
| CloudFront + OAC | Buckets stay private; CloudFront signs origin requests with SigV4 | Public bucket, or the legacy Origin Access Identity |
| Glacier **IR**, not Glacier Flexible | Flexible needs a restore job before a read. A parent clicking last year's concert photo would get nothing for hours | Glacier Flexible / Deep Archive |
| Versioning on both buckets | Recovery without anyone managing backups — nobody here runs a backup job | Manual backups, or no recovery story |
| Noncurrent versions expire at 90d | Versioning is the backup, but keeping every version forever is a silent cost leak | Keep all versions |
| `PriceClass_100` | The audience is one school in Canada. Paying for edge locations in Asia serves nobody | `PriceClass_All` |
| No access logging | A second bucket accruing charges to answer questions nobody at this school will ask | CloudFront standard logs |
| Local state | Remote state coordinates a team. There is no team. It also makes the per-stage state separation automatic | S3 backend + DynamoDB lock table |
| `BucketOwnerEnforced` (ACLs off) | Access decided by bucket policy alone — one place to reason about, not two | Default ACL behaviour |
| `force_destroy = true` | Six apply/destroy cycles. With versioning on, emptying a bucket by hand means purging every version *and* delete marker — `aws s3 rm --recursive` only writes markers and leaves the bucket undeletable | Manual teardown before every destroy |
| Front end published by `terraform apply` | One command produces a working site. `local-exec`, because `fileset()` is evaluated at plan time and a clean checkout with no `dist/` would plan zero objects and upload nothing | `aws_s3_object` per file; a separate manual deploy step |

## Cost change from previous

First episode, so this is the baseline. Effectively **$0/month at rest** for an
empty stack: S3 charges for what is stored, CloudFront's free tier covers a
school's traffic, and no compute exists yet. The lifecycle rules do not save
anything until objects age past 30 days — that demo needs real data and time.

## Not here yet

- No custom domain. The site answers on `*.cloudfront.net` using the default
  CloudFront certificate. A school domain means an ACM certificate in
  `us-east-1` (a hard CloudFront requirement) plus Route53 records.
- No site content. The front end is a prop and gets generated later.
- Presigned uploads need Lambda, which arrives with the API in a later episode.
  The media bucket's CORS rule is already in place for them.

## Apply / destroy

Only one stage may be applied at a time — every stage creates the same
globally-unique bucket names and will collide.

```
cd 01-storage
cp terraform.tfvars.example terraform.tfvars   # optional; defaults are fine
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply

terraform destroy
../scripts/check-destroyed.sh
```

Buckets are versioned with `force_destroy = true`, so `terraform destroy`
purges every object version and delete marker for you. That suits a repo whose
whole workflow is apply, verify, destroy — but it is the wrong default for real
data, and `force_destroy = false` is a supported variable.

`check-destroyed.sh` is the confirmation step: it sweeps the account by name and
exits non-zero if a bucket or distribution is still standing, because a destroy
that failed part way says so in output that scrolls past.

## Video

_Link once published._
