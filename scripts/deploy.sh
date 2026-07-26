#!/usr/bin/env bash
set -euo pipefail

echo "Deprecated: use scripts/release-package.sh on Dev-01 and scripts/release-from-package.sh on Server-01." >&2
exit 1

if [[ "${1:-}" != "--legacy-confirm" ]]; then
  echo "Deprecated: use the release workflow" >&2
  echo "Legacy execution requires an explicit --legacy-confirm argument." >&2
  exit 1
fi
shift

PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"

cd "$PROJECT_DIR"

echo "本次部署基于 GitHub 最新 main 分支。"

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

git fetch origin main
git pull --ff-only origin main
npm install
pm2 restart all
