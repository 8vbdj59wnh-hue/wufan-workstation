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

NODE_COMMAND="${WUFAN_NODE_COMMAND:-node}"
OUTPUT=""
set +e
OUTPUT="$("$NODE_COMMAND" "$SCRIPT_DIR/release-business-baseline-check.mjs" \
  --database "$DATABASE_PATH" \
  --baseline "$BASELINE_PATH" \
  --busy-timeout-ms "$BUSY_TIMEOUT_MS")"
STATUS=$?
set -e

if [[ -z "${OUTPUT//[[:space:]]/}" ]]; then
  echo "DATABASE_BASELINE_CHECK_FAIL: baseline_cli_contract_violation (stdout is empty)" >&2
  exit 65
fi
if ! BASELINE_OUTPUT="$OUTPUT" "$NODE_COMMAND" -e \
  'const value=JSON.parse(process.env.BASELINE_OUTPUT);if(!value||typeof value.status!=="string")process.exit(1)' ; then
  echo "DATABASE_BASELINE_CHECK_FAIL: baseline_cli_contract_violation (stdout is not valid result JSON)" >&2
  exit 65
fi

printf '%s\n' "$OUTPUT"
exit "$STATUS"
