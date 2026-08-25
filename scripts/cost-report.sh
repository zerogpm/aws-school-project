#!/usr/bin/env bash
# What this account actually cost, by service.
#
#   ./scripts/cost-report.sh                 last 30 days, grouped by service
#   ./scripts/cost-report.sh 7               last 7 days
#   ./scripts/cost-report.sh --daily 3       per-day totals for the last 3 days
#   ./scripts/cost-report.sh --dry-run
#
# The episode's closing number, and the reason 06 is called cost. README.md has
# a "Running costs" section that is deliberately empty until this has been run
# against a stack that stayed up long enough to bill - a wrong figure on camera
# is worse than no figure.
#
# Read-only. Cost Explorer charges $0.01 per request, which is the only line in
# this repo that bills for asking what things cost.
set -euo pipefail

# Cost Explorer is a us-east-1 endpoint. Everything this project stores is in
# ca-central-1; the billing API simply does not exist there, the same way
# Route53 health check metrics do not. Asking about Canadian resources from
# us-east-1 moves no data - the answer is a number.
CE_REGION="us-east-1"

DRY_RUN=false
GRANULARITY="MONTHLY"
DAYS=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --daily) GRANULARITY="DAILY" ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "error: unknown flag $arg" >&2; exit 2 ;;
    *) DAYS="$arg" ;;
  esac
done

DAYS="${DAYS:-30}"

if ! printf '%s' "$DAYS" | grep -qE '^[0-9]+$' || [ "$DAYS" -lt 1 ]; then
  echo "error: days must be a positive integer, got '$DAYS'" >&2
  exit 2
fi

# Cost Explorer's End is exclusive, so tomorrow captures everything billed so
# far today. GNU date and BSD date disagree about relative dates, hence both.
if date -d "1 day" +%Y-%m-%d >/dev/null 2>&1; then
  END="$(date -d "1 day" +%Y-%m-%d)"
  START="$(date -d "-$DAYS days" +%Y-%m-%d)"
else
  END="$(date -v+1d +%Y-%m-%d)"
  START="$(date -v-"${DAYS}"d +%Y-%m-%d)"
fi

echo "==> cost from $START to $END (exclusive), $GRANULARITY, in $CE_REGION"

if [ "$DRY_RUN" = true ]; then
  echo "  [dry run] would call: aws ce get-cost-and-usage --time-period Start=$START,End=$END"
  exit 0
fi

# A failed call is reported, never swallowed - the same rule check-destroyed.sh
# follows. "No costs found" and "the call did not work" must not look alike when
# the answer is going into a README as a fact.
if ! raw="$(aws ce get-cost-and-usage \
    --region "$CE_REGION" \
    --time-period "Start=$START,End=$END" \
    --granularity "$GRANULARITY" \
    --metrics UnblendedCost \
    --group-by Type=DIMENSION,Key=SERVICE \
    --query 'ResultsByTime[].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' \
    --output text 2>&1)"; then
  printf '  !! Cost Explorer call failed: %s\n' "$raw"
  echo "  (a brand new account has no data until Cost Explorer is enabled once, which takes ~24h)"
  exit 1
fi

if [ -z "$raw" ] || [ "$raw" = "None" ]; then
  echo "  nothing billed in this window"
  exit 0
fi

# Services summed across the period, largest first, so the line that dominates
# the bill is the first one read. awk rather than jq: jq is a dependency nowhere
# else in this repo, and this is one group-by and a total.
printf '%s\n' "$raw" \
  | awk '{ total[$1] += $2 } END { for (s in total) if (total[s] >= 0.005) printf "%12.2f  %s\n", total[s], s }' \
  | sort -rn

printf '%s\n' "$raw" | awk -v days="$DAYS" '
  { sum += $2 }
  END {
    printf "  ----------\n"
    printf "%12.2f  TOTAL over %d days\n", sum, days
    printf "%12.2f  per day\n", sum / days
    printf "%12.2f  projected per 30-day month\n", sum / days * 30
  }'

echo
echo "Lines under half a cent are omitted. Set them against README.md's"
echo "'Running costs' section, and against the \$10 target in CLAUDE.md."
