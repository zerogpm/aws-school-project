# ---------------------------------------------------------------------------
# Publish the front end as part of the apply.
#
# Terraform is a poor fit for file content: fileset() is evaluated at plan time,
# so a clean checkout with no site/dist yet would plan zero objects and silently
# upload nothing. Shelling out to the deploy script sidesteps that, at the cost
# of terraform plan being unable to show what will change inside it.
#
# Set deploy_site = false if you only want the infrastructure, or do not have
# node and the AWS CLI on the machine running Terraform.
# ---------------------------------------------------------------------------

locals {
  site_dir = "${path.module}/../site"

  # Any change under src/, or to the build inputs, means a rebuild and reupload.
  site_hash = sha256(join("", concat(
    [for f in fileset("${local.site_dir}/src", "**") : filesha256("${local.site_dir}/src/${f}")],
    [
      filesha256("${local.site_dir}/index.html"),
      filesha256("${local.site_dir}/package.json"),
      filesha256("${local.site_dir}/vite.config.ts"),
    ]
  )))
}

resource "terraform_data" "site_content" {
  count = var.deploy_site ? 1 : 0

  triggers_replace = {
    site_hash = local.site_hash
    bucket    = module.static_site.site_bucket_name
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = "${path.module}/../scripts/deploy-site.sh"

    environment = {
      SITE_BUCKET     = module.static_site.site_bucket_name
      DISTRIBUTION_ID = module.static_site.cloudfront_distribution_id
    }
  }
}
