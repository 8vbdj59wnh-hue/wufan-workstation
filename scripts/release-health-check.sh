#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/production-paths.sh"
source "$SCRIPT_DIR/lib/node-runtime.sh"
wufan_load_production_paths

EXPECTED_PROJECT_DIR="${WUFAN_PROJECT_DIR:?WUFAN_PROJECT_DIR is required}"
RELEASE_ROOT="${WUFAN_RELEASE_ROOT:?WUFAN_RELEASE_ROOT is required}"
DATABASE_PATH="${WUFAN_DB_PATH:?WUFAN_DB_PATH is required}"
BASELINE_PATH="${WUFAN_DB_BASELINE_PATH:?WUFAN_DB_BASELINE_PATH is required}"

COMMIT_SHA=""
RELEASE_DIR=""
PHASE=""

basic_fail() {
  echo "HEALTH_CHECK_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      COMMIT_SHA="${2:-}"
      shift 2
      ;;
    --release-dir)
      RELEASE_DIR="${2:-}"
      shift 2
      ;;
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    *)
      basic_fail "unknown argument: $1"
      ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || basic_fail "--commit must be a full SHA"
[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || basic_fail "--release-dir must exist and be absolute"
case "$PHASE" in before|after|rollback) ;; *) basic_fail "--phase must be before, after, or rollback" ;; esac

PROJECT_DIR="$EXPECTED_PROJECT_DIR"
if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
  PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:-$PROJECT_DIR}"
  DATABASE_PATH="${RELEASE_TEST_DATABASE_PATH:-$PROJECT_DIR/data/workstation.db}"
  BASELINE_PATH="${RELEASE_TEST_BASELINE_PATH:-$PROJECT_DIR/data/business-baseline.json}"
  case "$RELEASE_DIR" in /tmp/*|/private/tmp/*) ;; *) basic_fail "test release directory must be under /tmp" ;; esac
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
  PM2_COMMAND="${RELEASE_TEST_PM2_COMMAND:-$(command -v pm2)}"
else
  case "$RELEASE_DIR" in "$RELEASE_ROOT"/release-*) ;; *) basic_fail "release directory must be under $RELEASE_ROOT" ;; esac
  wufan_resolve_node_runtime || basic_fail "Node.js 22 runtime unavailable"
fi

[[ -x "$NODE_COMMAND" ]] || basic_fail "Node 22 unavailable"
[[ -x "$PM2_COMMAND" ]] || basic_fail "PM2 unavailable"
mkdir -p "$RELEASE_DIR/checks" "$RELEASE_DIR/logs"
RESULT_PATH="$RELEASE_DIR/checks/health-$PHASE.json"
LOG_PATH="$RELEASE_DIR/logs/health-$PHASE.log"
: > "$LOG_PATH"

write_failure() {
  message="$1"
  export RESULT_PATH PHASE COMMIT_SHA message
  "$NODE_COMMAND" <<'NODE' || true
const fs = require("fs");
fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify({
  phase: process.env.PHASE,
  targetCommit: process.env.COMMIT_SHA,
  success: false,
  error: process.env.message,
  checkedAt: new Date().toISOString(),
}, null, 2)}\n`);
NODE
}

fail() {
  echo "HEALTH_CHECK_FAIL: $*" | tee -a "$LOG_PATH" >&2
  write_failure "$*"
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_PATH"
}

is_process_or_descendant_of() {
  local process_pid="$1"
  local expected_ancestor_pid="$2"
  local parent_pid=""
  while [[ "$process_pid" =~ ^[0-9]+$ && "$process_pid" -gt 1 ]]; do
    [[ "$process_pid" == "$expected_ancestor_pid" ]] && return 0
    parent_pid="$(ps -o ppid= -p "$process_pid" | tr -d ' ')"
    [[ -n "$parent_pid" && "$parent_pid" != "$process_pid" ]] || break
    process_pid="$parent_pid"
  done
  return 1
}

[[ -d "$PROJECT_DIR/.git" ]] || fail "project repository missing"
CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
if [[ "$PHASE" == "after" ]]; then
  [[ "$CURRENT_COMMIT" == "$COMMIT_SHA" ]] || fail "after health check requires HEAD=$COMMIT_SHA"
fi

PM2_RAW="$("$PM2_COMMAND" jlist)" \
  || fail "unable to read PM2 process list"
PM2_SAFE_PATH="$RELEASE_DIR/checks/pm2-health-$PHASE.json"
if ! PROJECT_DIR="$PROJECT_DIR" PM2_RAW="$PM2_RAW" "$NODE_COMMAND" > "$PM2_SAFE_PATH" 2>> "$LOG_PATH" <<'NODE'
const apps = JSON.parse(process.env.PM2_RAW);
const safe = [];
for (const name of ["wufan-client", "wufan-server"]) {
  const app = apps.find((item) => item.name === name);
  if (!app) throw new Error(`missing PM2 app ${name}`);
  if (app.pm2_env?.status !== "online") throw new Error(`${name} is not online`);
  if (app.pm2_env?.pm_cwd !== process.env.PROJECT_DIR) throw new Error(`${name} cwd mismatch`);
  safe.push({
    name,
    pid: app.pid,
    status: app.pm2_env.status,
    cwd: app.pm2_env.pm_cwd,
    uptime: app.pm2_env.pm_uptime,
    restartCount: app.pm2_env.restart_time,
    outLog: app.pm2_env.pm_out_log_path,
    errorLog: app.pm2_env.pm_err_log_path,
  });
}
process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
NODE
then
  fail "required PM2 services are missing, offline, or using the wrong working directory"
fi

for port in 5173 3001; do
  listener_pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN | head -n 1)"
  [[ -n "$listener_pid" ]] || fail "port $port has no listener"
  expected_service="wufan-server"
  [[ "$port" == "5173" ]] && expected_service="wufan-client"
  expected_pid="$("$NODE_COMMAND" -e \
    'const apps=require(process.argv[1]);const app=apps.find(x=>x.name===process.argv[2]);process.stdout.write(String(app?.pid??""))' \
    "$PM2_SAFE_PATH" "$expected_service")"
  is_process_or_descendant_of "$listener_pid" "$expected_pid" \
    || fail "port $port is not owned by PM2 service $expected_service or its process tree (listener=$listener_pid pm2=$expected_pid)"
  listener_cwd="$(lsof -a -p "$listener_pid" -d cwd -Fn | awk '/^n/ { sub(/^n/, ""); print; exit }')"
  [[ "$listener_cwd" == "$PROJECT_DIR" ]] || fail "port $port listener cwd mismatch: $listener_cwd"
done

HEALTH_JSON="$(curl --fail --silent --show-error -H 'x-wufan-api-source: system:release' http://127.0.0.1:3001/api/health)" \
  || fail "backend health request failed"
HEALTH_JSON="$HEALTH_JSON" PHASE="$PHASE" "$NODE_COMMAND" <<'NODE' \
  || fail "backend health payload invalid"
const health = JSON.parse(process.env.HEALTH_JSON);
const currentContract = health.status === "ok" &&
  health.technicalHealth?.status === "ok" &&
  ["ok", "not_enforced"].includes(health.businessDataHealth?.status);
const legacyContract = health.ok === true;
if (!currentContract && !(process.env.PHASE === "before" && legacyContract)) {
  throw new Error("health status or database is not ok");
}
NODE

[[ -f "$BASELINE_PATH" ]] || fail "business baseline is missing: $BASELINE_PATH"
BUSINESS_BASELINE_JSON=""
if ! BUSINESS_BASELINE_JSON="$(WUFAN_PROJECT_DIR="$PROJECT_DIR" "$SCRIPT_DIR/release-business-baseline-check.sh" \
  --database "$DATABASE_PATH" \
  --baseline "$BASELINE_PATH")"; then
  BASELINE_ERROR_TYPE="$(printf '%s' "$BUSINESS_BASELINE_JSON" | "$NODE_COMMAND" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).errorType||"baseline_query_failed")}catch{process.stdout.write("baseline_query_failed")}})')"
  fail "business baseline check failed: $BASELINE_ERROR_TYPE"
fi
[[ -n "${BUSINESS_BASELINE_JSON//[[:space:]]/}" ]] \
  || fail "business baseline check failed: baseline_cli_contract_violation"
BUSINESS_BASELINE_JSON="$BUSINESS_BASELINE_JSON" "$NODE_COMMAND" -e \
  'const value=JSON.parse(process.env.BUSINESS_BASELINE_JSON);if(!value||value.status!=="ok")process.exit(1)' \
  || fail "business baseline check failed: baseline_cli_contract_violation"

FRONT_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:5173/)"
[[ "$FRONT_STATUS" == "200" ]] || fail "frontend returned HTTP $FRONT_STATUS"

RESOURCE_DIR="$RELEASE_DIR/checks/http-$PHASE"
mkdir -p "$RESOURCE_DIR"
RESOURCE_RESULTS="$RELEASE_DIR/checks/resources-$PHASE.txt"
: > "$RESOURCE_RESULTS"
for resource in index.html src/main.js src/modules.js src/styles.css; do
  output="$RESOURCE_DIR/$(basename "$resource")"
  curl --fail --silent --show-error "http://127.0.0.1:5173/$resource" > "$output" \
    || fail "failed to fetch frontend resource: $resource"
  http_sha="$(shasum -a 256 "$output" | awk '{print $1}')"
  disk_sha="$(shasum -a 256 "$PROJECT_DIR/$resource" | awk '{print $1}')"
  [[ "$http_sha" == "$disk_sha" ]] || fail "HTTP resource differs from worktree: $resource"
  printf '%s|%s\n' "$resource" "$http_sha" >> "$RESOURCE_RESULTS"
done

DATABASE_INTEGRITY="$(sqlite3 "file:$DATABASE_PATH?mode=ro" 'PRAGMA integrity_check;')"
[[ "$DATABASE_INTEGRITY" == "ok" ]] || fail "database integrity check failed"

CLIENT_ERROR_LOG="$WUFAN_PM2_LOG_ROOT/wufan-client-error.log"
SERVER_ERROR_LOG="$WUFAN_PM2_LOG_ROOT/wufan-server-error.log"
CLIENT_ERROR_LOG_SIZE="$(stat -f '%z' "$CLIENT_ERROR_LOG" 2>/dev/null || echo 0)"
SERVER_ERROR_LOG_SIZE="$(stat -f '%z' "$SERVER_ERROR_LOG" 2>/dev/null || echo 0)"
NEW_FATAL_ERRORS=false
if [[ "$PHASE" == "after" && -f "$RELEASE_DIR/checks/health-before.json" ]]; then
  BEFORE_CLIENT_SIZE="$("$NODE_COMMAND" -e \
    'const r=require(process.argv[1]);process.stdout.write(String(r.errorLogOffsets?.client??0))' \
    "$RELEASE_DIR/checks/health-before.json")"
  BEFORE_SERVER_SIZE="$("$NODE_COMMAND" -e \
    'const r=require(process.argv[1]);process.stdout.write(String(r.errorLogOffsets?.server??0))' \
    "$RELEASE_DIR/checks/health-before.json")"
  NEW_ERRORS="$RELEASE_DIR/checks/new-errors-after.log"
  : > "$NEW_ERRORS"
  for entry in \
    "$CLIENT_ERROR_LOG|$BEFORE_CLIENT_SIZE" \
    "$SERVER_ERROR_LOG|$BEFORE_SERVER_SIZE"
  do
    error_log="${entry%%|*}"
    previous_size="${entry##*|}"
    current_size="$(stat -f '%z' "$error_log" 2>/dev/null || echo 0)"
    start_byte=$((previous_size + 1))
    [[ "$current_size" -ge "$previous_size" ]] || start_byte=1
    [[ -f "$error_log" ]] && tail -c +"$start_byte" "$error_log" >> "$NEW_ERRORS"
  done
  if grep -Eiq 'fatal|uncaught exception|unhandled rejection|EADDRINUSE|SQLITE_(CORRUPT|NOTADB)' "$NEW_ERRORS"; then
    NEW_FATAL_ERRORS=true
  fi
  [[ "$NEW_FATAL_ERRORS" == false ]] || fail "new fatal errors detected in PM2 error logs"
fi

{
  echo "===== wufan-client recent errors ====="
  tail -n 80 "$CLIENT_ERROR_LOG" 2>/dev/null || true
  echo "===== wufan-server recent errors ====="
  tail -n 80 "$SERVER_ERROR_LOG" 2>/dev/null || true
} >> "$LOG_PATH"

export RESULT_PATH PHASE COMMIT_SHA CURRENT_COMMIT HEALTH_JSON FRONT_STATUS
export DATABASE_PATH DATABASE_INTEGRITY PM2_SAFE_PATH RESOURCE_RESULTS BUSINESS_BASELINE_JSON
export CLIENT_ERROR_LOG_SIZE SERVER_ERROR_LOG_SIZE NEW_FATAL_ERRORS
"$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const parse = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const resources = fs.readFileSync(process.env.RESOURCE_RESULTS, "utf8")
  .split(/\r?\n/).filter(Boolean).map((line) => {
    const [path, sha256] = line.split("|");
    return { path, sha256, matchesWorktree: true };
  });
const result = {
  phase: process.env.PHASE,
  success: true,
  checkedAt: new Date().toISOString(),
  targetCommit: process.env.COMMIT_SHA,
  worktreeCommit: process.env.CURRENT_COMMIT,
  pm2: parse(process.env.PM2_SAFE_PATH),
  ports: { client: 5173, server: 3001 },
  health: JSON.parse(process.env.HEALTH_JSON),
  frontendStatus: Number(process.env.FRONT_STATUS),
  resources,
  databasePath: process.env.DATABASE_PATH,
  databaseIntegrity: process.env.DATABASE_INTEGRITY,
  businessDataHealth: JSON.parse(process.env.BUSINESS_BASELINE_JSON),
  errorLogOffsets: {
    client: Number(process.env.CLIENT_ERROR_LOG_SIZE),
    server: Number(process.env.SERVER_ERROR_LOG_SIZE),
  },
  newFatalErrorsDetected: process.env.NEW_FATAL_ERRORS === "true",
  businessWritesPerformed: false,
  manualBrowserVerificationRequired: true,
};
fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
NODE

log "health check passed for phase=$PHASE"
echo "HEALTH_RESULT=$RESULT_PATH"
