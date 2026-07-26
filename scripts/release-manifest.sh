#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

COMMIT_SHA=""
CHANGE_TYPE=""
RELEASE_DIR=""
STATUS="prepared"
DRY_RUN="false"
BUNDLE_PATH=""

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
    --bundle)
      [[ $# -ge 2 ]] || fail "--bundle requires a value"
      BUNDLE_PATH="$2"
      shift 2
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

CLASSIFICATION="$(
  PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$NODE_COMMAND" \
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-classify.sh" \
      --current "$CURRENT_COMMIT" \
      --target "$COMMIT_SHA" \
      --change-type "$CHANGE_TYPE"
)"
classification_value() {
  printf '%s\n' "$CLASSIFICATION" | awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
}
PACKAGE_JSON_CHANGED="$(classification_value PACKAGE_JSON_CHANGED)"
PACKAGE_LOCK_CHANGED="$(classification_value PACKAGE_LOCK_CHANGED)"
FRONTEND_CHANGED="$(classification_value FRONTEND_CHANGED)"
BACKEND_CHANGED="$(classification_value BACKEND_CHANGED)"
SCHEMA_CHANGED="$(classification_value SCHEMA_CHANGED)"
MIGRATION_CODE_CHANGED="$(classification_value MIGRATION_CODE_CHANGED)"
UPLOADS_RELATED_CHANGED="$(classification_value UPLOADS_RELATED_CHANGED)"
REQUIRES_NPM_CI="$(classification_value REQUIRES_NPM_CI)"
REQUIRES_CLIENT_RESTART="$(classification_value REQUIRES_CLIENT_RESTART)"
REQUIRES_SERVER_RESTART="$(classification_value REQUIRES_SERVER_RESTART)"
REQUIRES_MIGRATION_PREVIEW="$(classification_value REQUIRES_MIGRATION_PREVIEW)"
REQUIRES_UPLOADS_BACKUP="$(classification_value REQUIRES_UPLOADS_BACKUP)"
NO_OP="$(classification_value NO_OP)"

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
SOURCE_MODE="online"
BUNDLE_SHA256=""
BUNDLE_VERIFIED="false"
BUNDLE_TARGET_COMMIT=""
if [[ -n "$BUNDLE_PATH" ]]; then
  [[ "$BUNDLE_PATH" == /* && -s "$BUNDLE_PATH" ]] || fail "--bundle must be an absolute, non-empty file"
  git -C "$PROJECT_DIR" bundle verify "$BUNDLE_PATH" >/dev/null 2>&1 \
    || fail "git bundle verification failed"
  SOURCE_MODE="offline-bundle"
  BUNDLE_SHA256="$(shasum -a 256 "$BUNDLE_PATH" | awk '{print $1}')"
  BUNDLE_VERIFIED="true"
  BUNDLE_TARGET_COMMIT="$COMMIT_SHA"
fi

export RELEASE_ID="$(basename "$RELEASE_DIR")"
export CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
export MANIFEST_STATUS="$STATUS"
export OPERATOR="$(id -un)"
export RELEASE_HOSTNAME="$(hostname)"
export PROJECT_DIR CURRENT_COMMIT COMMIT_SHA CHANGE_TYPE CURRENT_MESSAGE TARGET_MESSAGE COMMITS_AHEAD
export PACKAGE_JSON_CHANGED PACKAGE_LOCK_CHANGED FRONTEND_CHANGED BACKEND_CHANGED
export SCHEMA_CHANGED MIGRATION_CODE_CHANGED UPLOADS_RELATED_CHANGED NO_OP
export NODE_VERSION NPM_VERSION PM2_VERSION DATABASE_PATH DATABASE_SIZE DATABASE_SHA256
export DATABASE_BACKUP_PATH DATABASE_BACKUP_SHA256 DATABASE_INTEGRITY DISK_FREE_BEFORE
export REQUIRES_NPM_CI REQUIRES_CLIENT_RESTART REQUIRES_SERVER_RESTART
export REQUIRES_MIGRATION_PREVIEW REQUIRES_UPLOADS_BACKUP DRY_RUN RELEASE_DIR
export SOURCE_MODE BUNDLE_SHA256 BUNDLE_VERIFIED BUNDLE_TARGET_COMMIT

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
  frontendChanged: bool("FRONTEND_CHANGED"),
  backendChanged: bool("BACKEND_CHANGED"),
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
  noOp: bool("NO_OP"),
  dryRun: bool("DRY_RUN"),
  manualBrowserVerificationRequired: true,
  sourceMode: process.env.SOURCE_MODE,
  bundleSha256: process.env.BUNDLE_SHA256,
  bundleVerified: bool("BUNDLE_VERIFIED"),
  bundleTargetCommit: process.env.BUNDLE_TARGET_COMMIT,
};
fs.writeFileSync(
  path.join(process.env.RELEASE_DIR, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
NODE

echo "MANIFEST_PATH=$RELEASE_DIR/release-manifest.json"
