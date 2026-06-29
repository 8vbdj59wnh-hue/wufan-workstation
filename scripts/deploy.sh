#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"

cd "$PROJECT_DIR"
git pull origin main
npm install
pm2 restart all
