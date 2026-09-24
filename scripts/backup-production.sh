#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/production-paths.sh"
wufan_load_production_paths --require-backup-root

export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

PROJECT_DIR="${WUFAN_PROJECT_DIR:?WUFAN_PROJECT_DIR is required}"
BACKUP_ROOT="${WUFAN_BACKUP_ROOT:?WUFAN_BACKUP_ROOT is required}"
DB_SRC="${WUFAN_DB_PATH:?WUFAN_DB_PATH is required}"
UPLOADS_SRC="${WUFAN_UPLOADS_PATH:?WUFAN_UPLOADS_PATH is required}"

TS="$(date +%Y%m%d-%H%M%S)"
DB_DIR="$BACKUP_ROOT/database"
UPLOADS_DIR="$BACKUP_ROOT/uploads"
BUNDLE_DIR="$BACKUP_ROOT/git-bundles"
LOG_DIR="$BACKUP_ROOT/logs"
LOG_FILE="$LOG_DIR/backup.log"

DB_DEST="$DB_DIR/workstation-$TS.db"
UPLOADS_DEST="$UPLOADS_DIR/uploads-$TS.tar.gz"
BUNDLE_DEST="$BUNDLE_DIR/wufan-workstation-main-$TS.bundle"

mkdir -p "$DB_DIR" "$UPLOADS_DIR" "$BUNDLE_DIR" "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

run_step() {
  local label="$1"
  shift
  log "START $label"
  if "$@" >> "$LOG_FILE" 2>&1; then
    log "OK $label"
    return 0
  fi
  local code=$?
  log "FAIL $label exit=$code"
  return "$code"
}

require_file() {
  local file="$1"
  local label="$2"
  if [[ -s "$file" ]]; then
    log "OK verify $label: $file"
    return 0
  fi
  log "FAIL verify $label missing or empty: $file"
  return 1
}

verify_uploads_archive() {
  if tar -tzf "$UPLOADS_DEST" >/dev/null 2>> "$LOG_FILE"; then
    log "OK verify uploads archive readable: $UPLOADS_DEST"
    return 0
  fi
  log "FAIL verify uploads archive unreadable: $UPLOADS_DEST"
  return 1
}

verify_git_bundle() {
  if git -C "$PROJECT_DIR" bundle verify "$BUNDLE_DEST" >> "$LOG_FILE" 2>&1; then
    log "OK verify git bundle: $BUNDLE_DEST"
    return 0
  fi
  log "FAIL verify git bundle: $BUNDLE_DEST"
  return 1
}

verify_database_backup() {
  local integrity foreign_keys
  integrity="$(sqlite3 "$DB_DEST" 'PRAGMA integrity_check;' 2>> "$LOG_FILE")" || return 1
  [[ "$integrity" == "ok" ]] || { log "FAIL database integrity: $integrity"; return 1; }
  foreign_keys="$(sqlite3 "$DB_DEST" 'PRAGMA foreign_key_check;' 2>> "$LOG_FILE")" || return 1
  [[ -z "$foreign_keys" ]] || { log "FAIL database foreign keys"; return 1; }
  log "OK verify database integrity and foreign keys: $DB_DEST"
}

status=0

log "===== Backup started ====="
log "PROJECT_DIR=$PROJECT_DIR"
log "BACKUP_ROOT=$BACKUP_ROOT"

if [[ ! -f "$DB_SRC" ]]; then
  log "FAIL database source missing: $DB_SRC"
  status=1
else
  run_step "database backup: $DB_DEST" sqlite3 "$DB_SRC" ".backup '$DB_DEST'" || status=1
  require_file "$DB_DEST" "database backup" || status=1
  verify_database_backup || status=1
fi

if [[ ! -d "$UPLOADS_SRC" ]]; then
  log "FAIL uploads source missing: $UPLOADS_SRC"
  status=1
else
  run_step "uploads archive: $UPLOADS_DEST" tar -czf "$UPLOADS_DEST" -C "$(dirname "$UPLOADS_SRC")" "$(basename "$UPLOADS_SRC")" || status=1
  require_file "$UPLOADS_DEST" "uploads archive" || status=1
  verify_uploads_archive || status=1
fi

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  log "FAIL git repository missing: $PROJECT_DIR/.git"
  status=1
else
  run_step "git bundle: $BUNDLE_DEST" git -C "$PROJECT_DIR" bundle create "$BUNDLE_DEST" main || status=1
  require_file "$BUNDLE_DEST" "git bundle" || status=1
  verify_git_bundle || status=1
fi

log "DB_DEST=$DB_DEST"
log "UPLOADS_DEST=$UPLOADS_DEST"
log "BUNDLE_DEST=$BUNDLE_DEST"
log "===== Backup finished status=$status ====="

if [[ "$status" -eq 0 ]]; then
  printf 'BACKUP_OK\n'
else
  printf 'BACKUP_FAILED\n'
fi
printf 'DB_DEST=%s\n' "$DB_DEST"
printf 'UPLOADS_DEST=%s\n' "$UPLOADS_DEST"
printf 'BUNDLE_DEST=%s\n' "$BUNDLE_DEST"
printf 'LOG_FILE=%s\n' "$LOG_FILE"

exit "$status"
