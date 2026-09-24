#!/usr/bin/env bash

wufan_load_production_paths() {
  local resolver_script node_command output
  if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
    export WUFAN_PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:?RELEASE_TEST_PROJECT_DIR is required}"
    export WUFAN_DATA_ROOT="${RELEASE_TEST_DATA_ROOT:-$WUFAN_PROJECT_DIR/data}"
    export WUFAN_DB_PATH="${RELEASE_TEST_DATABASE_PATH:-$WUFAN_DATA_ROOT/workstation.db}"
    export WUFAN_DB_BASELINE_PATH="${RELEASE_TEST_BASELINE_PATH:-$WUFAN_DATA_ROOT/business-baseline.json}"
    export WUFAN_UPLOADS_PATH="${RELEASE_TEST_UPLOADS_PATH:-$WUFAN_DATA_ROOT/uploads}"
    export WUFAN_AUTH_SECRET_PATH="${RELEASE_TEST_AUTH_SECRET_PATH:-$WUFAN_DATA_ROOT/auth.secret}"
    export WUFAN_RELEASE_ROOT="${RELEASE_TEST_RELEASE_ROOT:-/private/tmp/wufan-release-test}"
    export WUFAN_BACKUP_ROOT="${RELEASE_TEST_BACKUP_ROOT:-/private/tmp/wufan-backup-test}"
    export WUFAN_PM2_LOG_ROOT="${RELEASE_TEST_PM2_LOG_ROOT:-/private/tmp/wufan-pm2-test}"
    return 0
  fi
  resolver_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/resolve-production-paths.mjs"
  node_command="${WUFAN_NODE_COMMAND:-/opt/homebrew/opt/node@22/bin/node}"
  [[ -x "$node_command" ]] || node_command="$(command -v node || true)"
  [[ -x "$node_command" ]] || { echo "PRODUCTION_PATHS_FAIL: Node is unavailable" >&2; return 1; }
  output="$("$node_command" "$resolver_script" --shell "$@")" || return $?
  eval "$output"
}
