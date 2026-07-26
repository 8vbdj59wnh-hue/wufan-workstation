#!/usr/bin/env bash
set -euo pipefail

echo "Deprecated: preflight is now built into scripts/release-from-package.sh." >&2
exit 1

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
EXPECTED_USER="meiyounaichatouyuna"
EXPECTED_HOSTNAME="MacBook-Air-2.local"
EXPECTED_LOCAL_HOSTNAME="MacBook-Air-2"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"
DATABASE_PATH="$EXPECTED_PROJECT_DIR/data/workstation.db"
UPLOADS_PATH="$EXPECTED_PROJECT_DIR/uploads"
MINIMUM_SAFETY_BYTES=$((10 * 1024 * 1024 * 1024))
NPM_TEMP_BYTES=$((2 * 1024 * 1024 * 1024))

COMMIT_SHA=""
CHANGE_TYPE=""
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/release-preflight.sh --commit <40-character-sha> \
    --change-type <frontend|backend|deps|schema|uploads|runtime> [--dry-run]

This command only inspects release readiness. It never updates the worktree,
installs dependencies, restarts services, changes the database, or creates tags.
USAGE
}

fail() {
  echo "PREFLIGHT_FAIL: $*" >&2
  exit 1
}

is_valid_change_type() {
  case "$1" in
    frontend|backend|deps|schema|uploads|runtime) return 0 ;;
    *) return 1 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      [[ $# -ge 2 ]] || fail "--commit requires a value"
      COMMIT_SHA="$2"
      shift 2
      ;;
    --change-type)
      [[ $# -ge 2 ]] || fail "--change-type requires a value"
      CHANGE_TYPE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full 40-character Git SHA"
is_valid_change_type "$CHANGE_TYPE" || fail "invalid --change-type: $CHANGE_TYPE"

if [[ -n "${RELEASE_TEST_PROJECT_DIR:-}" ]]; then
  [[ "${RELEASE_TEST_MODE:-}" == "1" ]] || fail "RELEASE_TEST_PROJECT_DIR requires RELEASE_TEST_MODE=1"
  [[ "$DRY_RUN" == "true" ]] || fail "test mode is allowed only with --dry-run"
  case "$RELEASE_TEST_PROJECT_DIR" in
    /tmp/*|/private/tmp/*) ;;
    *) fail "test project must be under /tmp" ;;
  esac
  PROJECT_DIR="$RELEASE_TEST_PROJECT_DIR"
  DATABASE_PATH="${RELEASE_TEST_DATABASE_PATH:-$PROJECT_DIR/data/workstation.db}"
  UPLOADS_PATH="${RELEASE_TEST_UPLOADS_PATH:-$PROJECT_DIR/uploads}"
else
  PROJECT_DIR="$EXPECTED_PROJECT_DIR"
  [[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "must run as $EXPECTED_USER on Server-01"
  current_hostname="$(hostname)"
  current_local_hostname="$(scutil --get LocalHostName 2>/dev/null || true)"
  if [[ "$current_hostname" != "$EXPECTED_HOSTNAME" && "$current_local_hostname" != "$EXPECTED_LOCAL_HOSTNAME" ]]; then
    fail "must run on Server-01; hostname was $current_hostname"
  fi
fi

[[ -d "$PROJECT_DIR/.git" ]] || fail "Git repository not found: $PROJECT_DIR"
cd "$PROJECT_DIR"
[[ "$(pwd -P)" == "$PROJECT_DIR" ]] || fail "resolved project path is not $PROJECT_DIR"
[[ "$(git branch --show-current)" == "main" ]] || fail "current branch must be main"
git diff --quiet || fail "worktree contains unstaged changes"
git diff --cached --quiet || fail "index contains staged changes"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "worktree contains untracked or modified files"

CURRENT_COMMIT="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git ls-remote origin refs/heads/main | awk 'NR == 1 { print $1 }')"
[[ -n "$REMOTE_MAIN" ]] || fail "cannot resolve remote main"
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main

NO_OP="false"
if [[ "$REMOTE_MAIN" != "$COMMIT_SHA" ]]; then
  if [[ "$DRY_RUN" == "true" && "$CURRENT_COMMIT" == "$COMMIT_SHA" ]] \
    && git merge-base --is-ancestor "$COMMIT_SHA" origin/main; then
    NO_OP="true"
  else
    fail "target commit must equal remote main HEAD ($REMOTE_MAIN)"
  fi
else
  [[ "$(git rev-parse origin/main)" == "$COMMIT_SHA" ]] || fail "fetched origin/main does not equal target commit"
fi

git cat-file -e "$COMMIT_SHA^{commit}" || fail "target commit is not a commit object"
git merge-base --is-ancestor "$CURRENT_COMMIT" "$COMMIT_SHA" || fail "current HEAD is not an ancestor of target commit"

[[ -f "$DATABASE_PATH" ]] || fail "database not found: $DATABASE_PATH"
DATABASE_INTEGRITY="$(sqlite3 "file:$DATABASE_PATH?mode=ro" "PRAGMA integrity_check;")"
[[ "$DATABASE_INTEGRITY" == "ok" ]] || fail "database integrity_check failed: $DATABASE_INTEGRITY"
DATABASE_SIZE="$(stat -f '%z' "$DATABASE_PATH")"
DATABASE_MTIME_EPOCH="$(stat -f '%m' "$DATABASE_PATH")"
DATABASE_MTIME="$(date -r "$DATABASE_MTIME_EPOCH" '+%Y-%m-%dT%H:%M:%S%z')"
DATABASE_SHA256="$(shasum -a 256 "$DATABASE_PATH" | awk '{print $1}')"

[[ -x "$NODE22_BIN/node" ]] || fail "Node 22 is not available at $NODE22_BIN/node"
[[ -x "$NODE22_BIN/npm" ]] || fail "npm for Node 22 is not available at $NODE22_BIN/npm"
NODE_VERSION="$("$NODE22_BIN/node" --version)"
NPM_VERSION="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" "$NODE22_BIN/npm" --version)"
PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" "$NODE22_BIN/node" \
  -e "require('better-sqlite3'); process.stdout.write('ok')" >/dev/null

for port in 5173 3001; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || fail "port $port has no listening process"
done

PM2_JSON="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" pm2 jlist)"
PM2_SUMMARY="$(PROJECT_DIR="$PROJECT_DIR" PM2_JSON="$PM2_JSON" "$NODE22_BIN/node" <<'NODE'
const apps = JSON.parse(process.env.PM2_JSON);
const expected = ["wufan-client", "wufan-server"];
const summary = [];
for (const name of expected) {
  const app = apps.find((item) => item.name === name);
  if (!app) throw new Error(`PM2 app missing: ${name}`);
  if (app.pm2_env?.status !== "online") throw new Error(`PM2 app is not online: ${name}`);
  if (app.pm2_env?.pm_cwd !== process.env.PROJECT_DIR) {
    throw new Error(`PM2 cwd mismatch for ${name}: ${app.pm2_env?.pm_cwd ?? "missing"}`);
  }
  summary.push(`${name}=${app.pm2_env.status}|pid=${app.pid}|cwd=${app.pm2_env.pm_cwd}`);
}
process.stdout.write(summary.join("\n"));
NODE
)"

HEALTH_JSON="$(curl --fail --silent --show-error http://127.0.0.1:3001/api/health)"
HEALTH_JSON="$HEALTH_JSON" "$NODE22_BIN/node" <<'NODE'
const health = JSON.parse(process.env.HEALTH_JSON);
if (health.ok !== true) throw new Error("health endpoint did not return ok:true");
NODE

DISK_FREE_BYTES="$(df -Pk "$PROJECT_DIR" | awk 'NR == 2 { printf "%.0f\n", $4 * 1024 }')"
UPLOADS_BACKUP_BYTES=0
if [[ "$CHANGE_TYPE" == "uploads" ]]; then
  [[ -d "$UPLOADS_PATH" ]] || fail "uploads directory not found: $UPLOADS_PATH"
  UPLOADS_BACKUP_BYTES="$(du -sk "$UPLOADS_PATH" | awk '{ printf "%.0f\n", $1 * 1024 }')"
fi
REQUIRED_FREE_BYTES=$((DATABASE_SIZE + NPM_TEMP_BYTES + MINIMUM_SAFETY_BYTES + UPLOADS_BACKUP_BYTES))
[[ "$DISK_FREE_BYTES" -gt "$REQUIRED_FREE_BYTES" ]] || {
  fail "insufficient disk space: free=$DISK_FREE_BYTES required>$REQUIRED_FREE_BYTES"
}

COMMITS_AHEAD="$(git rev-list --count "$CURRENT_COMMIT..$COMMIT_SHA")"
CHANGED_FILES_COUNT="$(git diff --name-only "$CURRENT_COMMIT" "$COMMIT_SHA" | wc -l | tr -d ' ')"
CHANGED_FILES="$(git diff --name-only "$CURRENT_COMMIT" "$COMMIT_SHA")"

CLASSIFICATION="$(
  PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$NODE22_BIN/node" \
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-classify.sh" \
      --current "$CURRENT_COMMIT" \
      --target "$COMMIT_SHA" \
      --change-type "$CHANGE_TYPE"
)"
classification_value() {
  printf '%s\n' "$CLASSIFICATION" | awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
}
REQUIRES_NPM_CI="$(classification_value REQUIRES_NPM_CI)"
REQUIRES_CLIENT_RESTART="$(classification_value REQUIRES_CLIENT_RESTART)"
REQUIRES_SERVER_RESTART="$(classification_value REQUIRES_SERVER_RESTART)"
REQUIRES_MIGRATION_PREVIEW="$(classification_value REQUIRES_MIGRATION_PREVIEW)"
REQUIRES_UPLOADS_BACKUP="$(classification_value REQUIRES_UPLOADS_BACKUP)"
if [[ "$NO_OP" == "true" ]]; then
  REQUIRES_NPM_CI="false"
  REQUIRES_CLIENT_RESTART="false"
  REQUIRES_SERVER_RESTART="false"
  REQUIRES_MIGRATION_PREVIEW="false"
  REQUIRES_UPLOADS_BACKUP="false"
fi

echo "PREFLIGHT_OK=true"
echo "DRY_RUN=$DRY_RUN"
echo "PROJECT_DIR=$PROJECT_DIR"
echo "CURRENT_COMMIT=$CURRENT_COMMIT"
echo "TARGET_COMMIT=$COMMIT_SHA"
echo "REMOTE_MAIN=$REMOTE_MAIN"
echo "NO_OP=$NO_OP"
echo "CHANGE_TYPE=$CHANGE_TYPE"
echo "COMMITS_AHEAD=$COMMITS_AHEAD"
echo "CHANGED_FILES_COUNT=$CHANGED_FILES_COUNT"
echo "DATABASE_PATH=$DATABASE_PATH"
echo "DATABASE_SIZE=$DATABASE_SIZE"
echo "DATABASE_MTIME=$DATABASE_MTIME"
echo "DATABASE_SHA256=$DATABASE_SHA256"
echo "DATABASE_INTEGRITY=$DATABASE_INTEGRITY"
echo "NODE_VERSION=$NODE_VERSION"
echo "NPM_VERSION=$NPM_VERSION"
echo "DISK_FREE_BYTES=$DISK_FREE_BYTES"
echo "REQUIRED_FREE_BYTES=$REQUIRED_FREE_BYTES"
echo "UPLOADS_BACKUP_BYTES=$UPLOADS_BACKUP_BYTES"
echo "REQUIRES_NPM_CI=$REQUIRES_NPM_CI"
echo "REQUIRES_CLIENT_RESTART=$REQUIRES_CLIENT_RESTART"
echo "REQUIRES_SERVER_RESTART=$REQUIRES_SERVER_RESTART"
echo "REQUIRES_MIGRATION_PREVIEW=$REQUIRES_MIGRATION_PREVIEW"
echo "REQUIRES_UPLOADS_BACKUP=$REQUIRES_UPLOADS_BACKUP"
echo "PM2_SERVICES_OK=true"
printf '%s\n' "$PM2_SUMMARY"
echo "HEALTH_OK=true"
echo "HEALTH_JSON=$HEALTH_JSON"
while IFS= read -r changed_file; do
  [[ -n "$changed_file" ]] && echo "CHANGED_FILE=$changed_file"
done <<< "$CHANGED_FILES"
echo "CAN_PREPARE=true"
