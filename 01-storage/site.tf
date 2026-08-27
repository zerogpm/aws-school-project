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
  # Which bash to hand local-exec.
  #
  # On Windows, `bash` on PATH is almost always C:\Windows\system32\bash.exe -
  # the WSL launcher - because System32 precedes Git's directories in PATH, and
  # Git for Windows puts bash.exe in Git\bin which is not on PATH at all. With
  # no WSL distro installed that fails with "execvpe(/bin/bash) failed", after
  # every other resource in the stage has already been created.
  #
  # Terraform resolves the interpreter itself rather than through a shell, so
  # which terminal ran `terraform apply` does not reliably decide this. Naming
  # the binary when it exists removes the guesswork.
  #
  # fileexists is false on Linux and macOS, where plain `bash` is correct.
  git_bash = "C:/Program Files/Git/bin/bash.exe"
  bash_bin = fileexists(local.git_bash) ? local.git_bash : "bash"

  # The script is handed to bash as an argument rather than run directly. A
  # checkout made on Windows has no exec bit on scripts/*.sh - Git for Windows
  # cannot record one - so executing it on macOS or Linux fails with exit 126,
  # after every other resource in the stage has already been created.

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
    interpreter = [local.bash_bin, "-c"]
    command     = "'${local.bash_bin}' '${path.module}/../scripts/deploy-site.sh'"

    environment = {
      SITE_BUCKET     = module.static_site.site_bucket_name
      DISTRIBUTION_ID = module.static_site.cloudfront_distribution_id
    }
  }
}
