#!/usr/bin/env bash
set -u
set -o pipefail

export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
BACKUP_ROOT="/Volumes/dianyi888.i234.me/home/Drive/屋范工作站备份"
DB_SRC="$PROJECT_DIR/data/workstation.db"
UPLOADS_SRC="$PROJECT_DIR/uploads"

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

cleanup_old_backups() {
  local dir="$1"
  local pattern="$2"
  local label="$3"
  local deleted
  deleted="$(find "$dir" -type f -name "$pattern" -mtime +30 -print -delete 2>> "$LOG_FILE" | wc -l | tr -d ' ')"
  log "CLEAN $label deleted=${deleted:-0}"
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
fi

if [[ ! -d "$UPLOADS_SRC" ]]; then
  log "FAIL uploads source missing: $UPLOADS_SRC"
  status=1
else
  run_step "uploads archive: $UPLOADS_DEST" tar -czf "$UPLOADS_DEST" -C "$PROJECT_DIR" uploads || status=1
fi

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  log "FAIL git repository missing: $PROJECT_DIR/.git"
  status=1
else
  run_step "git bundle: $BUNDLE_DEST" git -C "$PROJECT_DIR" bundle create "$BUNDLE_DEST" main || status=1
fi

cleanup_old_backups "$DB_DIR" "workstation-*.db" "database"
cleanup_old_backups "$UPLOADS_DIR" "uploads-*.tar.gz" "uploads"
cleanup_old_backups "$BUNDLE_DIR" "wufan-workstation-main-*.bundle" "git-bundles"

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
