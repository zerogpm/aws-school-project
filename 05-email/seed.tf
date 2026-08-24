# ---------------------------------------------------------------------------
# Demo data, written after the table exists.
#
# Same shape and same reasoning as staff.tf. Students and windows are
# deliberately NOT Terraform resources: they are data with a lifecycle of their
# own - a new intake every September - and rows in a state file would mean
# `terraform destroy` deleted the school roll along with the infrastructure.
# That decision stands.
#
# What was missing was only the tedium. `terraform destroy` deletes the table
# itself, so every apply produced an empty one, and every demo began with a
# booking page that correctly said "Booking for this evening is not open yet"
# and a run to scripts/seed-stage.sh. In a workflow built on apply / verify /
# destroy, that is once per recording.
#
# This runs the same script a human would, with the same arguments, and nothing
# about the data reaches state. Writes are attribute_not_exists guarded, so a
# re-run against a surviving table changes nothing.
#
# Set seed_demo_data = false for a real deployment, which wants a real roll
# loaded by the office rather than four fictional students.
# ---------------------------------------------------------------------------

resource "terraform_data" "demo_data" {
  count = var.seed_demo_data ? 1 : 0

  # The table. Recreating it changes the name only if the prefix changed, so
  # this also tracks the table's identity - a destroy and re-apply produces a
  # new table and re-runs the seed, which is the case that made this necessary.
  triggers_replace = {
    table = module.booking.table_name
  }

  provisioner "local-exec" {
    interpreter = [local.bash_bin, "-c"]
    command     = "cd '${path.module}/../backend' && npm run --silent seed:aws -- --table \"$TABLE_NAME\" --region \"$AWS_REGION\""

    environment = {
      # Passed in rather than looked up. A provisioner running inside an apply
      # of this stage cannot read its own `terraform output` - the state is
      # locked. Same constraint staff.tf hit in 02.
      TABLE_NAME = module.booking.table_name
      AWS_REGION = var.aws_region
    }
  }
}
