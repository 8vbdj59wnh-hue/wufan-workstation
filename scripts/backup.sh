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
CODE_BACKUP="$BACKUP_DIR/code-$TIMESTAMP.zip"
EXTERNAL_BACKUP_DIR="${EXTERNAL_BACKUP_DIR:-}"

find_external_backup_dir() {
  if [[ -n "$EXTERNAL_BACKUP_DIR" ]]; then
    echo "$EXTERNAL_BACKUP_DIR"
    return
  fi

  for volume in /Volumes/*; do
    [[ -d "$volume" ]] || continue
    [[ "$(basename "$volume")" == "Macintosh HD" ]] && continue
    echo "$volume/wufan-workstation-backups"
    return
  done
}

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_SOURCE" ]]; then
  echo "数据库不存在：$DB_SOURCE" >&2
  exit 1
fi

(
  cd "$PROJECT_ROOT"
  zip -qr "$CODE_BACKUP" . \
    -x "data/*" \
    -x "uploads/*" \
    -x "backups/*" \
    -x "node_modules/*" \
    -x ".git/*" \
    -x ".env" \
    -x ".env.*" \
    -x ".DS_Store"
)

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
echo "代码备份：$CODE_BACKUP"

EXTERNAL_TARGET="$(find_external_backup_dir)"
if [[ -n "$EXTERNAL_TARGET" ]]; then
  if mkdir -p "$EXTERNAL_TARGET"; then
    EXTERNAL_COPY_OK=1
    cp "$DB_BACKUP" "$EXTERNAL_TARGET/" || EXTERNAL_COPY_OK=0
    cp "$CODE_BACKUP" "$EXTERNAL_TARGET/" || EXTERNAL_COPY_OK=0
    if [[ -f "$UPLOADS_BACKUP" ]]; then
      cp "$UPLOADS_BACKUP" "$EXTERNAL_TARGET/" || EXTERNAL_COPY_OK=0
    fi

    if [[ "$EXTERNAL_COPY_OK" == "1" ]]; then
      echo "移动硬盘备份目录：$EXTERNAL_TARGET"
    else
      echo "移动硬盘备份失败：请检查移动硬盘是否正常读写。"
      echo "本机备份已完成：$BACKUP_DIR"
    fi
  else
    echo "移动硬盘备份失败：无法创建目录 $EXTERNAL_TARGET"
    echo "本机备份已完成：$BACKUP_DIR"
  fi
else
  echo "未检测到移动硬盘，仅完成本机备份。"
fi
