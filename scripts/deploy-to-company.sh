#!/usr/bin/env bash
set -euo pipefail

echo "Deprecated: use scripts/release-package.sh on Dev-01 and scripts/release-from-package.sh on Server-01." >&2
exit 1

REMOTE_PATH="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
MODE="dry-run"
REMOTE_HOST=""
REMOTE_USER=""
LEGACY_CONFIRMED="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-to-company.sh --host <tailscale-ip-or-name> --user <company-mac-user> [options]

Options:
  --path <remote-path>      Company Mac project path.
                            Default: /Users/meiyounaichatouyuna/Projects/goal-execution-system
  --execute                 Actually rsync code and restart pm2. Default is dry-run only.
  --dry-run                 Preview rsync changes without modifying the company Mac.
  --legacy-confirm          Explicitly acknowledge use of this deprecated script.
  -h, --help                Show this help.

Safety:
  - Never syncs data/, uploads/, .env, .env.*, node_modules/, .git/, or backups/
  - Does not use rsync --delete
  - Does not run git reset or git pull on the company Mac
  - Requires local main branch to be clean and already pushed to GitHub origin/main
  - Requires existing production data/workstation.db and uploads/
  - Backs up remote code before execute mode deploys
  - Runs npm install, pm2 restart all, pm2 status, and local health checks on the company Mac
USAGE
}

quote_remote() {
  printf "%q" "$1"
}

remote_login() {
  ssh "$TARGET" "zsh -lc $(printf "%q" "export PATH=\"/opt/homebrew/bin:\$PATH\"; $1")"
}

find_local_node() {
  if [[ -n "${NODE_BIN:-}" && -x "$NODE_BIN" ]]; then
    echo "$NODE_BIN"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      REMOTE_HOST="${2:-}"
      shift 2
      ;;
    --user)
      REMOTE_USER="${2:-}"
      shift 2
      ;;
    --path)
      REMOTE_PATH="${2:-}"
      shift 2
      ;;
    --execute)
      MODE="execute"
      shift
      ;;
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --legacy-confirm)
      LEGACY_CONFIRMED="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$LEGACY_CONFIRMED" != "true" ]]; then
  echo "Deprecated: use the release workflow" >&2
  echo "Legacy execution requires an explicit --legacy-confirm argument." >&2
  exit 1
fi

if [[ -z "$REMOTE_HOST" || -z "$REMOTE_USER" ]]; then
  echo "Missing required --host or --user." >&2
  usage >&2
  exit 2
fi

if [[ ! -d ".git" ]]; then
  echo "Run this script from the project root." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "当前分支不是 main，停止部署。当前分支：${current_branch}" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "当前存在未提交代码，请先提交到 GitHub。" >&2
  git status --short >&2
  exit 1
fi

echo "本次部署基于 GitHub 最新 main 分支。"
git fetch origin main
local_head="$(git rev-parse HEAD)"
origin_head="$(git rev-parse origin/main)"
if [[ "$local_head" != "$origin_head" ]]; then
  echo "当前本地 main 与 GitHub origin/main 不一致，停止部署。" >&2
  echo "请先完成 git push origin main，确保 GitHub 是唯一代码备份中心。" >&2
  echo "local HEAD:  ${local_head}" >&2
  echo "origin/main: ${origin_head}" >&2
  exit 1
fi

TARGET="${REMOTE_USER}@${REMOTE_HOST}"
REMOTE_PATH_Q="$(quote_remote "$REMOTE_PATH")"

echo "Target: ${TARGET}:${REMOTE_PATH}"
echo "Mode: ${MODE}"

echo
echo "== Company Mac safety preflight =="
remote_login "test -d ${REMOTE_PATH_Q}"
remote_login "test -f ${REMOTE_PATH_Q}/data/workstation.db && echo DB_OK"
remote_login "test -d ${REMOTE_PATH_Q}/uploads && echo UPLOADS_OK"
remote_login "if test -f ${REMOTE_PATH_Q}/.env; then echo ENV_PRESERVED; else echo ENV_NOT_FOUND; fi"

echo
echo "== Company Mac runtime commands =="
remote_login "command -v node && command -v npm && command -v pm2 && command -v curl"

echo
echo "== generate version.json =="
LOCAL_NODE="$(find_local_node)"
if [[ -z "$LOCAL_NODE" ]]; then
  echo "Local node command not found. Cannot generate version.json." >&2
  exit 1
fi
"$LOCAL_NODE" scripts/generate-version.js

echo
echo "== rsync =="
RSYNC_ARGS=(
  -az
  --itemize-changes
  --exclude "data/"
  --exclude "uploads/"
  --exclude ".env"
  --exclude ".env.*"
  --exclude "node_modules/"
  --exclude ".git/"
  --exclude "backups/"
)

if [[ "$MODE" == "dry-run" ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

if [[ "$MODE" == "execute" ]]; then
  echo
  echo "== remote code backup =="
  BACKUP_PATH="$(
    remote_login "
      backup_dir=${REMOTE_PATH_Q}/backups/code-\$(date +%Y%m%d-%H%M%S)
      mkdir -p \"\$backup_dir\"
      rsync -az \
        --exclude data/ \
        --exclude uploads/ \
        --exclude node_modules/ \
        --exclude backups/ \
        --exclude .git/ \
        --exclude .env \
        --exclude '.env.*' \
        ${REMOTE_PATH_Q}/ \"\$backup_dir\"/
      echo \"\$backup_dir\"
    "
  )"
  echo "Backup: ${BACKUP_PATH}"
fi

rsync "${RSYNC_ARGS[@]}" ./ "${TARGET}:${REMOTE_PATH}/"

if [[ "$MODE" == "dry-run" ]]; then
  echo
  echo "Dry-run complete. No files were changed on the company Mac."
  echo "Review the rsync preview, then rerun with --execute to deploy."
  exit 0
fi

echo
echo "== remote install and pm2 restart =="
remote_login "cd ${REMOTE_PATH_Q} && npm install && pm2 restart all && pm2 status && curl -fsS -I http://127.0.0.1:5173 && curl -fsS http://127.0.0.1:3001/api/health"
