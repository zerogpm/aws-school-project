#!/usr/bin/env bash
# Load the student roll into a deployed stage's table.
#
#   ./scripts/seed-students.sh [stage]
#   ./scripts/seed-students.sh --dry-run 04-booking
#
# A booking's first condition is that the student number exists, so a freshly
# applied stage rejects every booking until this has run. Locally the same rows
# come from backend/local/seed.ts and this script is not needed at all.
#
# Students are deliberately NOT in Terraform. They are data with a lifecycle of
# their own - a new intake every September - and putting rows in a state file
# means `terraform destroy` deletes the roll and a plan diffs against whatever
# the office edited last week. The table is the resource; its contents are not.
#
# In a real deployment this is an import from the student information system.
# Here it is four families, enough to demonstrate booking, the one-per-teacher
# rule, and a cancellation.
set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

STAGE="${1:-04-booking}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$ROOT/$STAGE"

if [ ! -d "$STAGE_DIR" ]; then
  echo "error: no stage directory at $STAGE_DIR" >&2
  exit 2
fi

command -v aws >/dev/null 2>&1 || { echo "error: the AWS CLI is not on PATH" >&2; exit 2; }

# The table name comes from the stage's outputs rather than being typed here,
# so a destroyed and recreated table is followed automatically and there is no
# second place for the name to be wrong.
TABLE="$(terraform -chdir="$STAGE_DIR" output -raw table_name 2>/dev/null || true)"
REGION="$(terraform -chdir="$STAGE_DIR" output -raw aws_region 2>/dev/null || echo "ca-central-1")"

if [ -z "$TABLE" ]; then
  echo "error: $STAGE has no table_name output - is it applied?" >&2
  exit 2
fi

# number|name|grade. The same four as backend/local/seed.ts, so a demo reads the
# same whether it is running locally or against AWS.
STUDENTS='S00481|Amara Okonkwo|11
S00482|Daniel Tremblay|11
S00483|Priya Raman|9
S00484|Noah Fitzgerald|12'

echo "==> table $TABLE ($REGION)"

while IFS='|' read -r NUMBER NAME GRADE; do
  [ -n "$NUMBER" ] || continue

  ITEM=$(cat <<JSON
{
  "PK": {"S": "STUDENT#$NUMBER"},
  "SK": {"S": "PROFILE"},
  "studentNumber": {"S": "$NUMBER"},
  "name": {"S": "$NAME"},
  "grade": {"N": "$GRADE"}
}
JSON
)

  if [ "$DRY_RUN" = 1 ]; then
    echo "    would put $NUMBER $NAME"
    continue
  fi

  # Conditional, so re-running never overwrites a record the office edited.
  # The CLI exits non-zero on a failed condition, which is the normal case on
  # every run after the first - so it is caught rather than allowed to abort
  # the loop under `set -e`.
  if aws dynamodb put-item \
    --region "$REGION" \
    --table-name "$TABLE" \
    --item "$ITEM" \
    --condition-expression "attribute_not_exists(PK)" \
    >/dev/null 2>&1; then
    echo "    + $NUMBER $NAME"
  else
    echo "    = $NUMBER already present"
  fi
done <<< "$STUDENTS"

echo
echo "Book against one of these with:"
echo "  curl -s -X POST \"\$(terraform -chdir=$STAGE output -raw api_url)/bookings\" \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"studentNumber\":\"S00481\",\"windowId\":\"...\",\"slotId\":\"...\"}'"
