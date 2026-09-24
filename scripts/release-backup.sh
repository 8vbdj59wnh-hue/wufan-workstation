#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/production-paths.sh"
wufan_load_production_paths

EXPECTED_PROJECT_DIR="${WUFAN_PROJECT_DIR:?WUFAN_PROJECT_DIR is required}"
RELEASE_ROOT="${WUFAN_RELEASE_ROOT:?WUFAN_RELEASE_ROOT is required}"
DATABASE_PATH="${WUFAN_DB_PATH:?WUFAN_DB_PATH is required}"

COMMIT_SHA=""
CHANGE_TYPE=""
RELEASE_DIR=""
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/release-backup.sh --commit <40-character-sha> \
    --change-type <frontend|backend|deps|schema|uploads|runtime> \
    --release-dir <absolute-path> [--dry-run]
USAGE
}

fail() {
  echo "BACKUP_FAIL: $*" >&2
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
[[ "$RELEASE_DIR" == /* ]] || fail "--release-dir must be absolute"

if [[ -n "${RELEASE_TEST_PROJECT_DIR:-}" ]]; then
  [[ "${RELEASE_TEST_MODE:-}" == "1" ]] || fail "test mode requires RELEASE_TEST_MODE=1"
  case "$RELEASE_TEST_PROJECT_DIR" in
    /tmp/*|/private/tmp/*) ;;
    *) fail "test project must be under /tmp" ;;
  esac
  case "$RELEASE_DIR" in
    /tmp/*|/private/tmp/*) ;;
    *) fail "test release directory must be under /tmp" ;;
  esac
  PROJECT_DIR="$RELEASE_TEST_PROJECT_DIR"
  DATABASE_PATH="${RELEASE_TEST_DATABASE_PATH:-$PROJECT_DIR/data/workstation.db}"
else
  PROJECT_DIR="$EXPECTED_PROJECT_DIR"
  case "$RELEASE_DIR" in
    "$RELEASE_ROOT"/release-*) ;;
    /tmp/wufan-release-dry-run.*|/private/tmp/wufan-release-dry-run.*)
      [[ "$DRY_RUN" == "true" ]] || fail "temporary release directories are dry-run only"
      ;;
    *) fail "release directory must be under $RELEASE_ROOT" ;;
  esac
fi

[[ -d "$PROJECT_DIR/.git" ]] || fail "Git repository not found: $PROJECT_DIR"
[[ -f "$DATABASE_PATH" ]] || fail "database not found: $DATABASE_PATH"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
CURRENT_SHORT="${CURRENT_COMMIT:0:8}"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_PATH="$RELEASE_DIR/database/workstation-before-$CURRENT_SHORT-$TIMESTAMP.db"

SOURCE_SIZE="$(stat -f '%z' "$DATABASE_PATH")"
SOURCE_MTIME_EPOCH="$(stat -f '%m' "$DATABASE_PATH")"
SOURCE_MTIME="$(date -r "$SOURCE_MTIME_EPOCH" '+%Y-%m-%dT%H:%M:%S%z')"
SOURCE_SHA256="$(shasum -a 256 "$DATABASE_PATH" | awk '{print $1}')"

echo "SOURCE_DATABASE_PATH=$DATABASE_PATH"
echo "SOURCE_DATABASE_SIZE=$SOURCE_SIZE"
echo "SOURCE_DATABASE_MTIME=$SOURCE_MTIME"
echo "SOURCE_DATABASE_SHA256=$SOURCE_SHA256"

if [[ "$CHANGE_TYPE" == "uploads" ]]; then
  echo "UPLOADS_BACKUP_REQUIRED=true"
  echo "Uploads-related releases require a separately reviewed backup plan." >&2
  echo "No database backup or uploads archive was created." >&2
  exit 3
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN=true"
  echo "DATABASE_BACKUP_PLANNED=$BACKUP_PATH"
  echo "DATABASE_BACKUP_CREATED=false"
  exit 0
fi

[[ -d "$RELEASE_DIR/database" ]] || fail "database directory missing: $RELEASE_DIR/database"
[[ ! -e "$BACKUP_PATH" ]] || fail "backup already exists: $BACKUP_PATH"

sqlite3 "$DATABASE_PATH" ".timeout 5000" ".backup '$BACKUP_PATH'"
[[ -s "$BACKUP_PATH" ]] || fail "SQLite backup is missing or empty"

BACKUP_INTEGRITY="$(sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check;")"
[[ "$BACKUP_INTEGRITY" == "ok" ]] || fail "backup integrity_check failed: $BACKUP_INTEGRITY"
BACKUP_FOREIGN_KEYS="$(sqlite3 "$BACKUP_PATH" "PRAGMA foreign_key_check;")"
[[ -z "$BACKUP_FOREIGN_KEYS" ]] || fail "backup foreign_key_check failed"
BACKUP_SIZE="$(stat -f '%z' "$BACKUP_PATH")"
BACKUP_SHA256="$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}')"
TABLE_COUNT="$(sqlite3 "$BACKUP_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"

echo "DRY_RUN=false"
echo "DATABASE_BACKUP_CREATED=true"
echo "DATABASE_BACKUP_PATH=$BACKUP_PATH"
echo "DATABASE_BACKUP_SIZE=$BACKUP_SIZE"
echo "DATABASE_BACKUP_SHA256=$BACKUP_SHA256"
echo "DATABASE_BACKUP_INTEGRITY=$BACKUP_INTEGRITY"
echo "DATABASE_BACKUP_FOREIGN_KEY_CHECK=ok"
echo "DATABASE_BACKUP_TABLE_COUNT=$TABLE_COUNT"
