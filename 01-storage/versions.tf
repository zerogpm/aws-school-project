terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # No backend block: state is local, one file per stage folder.
  # Remote state exists so a team does not clobber each other. There is no
  # team. Local state also makes the "separate backend key per stage" rule
  # automatic - the stages physically cannot share a state file.
  # *.tfstate is gitignored.
}

provider "aws" {
  region = var.aws_region

  # Every resource carries these. Cost Explorer can then filter this project
  # out of an account that also runs unrelated workloads.
  default_tags {
    tags = {
      Project   = var.project_name
      Stage     = "01-storage"
      ManagedBy = "terraform"
    }
  }
}
