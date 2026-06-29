#!/usr/bin/env bash
set -euo pipefail

REMOTE_PATH="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
MODE="dry-run"
ALLOW_DIRTY="false"
SKIP_PREFLIGHT="false"
REMOTE_HOST=""
REMOTE_USER=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-to-company.sh --host <tailscale-ip-or-name> --user <company-mac-user> [options]

Options:
  --path <remote-path>      Company Mac project path.
                            Default: /Users/meiyounaichatouyuna/Projects/goal-execution-system
  --execute                 Actually rsync code and restart pm2. Default is dry-run only.
  --dry-run                 Preview rsync changes without modifying the company Mac.
  --allow-dirty             Allow deploying when the company Mac project has uncommitted changes.
  --skip-preflight          Skip remote git/log/status checks.
  -h, --help                Show this help.

Safety:
  - Never syncs data/, uploads/, .env, node_modules/, or .git/
  - Does not use rsync --delete
  - Does not run git reset or git pull on the company Mac
  - Runs pnpm install when available, otherwise falls back to npm install
USAGE
}

quote_remote() {
  printf "%q" "$1"
}

remote_login() {
  ssh "$TARGET" "zsh -lc $(printf "%q" "export PATH=\"/opt/homebrew/bin:\$PATH\"; $1")"
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
    --allow-dirty)
      ALLOW_DIRTY="true"
      shift
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT="true"
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

if [[ -z "$REMOTE_HOST" || -z "$REMOTE_USER" ]]; then
  echo "Missing required --host or --user." >&2
  usage >&2
  exit 2
fi

if [[ ! -d ".git" ]]; then
  echo "Run this script from the project root." >&2
  exit 1
fi

TARGET="${REMOTE_USER}@${REMOTE_HOST}"
REMOTE_PATH_Q="$(quote_remote "$REMOTE_PATH")"

echo "Target: ${TARGET}:${REMOTE_PATH}"
echo "Mode: ${MODE}"

if [[ "$SKIP_PREFLIGHT" != "true" ]]; then
  echo
  echo "== SSH and remote project preflight =="
  remote_login "test -d ${REMOTE_PATH_Q}"

  echo
  echo "== Company Mac recent commits =="
  remote_login "git -C ${REMOTE_PATH_Q} log --oneline -5"

  echo
  echo "== Company Mac HEAD stat =="
  remote_login "git -C ${REMOTE_PATH_Q} show --stat HEAD"

  echo
  echo "== Company Mac index.html change in HEAD =="
  remote_login "git -C ${REMOTE_PATH_Q} show HEAD -- index.html || true"

  echo
  echo "== Company Mac working tree status =="
  REMOTE_STATUS="$(remote_login "git -C ${REMOTE_PATH_Q} status --short")"
  if [[ -n "$REMOTE_STATUS" ]]; then
    echo "$REMOTE_STATUS"
    if [[ "$ALLOW_DIRTY" != "true" ]]; then
      echo
      echo "Remote working tree is not clean. Review it first or rerun with --allow-dirty." >&2
      exit 1
    fi
  else
    echo "clean"
  fi

  echo
  echo "== Company Mac runtime commands =="
  remote_login "command -v node && (command -v pnpm || command -v npm) && command -v pm2"
fi

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

rsync "${RSYNC_ARGS[@]}" ./ "${TARGET}:${REMOTE_PATH}/"

if [[ "$MODE" == "dry-run" ]]; then
  echo
  echo "Dry-run complete. No files were changed on the company Mac."
  echo "After reviewing the Safari cache fix and rsync preview, rerun with --execute to deploy."
  exit 0
fi

echo
echo "== remote install and pm2 restart =="
remote_login "cd ${REMOTE_PATH_Q} && if command -v pnpm >/dev/null 2>&1; then pnpm install; elif command -v npm >/dev/null 2>&1; then echo 'pnpm not found; falling back to npm install'; npm install; else echo 'Neither pnpm nor npm found' >&2; exit 1; fi && pm2 restart all && pm2 status"
