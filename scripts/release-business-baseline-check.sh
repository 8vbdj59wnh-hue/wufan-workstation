#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH=""
BASELINE_PATH=""
BUSY_TIMEOUT_MS="${WUFAN_RELEASE_BASELINE_BUSY_TIMEOUT_MS:-250}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "DATABASE_BASELINE_CHECK_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database) DATABASE_PATH="${2:-}"; shift 2 ;;
    --baseline) BASELINE_PATH="${2:-}"; shift 2 ;;
    --busy-timeout-ms) BUSY_TIMEOUT_MS="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$DATABASE_PATH" == /* && -f "$DATABASE_PATH" ]] || fail "database must be an existing absolute file"
[[ "$BASELINE_PATH" == /* && -f "$BASELINE_PATH" ]] || fail "baseline must be an existing absolute file"

exec node "$SCRIPT_DIR/release-business-baseline-check.mjs" \
  --database "$DATABASE_PATH" \
  --baseline "$BASELINE_PATH" \
  --busy-timeout-ms "$BUSY_TIMEOUT_MS"
