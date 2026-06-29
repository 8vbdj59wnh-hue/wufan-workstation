#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/backups"
TIMESTAMP="$(date '+%Y-%m-%d-%H-%M')"
DB_SOURCE="$PROJECT_ROOT/data/workstation.db"
DB_BACKUP="$BACKUP_DIR/workstation-$TIMESTAMP.db"
UPLOADS_SOURCE="$PROJECT_ROOT/uploads"
UPLOADS_BACKUP="$BACKUP_DIR/uploads-$TIMESTAMP.zip"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_SOURCE" ]]; then
  echo "数据库不存在：$DB_SOURCE" >&2
  exit 1
fi

cp "$DB_SOURCE" "$DB_BACKUP"

if [[ -d "$UPLOADS_SOURCE" ]]; then
  (
    cd "$PROJECT_ROOT"
    zip -qr "$UPLOADS_BACKUP" uploads
  )
else
  echo "uploads 目录不存在，跳过打包。"
fi

echo "数据库备份：$DB_BACKUP"
if [[ -f "$UPLOADS_BACKUP" ]]; then
  echo "uploads 备份：$UPLOADS_BACKUP"
fi
