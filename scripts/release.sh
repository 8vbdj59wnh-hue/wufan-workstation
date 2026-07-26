#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

COMMIT_SHA=""
CHANGE_TYPE=""
CONFIRM=""
DRY_RUN=false
PREPARE_ONLY=false
EXECUTE_ONLY=false
RELEASE_DIR=""

fail() {
  echo "RELEASE_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT_SHA="${2:-}"; shift 2 ;;
    --change-type) CHANGE_TYPE="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --prepare-only) PREPARE_ONLY=true; shift ;;
    --execute-only) EXECUTE_ONLY=true; shift ;;
    --release-dir) RELEASE_DIR="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full SHA"
case "$CHANGE_TYPE" in frontend|backend|deps|schema|uploads|runtime) ;; *) fail "invalid change type" ;; esac
[[ "$CHANGE_TYPE" != "uploads" ]] || fail "uploads releases require a dedicated reviewed workflow"
[[ "$PREPARE_ONLY" != true || "$EXECUTE_ONLY" != true ]] || fail "--prepare-only and --execute-only are mutually exclusive"

if [[ "$CONFIRM" != "DEPLOY" ]]; then
  DRY_RUN=true
fi

if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
  PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:-$PROJECT_DIR}"
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
else
  NODE_COMMAND="$NODE22_BIN/node"
fi

if [[ "$DRY_RUN" == true && "$EXECUTE_ONLY" != true ]]; then
  "$SCRIPT_DIR/release-prepare.sh" \
    --commit "$COMMIT_SHA" \
    --change-type "$CHANGE_TYPE" \
    --dry-run
  CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
  echo "===== RELEASE EXECUTION PLAN ====="
  PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$NODE_COMMAND" "$SCRIPT_DIR/release-classify.sh" \
    --current "$CURRENT_COMMIT" \
    --target "$COMMIT_SHA" \
    --change-type "$CHANGE_TYPE"
  echo "MIGRATION_PREVIEW_EXECUTED=false"
  echo "SOURCE_UPDATE_EXECUTED=false"
  echo "DEPENDENCY_INSTALL_EXECUTED=false"
  echo "SERVICE_RESTART_EXECUTED=false"
  echo "TAG_CREATED=false"
  exit 0
fi

if [[ "$EXECUTE_ONLY" == true ]]; then
  [[ -n "$RELEASE_DIR" ]] || fail "--execute-only requires --release-dir"
else
  PREPARE_OUTPUT="$(
    "$SCRIPT_DIR/release-prepare.sh" \
      --commit "$COMMIT_SHA" \
      --change-type "$CHANGE_TYPE"
  )"
  printf '%s\n' "$PREPARE_OUTPUT"
  RELEASE_DIR="$(printf '%s\n' "$PREPARE_OUTPUT" | awk -F= '/^RELEASE_DIR=/ { sub(/^[^=]*=/, ""); print; exit }')"
  [[ -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]] || fail "release preparation did not return a valid release directory"
fi

if [[ "$PREPARE_ONLY" == true ]]; then
  echo "PREPARE_ONLY_COMPLETE=true"
  echo "RELEASE_DIR=$RELEASE_DIR"
  exit 0
fi

REQUIRES_PREVIEW="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(String(m.requiresMigrationPreview===true))' "$RELEASE_DIR/release-manifest.json")"
if [[ "$REQUIRES_PREVIEW" == "true" ]]; then
  "$SCRIPT_DIR/release-migration-preview.sh" \
    --commit "$COMMIT_SHA" \
    --release-dir "$RELEASE_DIR"
fi

EXECUTE_ARGS=(
  --commit "$COMMIT_SHA"
  --change-type "$CHANGE_TYPE"
  --release-dir "$RELEASE_DIR"
  --confirm DEPLOY
)
[[ "$DRY_RUN" == true ]] && EXECUTE_ARGS+=(--dry-run)
"$SCRIPT_DIR/release-execute.sh" "${EXECUTE_ARGS[@]}"

if [[ "$DRY_RUN" == true ]]; then
  "$SCRIPT_DIR/release-tag.sh" --release-dir "$RELEASE_DIR" --dry-run
else
  "$SCRIPT_DIR/release-tag.sh" --release-dir "$RELEASE_DIR" --confirm TAG
fi

echo "RELEASE_DIR=$RELEASE_DIR"
