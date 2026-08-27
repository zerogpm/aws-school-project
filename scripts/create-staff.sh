#!/usr/bin/env bash
# Create a staff account in the Cognito pool, and optionally put it in a group.
#
#   ./scripts/create-staff.sh <email> [group] [stage]
#   ./scripts/create-staff.sh teacher@maplewood.example office
#   ./scripts/create-staff.sh --dry-run teacher@maplewood.example teacher
#
# Set STAFF_PASSWORD to give the account a known password and skip the emailed
# one entirely. Demo accounts only - see the note by the call itself.
#   STAFF_PASSWORD='...' ./scripts/create-staff.sh principal@maplewood.example office
#
# Cognito emails a temporary password; the hosted UI forces a new one on first
# sign-in. There is no self-registration - the pool sets
# allow_admin_create_user_only, so this is the only way an account appears.
#
# Accounts are deliberately NOT in Terraform. See the note at the bottom.
set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

EMAIL="${1:-}"
GROUP="${2:-}"
STAGE="${3:-02-auth}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "$EMAIL" ]; then
  echo "usage: $0 [--dry-run] <email> [group] [stage]" >&2
  exit 2
fi

# Username is the email, because the pool sets username_attributes = ["email"].
# A malformed address is accepted by admin-create-user and then fails silently
# at delivery, so it is worth rejecting here.
if ! printf '%s' "$EMAIL" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  echo "error: '$EMAIL' does not look like an email address" >&2
  exit 2
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  would run: %s\n' "$*"
  else
    "$@"
  fi
}

# USER_POOL_ID wins over the stage output, because a local-exec provisioner
# running *inside* an apply of that same stage cannot read its own output - the
# state is locked, and `terraform output` either blocks or fails. The stage
# passes the id through the environment instead; a human running this by hand
# passes nothing and gets the lookup.
POOL="${USER_POOL_ID:-}"
if [ -z "$POOL" ]; then
  POOL="$(terraform -chdir="$ROOT/$STAGE" output -raw user_pool_id 2>/dev/null || true)"
fi
if [ -z "$POOL" ]; then
  echo "error: no user_pool_id output in $STAGE - is the stage applied?" >&2
  exit 1
fi
echo "==> pool $POOL"

# A group that does not exist is accepted by the API only to fail later, and
# the error names the group without saying it is unknown. Catch the typo here.
#
# --output text separates a list with TABS, so the space-padded pattern below
# matched nothing in a pool with more than one group: it rejected 'office'
# while printing 'office' among the available ones. Normalise first.
if [ -n "$GROUP" ]; then
  groups="$(aws cognito-idp list-groups --user-pool-id "$POOL" \
    --query 'Groups[].GroupName' --output text 2>/dev/null \
    | tr -s '[:space:]' ' ' || true)"
  case " $groups " in
    *" $GROUP "*) : ;;
    *)
      echo "error: no group '$GROUP' in this pool. Available: ${groups:-none}" >&2
      exit 1
      ;;
  esac
fi

# Idempotent: re-running for an existing account should add the group rather
# than fail, which is what happens when someone changes role.
if aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$EMAIL" >/dev/null 2>&1; then
  echo "==> $EMAIL already exists, not recreating"
else
  echo "==> creating $EMAIL"
  # email_verified is set here on purpose. Without it Cognito treats the
  # address as unconfirmed and adds a verification step on top of the forced
  # password change, for an address the office just typed in deliberately.
  run aws cognito-idp admin-create-user \
    --user-pool-id "$POOL" \
    --username "$EMAIL" \
    --user-attributes "Name=email,Value=$EMAIL" "Name=email_verified,Value=true" \
    --desired-delivery-mediums EMAIL \
    --output text --query 'User.UserStatus'
fi

if [ -n "$GROUP" ]; then
  echo "==> adding to group $GROUP"
  run aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$POOL" \
    --username "$EMAIL" \
    --group-name "$GROUP"
fi

# Optional: set a known password instead of waiting for the emailed one.
#
# Read from the environment rather than an argument, so it stays out of shell
# history and out of `ps` output on a shared machine.
#
# --permanent also clears FORCE_CHANGE_PASSWORD, so the account can sign in
# immediately. That is the point for a demo account, and exactly what makes it
# wrong for a real one: a real staff member should set a password nobody else
# has ever seen.
#
# This never touches Terraform state, which is the whole reason it lives here
# and not in an aws_cognito_user resource with temporary_password set.
if [ -n "${STAFF_PASSWORD:-}" ]; then
  # The pool wants 12+ characters with upper, lower and a number. Checked here
  # because the API error says "Password did not conform with policy" without
  # saying which part of it.
  if [ "${#STAFF_PASSWORD}" -lt 12 ] \
    || ! printf '%s' "$STAFF_PASSWORD" | grep -q '[a-z]' \
    || ! printf '%s' "$STAFF_PASSWORD" | grep -q '[A-Z]' \
    || ! printf '%s' "$STAFF_PASSWORD" | grep -q '[0-9]'; then
    echo "error: STAFF_PASSWORD needs 12+ characters with a lowercase, an uppercase and a number" >&2
    exit 2
  fi

  echo "==> setting a permanent password (no email needed)"
  run aws cognito-idp admin-set-user-password \
    --user-pool-id "$POOL" \
    --username "$EMAIL" \
    --password "$STAFF_PASSWORD" \
    --permanent
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> dry run, nothing was created"
else
  echo "==> done. Cognito has emailed a temporary password."
  echo "    Built-in sender is capped at 50 messages a day; 60 staff needs two"
  echo "    days or SES via the module's ses_source_arn."
fi

# ---------------------------------------------------------------------------
# Why this is a script and not an aws_cognito_user resource.
#
# 1. temporary_password and password are sensitive attributes, which in
#    Terraform means masked in CLI output and stored in plaintext in state.
# 2. terraform destroy would delete every staff account. This repo's whole
#    workflow is apply, verify, destroy.
# 3. Sixty real teachers' email addresses would live in a repo that is a public
#    portfolio piece.
# 4. Accounts are data, not infrastructure. Staff join and leave on a different
#    schedule than the buckets change.
# ---------------------------------------------------------------------------
