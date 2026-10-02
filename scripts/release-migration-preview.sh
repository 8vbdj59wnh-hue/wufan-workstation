#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/production-paths.sh"
source "$SCRIPT_DIR/lib/node-runtime.sh"
wufan_load_production_paths

EXPECTED_PROJECT_DIR="${WUFAN_PROJECT_DIR:?WUFAN_PROJECT_DIR is required}"
RELEASE_ROOT="${WUFAN_RELEASE_ROOT:?WUFAN_RELEASE_ROOT is required}"

COMMIT_SHA=""
RELEASE_DIR=""
DRY_RUN=false

fail() {
  echo "MIGRATION_PREVIEW_FAIL: $*" >&2
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
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full SHA"
[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || fail "--release-dir must be an existing absolute directory"

PROJECT_DIR="$EXPECTED_PROJECT_DIR"
if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
  PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:-$PROJECT_DIR}"
  case "$PROJECT_DIR" in /tmp/*|/private/tmp/*) ;; *) fail "test project must be under /tmp" ;; esac
  case "$RELEASE_DIR" in /tmp/*|/private/tmp/*) ;; *) fail "test release directory must be under /tmp" ;; esac
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
else
  case "$RELEASE_DIR" in "$RELEASE_ROOT"/release-*) ;; *) fail "release directory must be under $RELEASE_ROOT" ;; esac
  wufan_resolve_node_runtime
fi

[[ -x "$NODE_COMMAND" ]] || fail "Node 22 is unavailable"
[[ -d "$PROJECT_DIR/.git" ]] || fail "project repository is unavailable"
git -C "$PROJECT_DIR" cat-file -e "$COMMIT_SHA^{commit}"

MANIFEST="$RELEASE_DIR/release-manifest.json"
[[ -f "$MANIFEST" ]] || fail "release manifest is missing"
MANIFEST_TARGET="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.targetCommit)' "$MANIFEST")"
MANIFEST_STATUS="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.status)' "$MANIFEST")"
REQUIRES_PREVIEW="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(String(m.requiresMigrationPreview===true))' "$MANIFEST")"
[[ "$MANIFEST_TARGET" == "$COMMIT_SHA" ]] || fail "manifest targetCommit mismatch"
[[ "$MANIFEST_STATUS" == "prepared" ]] || fail "manifest must be prepared"

mkdir -p "$RELEASE_DIR/checks" "$RELEASE_DIR/logs"
RESULT_PATH="$RELEASE_DIR/checks/migration-preview.json"
LOG_PATH="$RELEASE_DIR/logs/migration-preview.log"
: > "$LOG_PATH"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_PATH"
}

if [[ "$REQUIRES_PREVIEW" != "true" ]]; then
  printf '%s\n' "{\"required\":false,\"dryRun\":$DRY_RUN,\"success\":true,\"skipped\":true}" > "$RESULT_PATH"
  log "migration preview is not required"
  exit 0
fi

BACKUP_PATH="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.databaseBackupPath||"")' "$MANIFEST")"

if [[ "$DRY_RUN" == true ]]; then
  export RESULT_PATH COMMIT_SHA BACKUP_PATH
  "$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const result = {
  required: true,
  dryRun: true,
  success: true,
  skipped: true,
  targetCommit: process.env.COMMIT_SHA,
  databaseBackupPath: process.env.BACKUP_PATH,
  plannedDatabasePath: "checks/migration-preview.db",
  sourceDatabaseOpened: false,
};
fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
NODE
  log "dry-run: migration preview would run against a copy of $BACKUP_PATH"
  exit 0
fi

[[ -f "$BACKUP_PATH" ]] || fail "database backup is missing: $BACKUP_PATH"
[[ "$(sqlite3 "$BACKUP_PATH" 'PRAGMA integrity_check;')" == "ok" ]] || fail "backup integrity check failed"

PREVIEW_DB="$RELEASE_DIR/checks/migration-preview.db"
TARGET_SOURCE="$RELEASE_DIR/checks/target-source"
SCHEMA_BEFORE="$RELEASE_DIR/checks/schema-before.sql"
SCHEMA_AFTER_FIRST="$RELEASE_DIR/checks/schema-after-first.sql"
SCHEMA_AFTER_SECOND="$RELEASE_DIR/checks/schema-after-second.sql"
SCHEMA_DIFF="$RELEASE_DIR/checks/schema-diff.txt"

[[ ! -e "$PREVIEW_DB" ]] || fail "migration preview database already exists"
[[ ! -e "$TARGET_SOURCE" ]] || fail "migration target source already exists"

sqlite3 "$BACKUP_PATH" ".backup '$PREVIEW_DB'"
sqlite3 "$PREVIEW_DB" ".schema" > "$SCHEMA_BEFORE"
mkdir "$TARGET_SOURCE"
git -C "$PROJECT_DIR" archive "$COMMIT_SHA" | tar -x -C "$TARGET_SOURCE"
ln -s "$PROJECT_DIR/node_modules" "$TARGET_SOURCE/node_modules"

BACKUP_SHA_BEFORE="$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}')"
BACKUP_SIZE_BEFORE="$(stat -f '%z' "$BACKUP_PATH")"
BACKUP_INODE_BEFORE="$(stat -f '%i' "$BACKUP_PATH")"

RESOLVED_DATABASE_PATH="$(
  cd "$TARGET_SOURCE"
  WUFAN_ENV=migration-preview \
    WUFAN_DB_PATH="$PREVIEW_DB" \
    WUFAN_ISOLATION_DATABASE_ROOT="$RELEASE_DIR/checks" \
    WUFAN_MIGRATION_PREVIEW=1 \
    "$NODE_COMMAND" --input-type=module --eval \
      'const {databasePath}=await import("./server/db.js");process.stdout.write(databasePath)'
)"
[[ "$RESOLVED_DATABASE_PATH" == "$PREVIEW_DB" ]] \
  || fail "target commit resolved the wrong isolated database path: $RESOLVED_DATABASE_PATH"

INTEGRITY_BEFORE="$(sqlite3 "$PREVIEW_DB" 'PRAGMA integrity_check;')"
TABLES_BEFORE="$(sqlite3 "$PREVIEW_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
log "integrity before: $INTEGRITY_BEFORE"
log "table count before: $TABLES_BEFORE"

(
  cd "$TARGET_SOURCE"
  WUFAN_ENV=migration-preview WUFAN_DB_PATH="$PREVIEW_DB" \
    WUFAN_ISOLATION_DATABASE_ROOT="$RELEASE_DIR/checks" WUFAN_MIGRATION_PREVIEW=1 \
    "$NODE_COMMAND" scripts/release-migration-runner.mjs
) >> "$LOG_PATH" 2>&1
sqlite3 "$PREVIEW_DB" ".schema" > "$SCHEMA_AFTER_FIRST"
INTEGRITY_AFTER_FIRST="$(sqlite3 "$PREVIEW_DB" 'PRAGMA integrity_check;')"
TABLES_AFTER_FIRST="$(sqlite3 "$PREVIEW_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"

(
  cd "$TARGET_SOURCE"
  WUFAN_ENV=migration-preview WUFAN_DB_PATH="$PREVIEW_DB" \
    WUFAN_ISOLATION_DATABASE_ROOT="$RELEASE_DIR/checks" WUFAN_MIGRATION_PREVIEW=1 \
    "$NODE_COMMAND" scripts/release-migration-runner.mjs
) >> "$LOG_PATH" 2>&1
sqlite3 "$PREVIEW_DB" ".schema" > "$SCHEMA_AFTER_SECOND"
INTEGRITY_AFTER_SECOND="$(sqlite3 "$PREVIEW_DB" 'PRAGMA integrity_check;')"
TABLES_AFTER_SECOND="$(sqlite3 "$PREVIEW_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"

diff -u "$SCHEMA_BEFORE" "$SCHEMA_AFTER_FIRST" > "$SCHEMA_DIFF" || true
IDEMPOTENT=true
if ! cmp -s "$SCHEMA_AFTER_FIRST" "$SCHEMA_AFTER_SECOND"; then
  IDEMPOTENT=false
fi

[[ "$INTEGRITY_BEFORE" == "ok" ]] || fail "preview database was invalid before migration"
[[ "$INTEGRITY_AFTER_FIRST" == "ok" ]] || fail "preview database invalid after first migration"
[[ "$INTEGRITY_AFTER_SECOND" == "ok" ]] || fail "preview database invalid after second migration"
[[ "$IDEMPOTENT" == true ]] || fail "schema changed during the second migration run"

BACKUP_SHA_AFTER="$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}')"
BACKUP_SIZE_AFTER="$(stat -f '%z' "$BACKUP_PATH")"
BACKUP_INODE_AFTER="$(stat -f '%i' "$BACKUP_PATH")"
[[ "$BACKUP_SHA_AFTER" == "$BACKUP_SHA_BEFORE" ]] || fail "source database checksum changed during preview"
[[ "$BACKUP_SIZE_AFTER" == "$BACKUP_SIZE_BEFORE" ]] || fail "source database size changed during preview"
[[ "$BACKUP_INODE_AFTER" == "$BACKUP_INODE_BEFORE" ]] || fail "source database inode changed during preview"

BASIC_QUERY_COUNT="$(sqlite3 "$PREVIEW_DB" 'SELECT COUNT(*) FROM sqlite_master WHERE type="table";')"
export RESULT_PATH COMMIT_SHA BACKUP_PATH PREVIEW_DB
export INTEGRITY_BEFORE INTEGRITY_AFTER_FIRST INTEGRITY_AFTER_SECOND
export TABLES_BEFORE TABLES_AFTER_FIRST TABLES_AFTER_SECOND IDEMPOTENT BASIC_QUERY_COUNT SCHEMA_DIFF
export RESOLVED_DATABASE_PATH BACKUP_SHA_BEFORE BACKUP_SHA_AFTER
export BACKUP_SIZE_BEFORE BACKUP_SIZE_AFTER BACKUP_INODE_BEFORE BACKUP_INODE_AFTER
"$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const result = {
  required: true,
  dryRun: false,
  success: true,
  skipped: false,
  targetCommit: process.env.COMMIT_SHA,
  databaseBackupPath: process.env.BACKUP_PATH,
  previewDatabasePath: process.env.PREVIEW_DB,
  sourceDatabaseOpened: false,
  resolvedDatabasePath: process.env.RESOLVED_DATABASE_PATH,
  sourceDatabaseUnchanged: process.env.BACKUP_SHA_BEFORE === process.env.BACKUP_SHA_AFTER
    && process.env.BACKUP_SIZE_BEFORE === process.env.BACKUP_SIZE_AFTER
    && process.env.BACKUP_INODE_BEFORE === process.env.BACKUP_INODE_AFTER,
  sourceDatabaseSha256Before: process.env.BACKUP_SHA_BEFORE,
  sourceDatabaseSha256After: process.env.BACKUP_SHA_AFTER,
  sourceDatabaseSizeBefore: Number(process.env.BACKUP_SIZE_BEFORE),
  sourceDatabaseSizeAfter: Number(process.env.BACKUP_SIZE_AFTER),
  sourceDatabaseInodeBefore: process.env.BACKUP_INODE_BEFORE,
  sourceDatabaseInodeAfter: process.env.BACKUP_INODE_AFTER,
  integrityBefore: process.env.INTEGRITY_BEFORE,
  integrityAfterFirstRun: process.env.INTEGRITY_AFTER_FIRST,
  integrityAfterSecondRun: process.env.INTEGRITY_AFTER_SECOND,
  tableCountBefore: Number(process.env.TABLES_BEFORE),
  tableCountAfterFirstRun: Number(process.env.TABLES_AFTER_FIRST),
  tableCountAfterSecondRun: Number(process.env.TABLES_AFTER_SECOND),
  schemaDiffPath: process.env.SCHEMA_DIFF,
  idempotent: process.env.IDEMPOTENT === "true",
  basicReadQueryCount: Number(process.env.BASIC_QUERY_COUNT),
};
fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
NODE

log "migration preview passed"
echo "MIGRATION_PREVIEW_RESULT=$RESULT_PATH"
