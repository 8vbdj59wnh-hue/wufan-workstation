#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
RELEASE_ROOT="/Users/meiyounaichatouyuna/WufanWorkstationReleases"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"
DATABASE_PATH="$EXPECTED_PROJECT_DIR/data/workstation.db"

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
  case "$RELEASE_DIR" in /tmp/*|/private/tmp/*) ;; *) basic_fail "test release directory must be under /tmp" ;; esac
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
else
  case "$RELEASE_DIR" in "$RELEASE_ROOT"/release-*) ;; *) basic_fail "release directory must be under $RELEASE_ROOT" ;; esac
  NODE_COMMAND="$NODE22_BIN/node"
fi

[[ -x "$NODE_COMMAND" ]] || basic_fail "Node 22 unavailable"
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

[[ -d "$PROJECT_DIR/.git" ]] || fail "project repository missing"
CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
if [[ "$PHASE" == "after" ]]; then
  [[ "$CURRENT_COMMIT" == "$COMMIT_SHA" ]] || fail "after health check requires HEAD=$COMMIT_SHA"
fi

PM2_RAW="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" pm2 jlist)" \
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
  [[ "$listener_pid" == "$expected_pid" ]] \
    || fail "port $port is not owned by PM2 service $expected_service (listener=$listener_pid pm2=$expected_pid)"
  listener_cwd="$(lsof -a -p "$listener_pid" -d cwd -Fn | awk '/^n/ { sub(/^n/, ""); print; exit }')"
  [[ "$listener_cwd" == "$PROJECT_DIR" ]] || fail "port $port listener cwd mismatch: $listener_cwd"
done

HEALTH_JSON="$(curl --fail --silent --show-error http://127.0.0.1:3001/api/health)" \
  || fail "backend health request failed"
HEALTH_JSON="$HEALTH_JSON" DATABASE_PATH="$DATABASE_PATH" "$NODE_COMMAND" <<'NODE' \
  || fail "backend health payload invalid"
const health = JSON.parse(process.env.HEALTH_JSON);
if (health.ok !== true) throw new Error("ok is not true");
if (health.databasePath !== process.env.DATABASE_PATH) throw new Error(`database path mismatch: ${health.databasePath}`);
NODE

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

HEALTH_USERNAME="${WUFAN_HEALTH_USERNAME:-}"
HEALTH_PASSWORD="${WUFAN_HEALTH_PASSWORD:-}"
HEALTH_TOKEN="${WUFAN_HEALTH_TOKEN:-}"
AUTH_RESULT="$RELEASE_DIR/checks/auth-$PHASE.json"
HEALTH_USERNAME="$HEALTH_USERNAME" HEALTH_PASSWORD="$HEALTH_PASSWORD" HEALTH_TOKEN="$HEALTH_TOKEN" \
  AUTH_RESULT="$AUTH_RESULT" "$NODE_COMMAND" <<'NODE' || fail "administrator login or /api/data check failed"
const fs = require("fs");
(async () => {
  const base = "http://127.0.0.1:3001";
  let token = process.env.HEALTH_TOKEN;
  let loginUser = null;
  if (!token) {
    if (!process.env.HEALTH_USERNAME || !process.env.HEALTH_PASSWORD) {
      throw new Error("WUFAN_HEALTH_TOKEN or WUFAN_HEALTH_USERNAME/WUFAN_HEALTH_PASSWORD is required");
    }
    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.HEALTH_USERNAME,
        password: process.env.HEALTH_PASSWORD,
      }),
    });
    if (!loginResponse.ok) throw new Error(`login returned ${loginResponse.status}`);
    const login = await loginResponse.json();
    if (!login.token) throw new Error("login response did not include a token");
    token = login.token;
    loginUser = { id: login.user?.id, name: login.user?.name, role: login.user?.role };
  }
  const dataResponse = await fetch(`${base}/api/data`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!dataResponse.ok) throw new Error(`/api/data returned ${dataResponse.status}`);
  const data = await dataResponse.json();
  const counts = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  fs.writeFileSync(process.env.AUTH_RESULT, `${JSON.stringify({
    loginOk: true,
    dataReadOk: true,
    user: loginUser,
    counts,
  }, null, 2)}\n`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

DATABASE_INTEGRITY="$(sqlite3 "file:$DATABASE_PATH?mode=ro" 'PRAGMA integrity_check;')"
[[ "$DATABASE_INTEGRITY" == "ok" ]] || fail "database integrity check failed"

{
  echo "===== wufan-client recent errors ====="
  tail -n 80 "$HOME/.pm2/logs/wufan-client-error.log" 2>/dev/null || true
  echo "===== wufan-server recent errors ====="
  tail -n 80 "$HOME/.pm2/logs/wufan-server-error.log" 2>/dev/null || true
} >> "$LOG_PATH"

export RESULT_PATH PHASE COMMIT_SHA CURRENT_COMMIT HEALTH_JSON FRONT_STATUS
export DATABASE_PATH DATABASE_INTEGRITY PM2_SAFE_PATH AUTH_RESULT RESOURCE_RESULTS
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
  authentication: parse(process.env.AUTH_RESULT),
  databasePath: process.env.DATABASE_PATH,
  databaseIntegrity: process.env.DATABASE_INTEGRITY,
  businessWritesPerformed: false,
};
fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
NODE

log "health check passed for phase=$PHASE"
echo "HEALTH_RESULT=$RESULT_PATH"
