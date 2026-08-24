#!/usr/bin/env bash
# Seed a deployed stage's table: students, windows, and the whole slot grid.
#
#   ./scripts/seed-stage.sh                    default: 05-email
#   ./scripts/seed-stage.sh 04-booking
#   ./scripts/seed-stage.sh --dry-run 05-email
#
# The local stack seeds itself when app.sh starts. A deployed stage does not,
# on purpose: students and windows have a lifecycle of their own - a new intake
# every September - and rows in a state file would mean `terraform destroy`
# deleted the school roll along with the infrastructure. So a fresh apply gives
# you an empty table and a booking page that correctly says "not open yet".
#
# This is the wrapper, not the seeder. backend/scripts/seed-aws.ts does the
# writing and is the one place the data lives; all this does is find out which
# table to write to, which is the part nobody should be typing by hand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY_RUN=false
STAGE=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "error: unknown flag $arg" >&2; exit 2 ;;
    *) STAGE="$arg" ;;
  esac
done

STAGE="${STAGE:-05-email}"
STAGE_DIR="$ROOT/$STAGE"

if [ ! -d "$STAGE_DIR" ]; then
  echo "error: no stage directory at $STAGE_DIR" >&2
  exit 2
fi

# The table name comes from the stage's own outputs rather than being typed on
# the command line, so a destroyed and recreated table is followed
# automatically and there is no second place for the name to be wrong.
TABLE="$(terraform -chdir="$STAGE_DIR" output -raw table_name 2>/dev/null || true)"
REGION="$(terraform -chdir="$STAGE_DIR" output -raw aws_region 2>/dev/null || echo "ca-central-1")"

if [ -z "$TABLE" ]; then
  echo "error: $STAGE has no table_name output - is it applied?" >&2
  exit 2
fi

echo "==> $STAGE -> $TABLE ($REGION)"

# Writes are guarded with attribute_not_exists, so running this twice is safe
# and a re-run after adding a teacher fills in only what is missing.
if [ "$DRY_RUN" = true ]; then
  (cd "$ROOT/backend" && npm run --silent seed:aws -- --table "$TABLE" --region "$REGION" --dry-run)
else
  (cd "$ROOT/backend" && npm run --silent seed:aws -- --table "$TABLE" --region "$REGION")
fi
