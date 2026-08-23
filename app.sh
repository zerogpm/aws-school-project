#!/usr/bin/env bash
# The local stack: DynamoDB in Docker, the API, and the front end.
#
#   ./app.sh --start           start the database and create tables
#   ./app.sh --start --api     also launch the backend API, detached
#   ./app.sh --start --web     also launch the front end, detached
#   ./app.sh --stop            stop everything, keep the data
#   ./app.sh --stop --wipe     stop everything and delete the database
#   ./app.sh --status          what is running, and what is in the database
#   ./app.sh --scan [table]    dump a table
#
# Local only. Nothing here touches AWS: `terraform destroy` tears down the
# deployed stack and `./scripts/check-destroyed.sh` confirms it worked.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/backend/local/docker-compose.yml"
WEB_LOG="$ROOT/.local-web.log"
API_LOG="$ROOT/.local-api.log"

# 127.0.0.1, never localhost: on Windows localhost resolves to ::1 first and the
# container listens on IPv4 only.
ENDPOINT="http://127.0.0.1:8000"
WEB_PORT=5173
API_PORT=3000

# Docker is cross-platform and needs no branch. Only the port cleanup genuinely
# differs, so OS detection exists for that and nothing else.
IS_WINDOWS=false
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN* | Windows_NT) IS_WINDOWS=true ;;
esac

ACTION=""
WIPE=false

# Off by default. A dev server belongs in the foreground of its own terminal,
# where its output is visible and Ctrl-C works; detaching it hides HMR errors in
# a log nobody reads. --web is there for when you want one command.
WEB=false

# Same reasoning as --web, and the same escape hatch. The API server prints the
# route table at boot, which is the fastest way to spot a handler that was never
# added to backend/src/routes.ts - and detaching hides it.
API=false

SCAN_TABLE="local-school"

while [ $# -gt 0 ]; do
  case "$1" in
    --start | --stop | --status | --scan) ACTION="${1#--}" ;;
    --wipe) WIPE=true ;;
    --web) WEB=true ;;
    --api) API=true ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [ "$ACTION" = "scan" ]; then
        SCAN_TABLE="$1"
      else
        echo "error: unknown argument '$1'" >&2
        exit 2
      fi
      ;;
  esac
  shift
done

if [ -z "$ACTION" ]; then
  echo "usage: $0 [--start|--stop|--status|--scan] [--wipe] [--api] [--web]" >&2
  exit 2
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "error: the Docker daemon is not running - start Docker Desktop first" >&2
    exit 1
  fi
}

# The service API, signed with credentials DynamoDB Local ignores but the SDK
# insists on.
ddb() {
  # Assigned rather than defaulted inline: "${2:-\{\}}" keeps its backslashes
  # inside double quotes and posts invalid JSON, which DynamoDB Local reports
  # as InternalFailure rather than as a parse error.
  local body="${2:-}"
  [ -n "$body" ] || body='{}'

  curl -s -X POST "$ENDPOINT/" \
    -H "Content-Type: application/x-amz-json-1.0" \
    -H "X-Amz-Target: DynamoDB_20120810.$1" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=local/x/ca-central-1/dynamodb/aws4_request, SignedHeaders=, Signature=x" \
    -d "$body"
}

# A bare GET returns HTTP 400. That is the healthy answer - it is refusing an
# unsigned request - so wait for any response rather than a 200 that never
# arrives.
wait_for_db() {
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    curl -s -o /dev/null "$ENDPOINT" && return 0
    sleep 0.5
  done
  echo "error: DynamoDB Local did not answer at $ENDPOINT within 30s" >&2
  exit 1
}

pids_on_port() {
  if [ "$IS_WINDOWS" = true ]; then
    # LISTENING only, so an outbound connection to the same port number is not
    # mistaken for the server.
    netstat -ano 2>/dev/null | grep -E "LISTENING" | grep -E ":$1[[:space:]]" |
      awk '{print $NF}' | sort -u || true
  else
    lsof -ti "tcp:$1" 2>/dev/null || true
  fi
}

kill_port() {
  local port="$1" label="$2" found=false

  for pid in $(pids_on_port "$port"); do
    # PID 0 is the system idle process on Windows and turns up for some
    # sockets. It cannot be killed and saying so is noise.
    [ "$pid" = "0" ] && continue
    if [ "$IS_WINDOWS" = true ]; then
      # Double slashes: Git Bash rewrites a leading /F into a path otherwise.
      taskkill //F //PID "$pid" >/dev/null 2>&1 || true
    else
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    printf '  %-5s stopped pid %s (%s)\n' "$port" "$pid" "$label"
    found=true
  done

  [ "$found" = true ] || printf '  %-5s free (%s)\n' "$port" "$label"
}

case "$ACTION" in
  start)
    require_docker

    echo "==> database"
    compose up -d
    wait_for_db
    (cd "$ROOT/backend" && npm run --silent db:tables)

    if [ "$API" = true ]; then
      if [ -n "$(pids_on_port "$API_PORT")" ]; then
        echo "==> api already on :$API_PORT"
      else
        echo "==> api"
        # Detached, output to a log, for the same reason as the front end below:
        # the server outlives this script, and anything that inherits this
        # terminal keeps it open.
        # `start`, not `dev`. `dev` is tsx in watch mode, which belongs in the
        # foreground of its own terminal; detached, its restarts happen silently
        # and it keeps this script's pipe open.
        (cd "$ROOT/backend" && nohup npm run --silent start >"$API_LOG" 2>&1 &)

        # Probe the health endpoint rather than the port. A listening socket
        # only proves express bound; a 200 from /health proves the whole wrapper
        # - event construction, the handler, the response translation - works.
        api_deadline=$((SECONDS + 30))
        while [ "$SECONDS" -lt "$api_deadline" ]; do
          curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/health" && break
          sleep 0.5
        done

        if curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/health"; then
          echo "    http://127.0.0.1:$API_PORT  (log: ${API_LOG#"$ROOT/"})"
        else
          echo "    did not come up - see ${API_LOG#"$ROOT/"}" >&2
        fi
      fi
    fi

    if [ "$API" = false ]; then
      echo "==> api: cd backend && npm run dev   (watch mode, or re-run with --api)"
    fi

    if [ "$WEB" = true ]; then
      if [ -n "$(pids_on_port "$WEB_PORT")" ]; then
        echo "==> front end already on :$WEB_PORT"
      else
        echo "==> front end"
        # --host 127.0.0.1 is not cosmetic: vite binds "localhost", which on
        # Windows resolves to ::1, and every readiness probe in this repo uses
        # IPv4. Without it the server is up and the probe says it is not.
        #
        # Detached, with output to a log, because the server outlives this
        # script. Anything that inherits this terminal keeps it open - which is
        # also why --web is opt-in.
        (cd "$ROOT/site" && nohup npm run dev -- --host 127.0.0.1 >"$WEB_LOG" 2>&1 &)

        local_deadline=$((SECONDS + 30))
        while [ "$SECONDS" -lt "$local_deadline" ]; do
          [ -n "$(pids_on_port "$WEB_PORT")" ] && break
          sleep 0.5
        done

        if [ -n "$(pids_on_port "$WEB_PORT")" ]; then
          echo "    http://127.0.0.1:$WEB_PORT  (log: ${WEB_LOG#"$ROOT/"})"
        else
          echo "    did not come up - see ${WEB_LOG#"$ROOT/"}" >&2
        fi
      fi
    fi

    if [ "$WEB" = false ]; then
      echo "==> front end: cd site && npm run dev   (or re-run with --web)"
    fi
    echo "==> ready. database at $ENDPOINT"
    ;;

  stop)
    echo "==> dev servers"
    kill_port 3000 "backend api"
    kill_port 5173 "vite dev server"
    kill_port 4173 "vite preview (used by the e2e suite)"
    kill_port 8001 "dynamodb-admin"

    echo "==> database"
    if ! docker info >/dev/null 2>&1; then
      echo "  Docker is not running - nothing to stop"
    elif [ "$WIPE" = true ]; then
      # -v drops the named volume. Without it the data survives, which is
      # usually what you want and occasionally exactly what you do not.
      compose down -v >/dev/null 2>&1
      echo "  container stopped and database deleted"
    else
      compose down >/dev/null 2>&1
      echo "  container stopped, data kept (--wipe to delete it)"
    fi

    echo "==> stopped"
    ;;

  status)
    require_docker
    echo "==> containers"
    compose ps
    echo "==> ports"
    for entry in "3000:backend api" "5173:vite dev server" "4173:vite preview" "8001:dynamodb-admin"; do
      port="${entry%%:*}"
      if [ -n "$(pids_on_port "$port")" ]; then
        printf '  %-5s in use (%s)\n' "$port" "${entry#*:}"
      else
        printf '  %-5s free (%s)\n' "$port" "${entry#*:}"
      fi
    done
    echo "==> tables"
    if curl -s -o /dev/null "$ENDPOINT"; then
      echo "  $(ddb ListTables)"
    else
      echo "  database not answering at $ENDPOINT"
    fi
    ;;

  scan)
    echo "==> $SCAN_TABLE"
    ddb Scan "{\"TableName\":\"$SCAN_TABLE\",\"Limit\":25}"
    echo
    ;;
esac
