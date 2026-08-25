# ---------------------------------------------------------------------------
# One demo staff account, created after the pool exists.
#
# Accounts are deliberately NOT `aws_cognito_user` resources: `password` and
# `temporary_password` are both sensitive, which in Terraform means plaintext in
# state; `terraform destroy` would delete every account in a workflow built on
# apply/verify/destroy; and sixty real teachers' addresses do not belong in a
# public repo. That decision stands - see MISTAKES.md under 02.
#
# What was missing was only the tedium: every apply produced an empty pool, so
# signing in to the admin page meant creating a user in the console first. This
# runs the same script a human would, with the same arguments, and nothing about
# the account reaches state.
#
# Off unless demo_staff_email is set, so a real deployment gets no demo login.
# ---------------------------------------------------------------------------

resource "terraform_data" "demo_staff" {
  count = var.demo_staff_email != "" ? 1 : 0

  # The email and the pool. Recreating the pool changes its id, which recreates
  # this and puts the account back - the exact case that made this necessary.
  #
  # The password is deliberately absent: triggers are persisted to state, and
  # putting it here would reintroduce the plaintext-in-state problem that keeps
  # accounts out of Terraform in the first place. It reaches the script through
  # the provisioner environment, which is not stored.
  triggers_replace = {
    email   = var.demo_staff_email
    pool_id = module.auth.user_pool_id
  }

  provisioner "local-exec" {
    interpreter = [local.bash_bin, "-c"]
    command     = "${path.module}/../scripts/create-staff.sh '${var.demo_staff_email}' office"

    environment = {
      # Passed in rather than looked up. A provisioner running inside an apply
      # of this stage cannot read its own `terraform output` - the state is
      # locked. See MISTAKES.md under 02.
      USER_POOL_ID = module.auth.user_pool_id
      AWS_REGION   = var.aws_region

      # Empty means Cognito emails a temporary password and the sign-in form
      # forces a change. Set it in terraform.tfvars for a demo account whose
      # password you already know.
      STAFF_PASSWORD = var.demo_staff_password
    }
  }
}
