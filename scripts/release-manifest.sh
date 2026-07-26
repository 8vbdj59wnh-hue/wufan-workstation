#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

COMMIT_SHA=""
CHANGE_TYPE=""
RELEASE_DIR=""
STATUS="prepared"
DRY_RUN="false"

fail() {
  echo "MANIFEST_FAIL: $*" >&2
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
    --release-dir)
      [[ $# -ge 2 ]] || fail "--release-dir requires a value"
      RELEASE_DIR="$2"
      shift 2
      ;;
    --status)
      [[ $# -ge 2 ]] || fail "--status requires a value"
      STATUS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full 40-character Git SHA"
is_valid_change_type "$CHANGE_TYPE" || fail "invalid --change-type: $CHANGE_TYPE"
[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || fail "release directory must exist and be absolute"
case "$STATUS" in prepared|failed) ;; *) fail "status must be prepared or failed" ;; esac

if [[ -n "${RELEASE_TEST_PROJECT_DIR:-}" ]]; then
  [[ "${RELEASE_TEST_MODE:-}" == "1" && "$DRY_RUN" == "true" ]] || fail "test mode requires --dry-run"
  PROJECT_DIR="$RELEASE_TEST_PROJECT_DIR"
  DATABASE_PATH="${RELEASE_TEST_DATABASE_PATH:-$PROJECT_DIR/data/workstation.db}"
  NODE_COMMAND="$(command -v node || true)"
else
  PROJECT_DIR="$EXPECTED_PROJECT_DIR"
  DATABASE_PATH="$PROJECT_DIR/data/workstation.db"
  NODE_COMMAND="$NODE22_BIN/node"
fi

[[ -x "$NODE_COMMAND" ]] || fail "Node command unavailable: $NODE_COMMAND"
[[ -d "$PROJECT_DIR/.git" ]] || fail "Git repository not found: $PROJECT_DIR"
[[ -f "$DATABASE_PATH" ]] || fail "database not found: $DATABASE_PATH"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
CURRENT_MESSAGE="$(git -C "$PROJECT_DIR" log -1 --format=%s "$CURRENT_COMMIT")"
TARGET_MESSAGE="$(git -C "$PROJECT_DIR" log -1 --format=%s "$COMMIT_SHA")"
COMMITS_AHEAD="$(git -C "$PROJECT_DIR" rev-list --count "$CURRENT_COMMIT..$COMMIT_SHA")"
CHANGED_FILES_PATH="$RELEASE_DIR/git/changed-files.txt"
[[ -f "$CHANGED_FILES_PATH" ]] || git -C "$PROJECT_DIR" diff --name-only "$CURRENT_COMMIT" "$COMMIT_SHA" > "$CHANGED_FILES_PATH"

PACKAGE_JSON_CHANGED="false"
PACKAGE_LOCK_CHANGED="false"
SCHEMA_CHANGED="false"
MIGRATION_CODE_CHANGED="false"
UPLOADS_RELATED_CHANGED="false"
grep -Fxq "package.json" "$CHANGED_FILES_PATH" && PACKAGE_JSON_CHANGED="true"
grep -Fxq "package-lock.json" "$CHANGED_FILES_PATH" && PACKAGE_LOCK_CHANGED="true"
grep -Fxq "server/schema.sql" "$CHANGED_FILES_PATH" && SCHEMA_CHANGED="true"
grep -Fxq "server/db.js" "$CHANGED_FILES_PATH" && MIGRATION_CODE_CHANGED="true"
grep -Eiq '(^|/)(uploads?|upload)(/|[-_.]|$)|server/index\.js' "$CHANGED_FILES_PATH" && UPLOADS_RELATED_CHANGED="true"

REQUIRES_NPM_CI="false"
REQUIRES_CLIENT_RESTART="false"
REQUIRES_SERVER_RESTART="false"
REQUIRES_MIGRATION_PREVIEW="false"
REQUIRES_UPLOADS_BACKUP="false"

if [[ "$CHANGE_TYPE" == "deps" || "$CHANGE_TYPE" == "runtime" || "$PACKAGE_JSON_CHANGED" == "true" || "$PACKAGE_LOCK_CHANGED" == "true" ]]; then
  REQUIRES_NPM_CI="true"
fi
if [[ "$CHANGE_TYPE" == "frontend" || "$CHANGE_TYPE" == "deps" || "$CHANGE_TYPE" == "runtime" ]]; then
  REQUIRES_CLIENT_RESTART="true"
fi
if [[ "$CHANGE_TYPE" == "backend" || "$CHANGE_TYPE" == "deps" || "$CHANGE_TYPE" == "schema" || "$CHANGE_TYPE" == "uploads" || "$CHANGE_TYPE" == "runtime" ]]; then
  REQUIRES_SERVER_RESTART="true"
fi
if [[ "$CHANGE_TYPE" == "schema" || "$SCHEMA_CHANGED" == "true" || "$MIGRATION_CODE_CHANGED" == "true" ]]; then
  REQUIRES_MIGRATION_PREVIEW="true"
fi
if [[ "$CHANGE_TYPE" == "uploads" || "$UPLOADS_RELATED_CHANGED" == "true" ]]; then
  REQUIRES_UPLOADS_BACKUP="true"
fi

DATABASE_SIZE="$(stat -f '%z' "$DATABASE_PATH")"
DATABASE_SHA256="$(shasum -a 256 "$DATABASE_PATH" | awk '{print $1}')"
DATABASE_INTEGRITY="$(sqlite3 "file:$DATABASE_PATH?mode=ro" "PRAGMA integrity_check;")"
DATABASE_BACKUP_PATH="$(find "$RELEASE_DIR/database" -maxdepth 1 -type f -name 'workstation-before-*.db' -print 2>/dev/null | head -n 1)"
DATABASE_BACKUP_SHA256=""
if [[ -n "$DATABASE_BACKUP_PATH" ]]; then
  DATABASE_BACKUP_SHA256="$(shasum -a 256 "$DATABASE_BACKUP_PATH" | awk '{print $1}')"
elif [[ -f "$RELEASE_DIR/checks/database-backup.txt" ]]; then
  DATABASE_BACKUP_PATH="$(awk -F= '/^DATABASE_BACKUP_PLANNED=/ { sub(/^[^=]*=/, ""); print; exit }' "$RELEASE_DIR/checks/database-backup.txt")"
fi

NODE_VERSION="$("$NODE_COMMAND" --version)"
if [[ -x "$NODE22_BIN/npm" ]]; then
  NPM_VERSION="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" "$NODE22_BIN/npm" --version)"
  PM2_VERSION="$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" pm2 --version)"
else
  NPM_VERSION="$(npm --version)"
  PM2_VERSION="${RELEASE_TEST_PM2_VERSION:-test}"
fi
DISK_FREE_BEFORE="$(df -Pk "$PROJECT_DIR" | awk 'NR == 2 { printf "%.0f\n", $4 * 1024 }')"

export RELEASE_ID="$(basename "$RELEASE_DIR")"
export CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
export MANIFEST_STATUS="$STATUS"
export OPERATOR="$(id -un)"
export RELEASE_HOSTNAME="$(hostname)"
export PROJECT_DIR CURRENT_COMMIT COMMIT_SHA CHANGE_TYPE CURRENT_MESSAGE TARGET_MESSAGE COMMITS_AHEAD
export PACKAGE_JSON_CHANGED PACKAGE_LOCK_CHANGED SCHEMA_CHANGED MIGRATION_CODE_CHANGED UPLOADS_RELATED_CHANGED
export NODE_VERSION NPM_VERSION PM2_VERSION DATABASE_PATH DATABASE_SIZE DATABASE_SHA256
export DATABASE_BACKUP_PATH DATABASE_BACKUP_SHA256 DATABASE_INTEGRITY DISK_FREE_BEFORE
export REQUIRES_NPM_CI REQUIRES_CLIENT_RESTART REQUIRES_SERVER_RESTART
export REQUIRES_MIGRATION_PREVIEW REQUIRES_UPLOADS_BACKUP DRY_RUN RELEASE_DIR

"$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const path = require("path");

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const bool = (name) => process.env[name] === "true";
const changedFiles = fs
  .readFileSync(path.join(process.env.RELEASE_DIR, "git", "changed-files.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const manifest = {
  releaseId: process.env.RELEASE_ID,
  createdAt: process.env.CREATED_AT,
  status: process.env.MANIFEST_STATUS,
  operator: process.env.OPERATOR,
  hostname: process.env.RELEASE_HOSTNAME,
  projectPath: process.env.PROJECT_DIR,
  branch: "main",
  currentCommit: process.env.CURRENT_COMMIT,
  targetCommit: process.env.COMMIT_SHA,
  changeType: process.env.CHANGE_TYPE,
  currentCommitMessage: process.env.CURRENT_MESSAGE,
  targetCommitMessage: process.env.TARGET_MESSAGE,
  commitsAhead: Number(process.env.COMMITS_AHEAD),
  changedFiles,
  packageJsonChanged: bool("PACKAGE_JSON_CHANGED"),
  packageLockChanged: bool("PACKAGE_LOCK_CHANGED"),
  schemaChanged: bool("SCHEMA_CHANGED"),
  migrationCodeChanged: bool("MIGRATION_CODE_CHANGED"),
  uploadsRelatedChanged: bool("UPLOADS_RELATED_CHANGED"),
  nodeVersion: process.env.NODE_VERSION,
  npmVersion: process.env.NPM_VERSION,
  pm2Version: process.env.PM2_VERSION,
  databasePath: process.env.DATABASE_PATH,
  databaseSize: Number(process.env.DATABASE_SIZE),
  databaseSha256: process.env.DATABASE_SHA256,
  databaseBackupPath: process.env.DATABASE_BACKUP_PATH,
  databaseBackupSha256: process.env.DATABASE_BACKUP_SHA256,
  databaseIntegrity: process.env.DATABASE_INTEGRITY,
  diskFreeBefore: Number(process.env.DISK_FREE_BEFORE),
  serviceStatusBefore: readJson(path.join(process.env.RELEASE_DIR, "pm2", "jlist.json"), []),
  healthBefore: readJson(path.join(process.env.RELEASE_DIR, "checks", "health-before.json"), {}),
  requiresNpmCi: bool("REQUIRES_NPM_CI"),
  requiresClientRestart: bool("REQUIRES_CLIENT_RESTART"),
  requiresServerRestart: bool("REQUIRES_SERVER_RESTART"),
  requiresMigrationPreview: bool("REQUIRES_MIGRATION_PREVIEW"),
  requiresUploadsBackup: bool("REQUIRES_UPLOADS_BACKUP"),
  dryRun: bool("DRY_RUN"),
};
fs.writeFileSync(
  path.join(process.env.RELEASE_DIR, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
NODE

echo "MANIFEST_PATH=$RELEASE_DIR/release-manifest.json"
