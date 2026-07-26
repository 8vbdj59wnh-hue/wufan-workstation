#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
RELEASE_ROOT="/Users/meiyounaichatouyuna/WufanWorkstationReleases"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

COMMIT_SHA=""
CHANGE_TYPE=""
RELEASE_DIR=""
CONFIRM=""
DRY_RUN=false
STAGE="argument-validation"
MANIFEST=""
NODE_COMMAND="$NODE22_BIN/node"

fail() {
  echo "RELEASE_EXECUTE_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT_SHA="${2:-}"; shift 2 ;;
    --change-type) CHANGE_TYPE="${2:-}"; shift 2 ;;
    --release-dir) RELEASE_DIR="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full SHA"
case "$CHANGE_TYPE" in frontend|backend|deps|schema|uploads|runtime) ;; *) fail "invalid change type" ;; esac
[[ "$CHANGE_TYPE" != "uploads" ]] || fail "uploads releases require a dedicated release procedure"
[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || fail "--release-dir must exist and be absolute"

PROJECT_DIR="$EXPECTED_PROJECT_DIR"
if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
  PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:-$PROJECT_DIR}"
  case "$PROJECT_DIR" in /tmp/*|/private/tmp/*) ;; *) fail "test project must be under /tmp" ;; esac
  case "$RELEASE_DIR" in /tmp/*|/private/tmp/*) ;; *) fail "test release directory must be under /tmp" ;; esac
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
else
  case "$RELEASE_DIR" in "$RELEASE_ROOT"/release-*) ;; *) fail "release directory must be under $RELEASE_ROOT" ;; esac
fi

[[ "$DRY_RUN" == true || "$CONFIRM" == "DEPLOY" ]] || fail "--confirm must exactly equal DEPLOY"
[[ -x "$NODE_COMMAND" ]] || fail "Node 22 unavailable"
MANIFEST="$RELEASE_DIR/release-manifest.json"
[[ -f "$MANIFEST" ]] || fail "release manifest missing"

manifest_value() {
  "$NODE_COMMAND" -e "const m=require(process.argv[1]);const v=m[process.argv[2]];process.stdout.write(typeof v==='string'?v:JSON.stringify(v))" "$MANIFEST" "$1"
}

[[ "$(manifest_value status)" == "prepared" ]] || fail "manifest status must be prepared"
[[ "$(manifest_value targetCommit)" == "$COMMIT_SHA" ]] || fail "manifest targetCommit mismatch"
[[ "$(manifest_value changeType)" == "$CHANGE_TYPE" ]] || fail "manifest changeType mismatch"

BACKUP_PATH="$(manifest_value databaseBackupPath)"
BACKUP_SHA="$(manifest_value databaseBackupSha256)"
[[ -f "$BACKUP_PATH" ]] || fail "release database backup missing"
[[ "$(sqlite3 "$BACKUP_PATH" 'PRAGMA integrity_check;')" == "ok" ]] || fail "release database backup is invalid"
[[ "$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}')" == "$BACKUP_SHA" ]] || fail "release database backup SHA mismatch"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
CLASSIFICATION_JSON="$RELEASE_DIR/checks/release-classification.json"
PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$NODE_COMMAND" "$SCRIPT_DIR/release-classify.sh" \
  --current "$CURRENT_COMMIT" \
  --target "$COMMIT_SHA" \
  --change-type "$CHANGE_TYPE" \
  --format json > "$CLASSIFICATION_JSON"

class_value() {
  "$NODE_COMMAND" -e "const m=require(process.argv[1]);process.stdout.write(String(m[process.argv[2]]))" "$CLASSIFICATION_JSON" "$1"
}

REQUIRES_NPM_CI="$(class_value requiresNpmCi)"
REQUIRES_CLIENT_RESTART="$(class_value requiresClientRestart)"
REQUIRES_SERVER_RESTART="$(class_value requiresServerRestart)"
REQUIRES_MIGRATION_PREVIEW="$(class_value requiresMigrationPreview)"
NO_OP="$(class_value noOp)"

if [[ "$REQUIRES_MIGRATION_PREVIEW" == "true" ]]; then
  PREVIEW_RESULT="$RELEASE_DIR/checks/migration-preview.json"
  [[ -f "$PREVIEW_RESULT" ]] || fail "migration preview result missing"
  [[ "$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(String(m.success===true&&!m.dryRun))' "$PREVIEW_RESULT")" == "true" ]] \
    || fail "migration preview did not pass"
fi

echo "RELEASE_EXECUTE_DRY_RUN=$DRY_RUN"
echo "CURRENT_COMMIT=$CURRENT_COMMIT"
echo "TARGET_COMMIT=$COMMIT_SHA"
echo "CHANGE_TYPE=$CHANGE_TYPE"
echo "NO_OP=$NO_OP"
echo "REQUIRES_NPM_CI=$REQUIRES_NPM_CI"
echo "REQUIRES_CLIENT_RESTART=$REQUIRES_CLIENT_RESTART"
echo "REQUIRES_SERVER_RESTART=$REQUIRES_SERVER_RESTART"
echo "REQUIRES_MIGRATION_PREVIEW=$REQUIRES_MIGRATION_PREVIEW"

if [[ "$DRY_RUN" == true ]]; then
  echo "PLANNED_ACTION=release-health-check before"
  [[ "$NO_OP" == "false" ]] && echo "PLANNED_ACTION=git merge --ff-only $COMMIT_SHA"
  [[ "$REQUIRES_NPM_CI" == "true" ]] && echo "PLANNED_ACTION=npm ci with Node 22"
  echo "PLANNED_ACTION=npm run check"
  [[ "$REQUIRES_CLIENT_RESTART" == "true" ]] && echo "PLANNED_ACTION=restart wufan-client"
  [[ "$REQUIRES_SERVER_RESTART" == "true" ]] && echo "PLANNED_ACTION=restart wufan-server"
  echo "PLANNED_ACTION=release-health-check after"
  echo "PLANNED_ACTION=pm2 save after health success"
  echo "PRODUCTION_MODIFIED=false"
  exit 0
fi

update_manifest() {
  status="$1"
  stage="$2"
  message="${3:-}"
  STATUS_VALUE="$status" STAGE_VALUE="$stage" MESSAGE_VALUE="$message" MANIFEST="$MANIFEST" \
    "$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
manifest.status = process.env.STATUS_VALUE;
manifest.updatedAt = new Date().toISOString();
manifest.executionStage = process.env.STAGE_VALUE;
if (process.env.MESSAGE_VALUE) manifest.executionMessage = process.env.MESSAGE_VALUE;
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

on_error() {
  code=$?
  command="${BASH_COMMAND:-unknown}"
  trap - ERR
  update_manifest failed "$STAGE" "exit=$code command=$command" || true
  {
    echo "Release stopped at stage: $STAGE"
    echo "No automatic git reset or database restore was attempted."
    case "$STAGE" in
      preflight|health-before)
        echo "Production source was not updated; no rollback is required."
        ;;
      git-update|dependencies|code-check)
        echo "Review a forward revert commit or a controlled previous-release switch before any migration or writes."
        ;;
      *)
        echo "The backend may have started and migrations may have run. Preserve the current database and assess production writes before choosing a forward fix or manual restore."
        ;;
    esac
  } | tee -a "$RELEASE_DIR/logs/release-execute.log" >&2
  exit "$code"
}
trap on_error ERR

STAGE="preflight"
"$SCRIPT_DIR/release-preflight.sh" --commit "$COMMIT_SHA" --change-type "$CHANGE_TYPE" \
  > "$RELEASE_DIR/checks/preflight-execute.txt"

STAGE="health-before"
"$SCRIPT_DIR/release-health-check.sh" --commit "$COMMIT_SHA" --release-dir "$RELEASE_DIR" --phase before

update_manifest deploying "$STAGE"

STAGE="git-update"
cd "$PROJECT_DIR"
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
[[ "$(git rev-parse origin/main)" == "$COMMIT_SHA" ]]
git merge-base --is-ancestor HEAD "$COMMIT_SHA"
if [[ "$NO_OP" == "false" ]]; then
  git merge --ff-only "$COMMIT_SHA"
fi
[[ "$(git rev-parse HEAD)" == "$COMMIT_SHA" ]]

export PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin"
if [[ "$REQUIRES_NPM_CI" == "true" ]]; then
  STAGE="dependencies"
  "$NODE22_BIN/npm" ci --no-audit --no-fund
  "$NODE22_BIN/npm" ls --depth=0
  "$NODE22_BIN/node" -e "require('better-sqlite3'); console.log('better-sqlite3 ok')"
fi

STAGE="code-check"
"$NODE22_BIN/npm" run check

STAGE="service-restart"
if [[ "$REQUIRES_CLIENT_RESTART" == "true" ]]; then
  pm2 restart wufan-client
fi
if [[ "$REQUIRES_SERVER_RESTART" == "true" ]]; then
  pm2 restart wufan-server
fi

STAGE="service-stabilization"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error http://127.0.0.1:3001/api/health >/dev/null; then
    break
  fi
  [[ "$attempt" -lt 10 ]]
  sleep 2
done

STAGE="health-after"
"$SCRIPT_DIR/release-health-check.sh" --commit "$COMMIT_SHA" --release-dir "$RELEASE_DIR" --phase after
[[ "$(sqlite3 "file:$PROJECT_DIR/data/workstation.db?mode=ro" 'PRAGMA integrity_check;')" == "ok" ]]

STAGE="pm2-snapshot-after"
PM2_JSON="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" pm2 jlist)"
PM2_JSON="$PM2_JSON" OUTPUT_PATH="$RELEASE_DIR/pm2/jlist-after.json" \
  "$NODE22_BIN/node" <<'NODE'
const fs = require("fs");
const apps = JSON.parse(process.env.PM2_JSON);
const safe = apps.filter((app) => ["wufan-client", "wufan-server"].includes(app.name)).map((app) => ({
  name: app.name,
  pid: app.pid,
  status: app.pm2_env?.status,
  cwd: app.pm2_env?.pm_cwd,
  uptime: app.pm2_env?.pm_uptime,
  restartCount: app.pm2_env?.restart_time,
}));
fs.writeFileSync(process.env.OUTPUT_PATH, `${JSON.stringify(safe, null, 2)}\n`);
NODE

STAGE="manifest-finalize"
FINAL_COMMIT="$(git rev-parse HEAD)" PM2_AFTER="$RELEASE_DIR/pm2/jlist-after.json" MANIFEST="$MANIFEST" \
  "$NODE22_BIN/node" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
manifest.status = "deployed";
manifest.completedAt = new Date().toISOString();
manifest.finalCommit = process.env.FINAL_COMMIT;
manifest.serviceStatusAfter = JSON.parse(fs.readFileSync(process.env.PM2_AFTER, "utf8"));
manifest.executionStage = "completed";
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

STAGE="pm2-save"
pm2 save
trap - ERR
echo "RELEASE_DEPLOYED=true"
echo "FINAL_COMMIT=$(git rev-parse HEAD)"
