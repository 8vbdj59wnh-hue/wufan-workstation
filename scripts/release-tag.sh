#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
RELEASE_ROOT="/Users/meiyounaichatouyuna/WufanWorkstationReleases"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

RELEASE_DIR=""
CONFIRM=""
DRY_RUN=false

fail() {
  echo "RELEASE_TAG_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-dir) RELEASE_DIR="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || fail "--release-dir must exist and be absolute"
[[ "$DRY_RUN" == true || "$CONFIRM" == "TAG" ]] || fail "--confirm must exactly equal TAG"

PROJECT_DIR="$EXPECTED_PROJECT_DIR"
NODE_COMMAND="$NODE22_BIN/node"
if [[ "${RELEASE_TEST_MODE:-}" == "1" ]]; then
  PROJECT_DIR="${RELEASE_TEST_PROJECT_DIR:-$PROJECT_DIR}"
  NODE_COMMAND="${RELEASE_TEST_NODE_COMMAND:-$(command -v node)}"
  case "$RELEASE_DIR" in /tmp/*|/private/tmp/*) ;; *) fail "test release directory must be under /tmp" ;; esac
else
  case "$RELEASE_DIR" in "$RELEASE_ROOT"/release-*) ;; *) fail "release directory must be under $RELEASE_ROOT" ;; esac
fi

MANIFEST="$RELEASE_DIR/release-manifest.json"
HEALTH_AFTER="$RELEASE_DIR/checks/health-after.json"
[[ -f "$MANIFEST" ]] || fail "release manifest missing"
[[ -f "$HEALTH_AFTER" ]] || fail "post-release health result missing"

STATUS="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.status)' "$MANIFEST")"
TARGET="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.targetCommit)' "$MANIFEST")"
HEALTH_OK="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(String(m.success===true))' "$HEALTH_AFTER")"
[[ "$STATUS" == "deployed" ]] || fail "manifest status must be deployed"
[[ "$(git -C "$PROJECT_DIR" rev-parse HEAD)" == "$TARGET" ]] || fail "current HEAD does not equal manifest targetCommit"
[[ "$HEALTH_OK" == "true" ]] || fail "post-release health check did not pass"

TAG_NAME="production-$(date '+%Y-%m-%d-%H%M')"
if git -C "$PROJECT_DIR" rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  fail "local tag already exists: $TAG_NAME"
fi
if [[ -n "$(git -C "$PROJECT_DIR" ls-remote --tags origin "refs/tags/$TAG_NAME")" ]]; then
  fail "remote tag already exists: $TAG_NAME"
fi

RELEASE_ID="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.releaseId)' "$MANIFEST")"
CHANGE_TYPE="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.changeType)' "$MANIFEST")"
BACKUP_SHA="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.databaseBackupSha256||"")' "$MANIFEST")"
PREVIEW_RESULT="not-required"
if [[ -f "$RELEASE_DIR/checks/migration-preview.json" ]]; then
  PREVIEW_RESULT="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.success===true?"passed":"failed")' "$RELEASE_DIR/checks/migration-preview.json")"
fi

TAG_MESSAGE="Wufan Workstation production release
targetCommit: $TARGET
releaseId: $RELEASE_ID
changeType: $CHANGE_TYPE
databaseBackupSha256: $BACKUP_SHA
migrationPreview: $PREVIEW_RESULT
healthCheck: passed"

echo "TAG_NAME=$TAG_NAME"
echo "TAG_TARGET=$TARGET"
echo "DRY_RUN=$DRY_RUN"
if [[ "$DRY_RUN" == true ]]; then
  echo "TAG_CREATED=false"
  exit 0
fi

git -C "$PROJECT_DIR" tag -a "$TAG_NAME" "$TARGET" -m "$TAG_MESSAGE"
git -C "$PROJECT_DIR" push origin "refs/tags/$TAG_NAME"
echo "TAG_CREATED=true"
