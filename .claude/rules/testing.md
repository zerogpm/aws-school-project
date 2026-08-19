# Testing

All changes require both unit tests AND e2e tests. Run the full suite after
changes and confirm it passes before reporting completion. Show actual test
output as proof — never "this should work".

**Current state:** no test runner is configured in this repo yet. Until one
exists, the bar for a Terraform change is `terraform validate` plus a
`terraform plan` that has actually been read. When the first real code lands,
set up the test tooling in the same change rather than deferring it.
