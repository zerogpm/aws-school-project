---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
---

# Terraform

Each `0X-*` directory is its own Terraform root with its own state. Run
`terraform` from inside the stage directory, not the repo root. Run
`terraform fmt` before finishing.

Shared infrastructure belongs in `modules/`, consumed by the stage roots — do
not copy resource blocks between stages.

**Env vars (blocker):** every Lambda handler env var must be declared in the
Terraform that creates the function AND asserted in a test. A handler reading a
var that no `.tf` file sets is a defect even if the code looks correct.

**Secrets:** never in committed `.tf` files. Use `terraform.tfvars` (gitignored)
or Parameter Store.
