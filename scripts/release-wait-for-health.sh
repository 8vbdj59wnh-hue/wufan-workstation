#!/usr/bin/env bash
set -euo pipefail

URL=""
LABEL="service"
TOTAL_SECONDS=180
INTERVAL_SECONDS=3
REQUEST_TIMEOUT_SECONDS=8

fail() {
  echo "HEALTH_WAIT_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --total-seconds) TOTAL_SECONDS="${2:-}"; shift 2 ;;
    --interval-seconds) INTERVAL_SECONDS="${2:-}"; shift 2 ;;
    --request-timeout-seconds) REQUEST_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$URL" =~ ^http://127\.0\.0\.1:[0-9]+/ ]] || fail "--url must target a local HTTP endpoint"
[[ "$LABEL" =~ ^[a-zA-Z0-9_-]+$ ]] || fail "--label is invalid"
[[ "$TOTAL_SECONDS" =~ ^[0-9]+$ && "$TOTAL_SECONDS" -ge 1 && "$TOTAL_SECONDS" -le 600 ]] \
  || fail "--total-seconds must be between 1 and 600"
[[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ && "$INTERVAL_SECONDS" -ge 1 && "$INTERVAL_SECONDS" -le 30 ]] \
  || fail "--interval-seconds must be between 1 and 30"
[[ "$REQUEST_TIMEOUT_SECONDS" =~ ^[0-9]+$ && "$REQUEST_TIMEOUT_SECONDS" -ge 1 && "$REQUEST_TIMEOUT_SECONDS" -le 30 ]] \
  || fail "--request-timeout-seconds must be between 1 and 30"

started_at="$(date +%s)"
deadline=$((started_at + TOTAL_SECONDS))
attempt=0

while true; do
  attempt=$((attempt + 1))
  now="$(date +%s)"
  remaining=$((deadline - now))
  [[ "$remaining" -gt 0 ]] || break
  request_timeout="$REQUEST_TIMEOUT_SECONDS"
  [[ "$remaining" -ge "$request_timeout" ]] || request_timeout="$remaining"

  if curl --fail --silent \
    --connect-timeout 2 \
    --max-time "$request_timeout" \
    -H 'x-wufan-api-source: system:release' \
    "$URL" >/dev/null; then
    elapsed=$(($(date +%s) - started_at))
    echo "HEALTH_READY label=$LABEL attempts=$attempt elapsedSeconds=$elapsed"
    exit 0
  fi

  now="$(date +%s)"
  remaining=$((deadline - now))
  [[ "$remaining" -gt 0 ]] || break
  sleep_seconds="$INTERVAL_SECONDS"
  [[ "$remaining" -ge "$sleep_seconds" ]] || sleep_seconds="$remaining"
  echo "HEALTH_WAITING label=$LABEL attempt=$attempt remainingSeconds=$remaining"
  sleep "$sleep_seconds"
done

elapsed=$(($(date +%s) - started_at))
echo "HEALTH_WAIT_TIMEOUT label=$LABEL attempts=$attempt elapsedSeconds=$elapsed" >&2
exit 1
