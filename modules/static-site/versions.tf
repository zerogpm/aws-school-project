terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"

      # CloudFront only accepts an ACM certificate from us-east-1. That is a
      # CloudFront requirement, not a regional choice - the buckets, the data
      # and every other resource stay in ca-central-1. The caller has to pass
      # this alias in even when no custom domain is configured, because a
      # module cannot declare a provider conditionally.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
