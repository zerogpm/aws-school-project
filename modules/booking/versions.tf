terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    # Zips the esbuild output. Pinned like everything else so an old episode
    # still plans years from now.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}
