#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMMIT_SHA=""
CHANGE_TYPE=""
OUTPUT_DIR=""
PACKAGE_DIR=""
PACKAGE_REF="refs/wufan-package/target"

fail() {
  echo "RELEASE_PACKAGE_FAIL: $*" >&2
  exit 1
}

cleanup_failure() {
  local code=$?
  trap - ERR
  git -C "$PROJECT_DIR" update-ref -d "$PACKAGE_REF" >/dev/null 2>&1 || true
  if [[ -n "$PACKAGE_DIR" && -d "$PACKAGE_DIR" ]]; then
    rm -rf "$PACKAGE_DIR"
  fi
  exit "$code"
}
trap cleanup_failure ERR
trap 'git -C "$PROJECT_DIR" update-ref -d "$PACKAGE_REF" >/dev/null 2>&1 || true' EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT_SHA="${2:-}"; shift 2 ;;
    --change-type) CHANGE_TYPE="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full 40-character SHA"
case "$CHANGE_TYPE" in
  frontend|backend|deps|schema|runtime) ;;
  uploads) fail "uploads releases require a separately reviewed package and backup process" ;;
  *) fail "invalid --change-type" ;;
esac
[[ "$OUTPUT_DIR" == /* && -d "$OUTPUT_DIR" ]] || fail "--output-dir must be an existing absolute directory"

[[ "$(git -C "$PROJECT_DIR" branch --show-current)" == "main" ]] || fail "Dev-01 branch must be main"
git -C "$PROJECT_DIR" diff --quiet || fail "worktree contains unstaged changes"
git -C "$PROJECT_DIR" diff --cached --quiet || fail "index contains staged changes"
[[ -z "$(git -C "$PROJECT_DIR" status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "worktree contains modified or untracked files"
git -C "$PROJECT_DIR" cat-file -e "$COMMIT_SHA^{commit}" || fail "target commit does not exist locally"

PARENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse "$COMMIT_SHA^")"
COMMIT_MESSAGE="$(git -C "$PROJECT_DIR" log -1 --format=%s "$COMMIT_SHA")"
TOOLING_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
PACKAGE_ID="wufan-release-$TIMESTAMP-${COMMIT_SHA:0:8}"
PACKAGE_DIR="$OUTPUT_DIR/$PACKAGE_ID"
[[ ! -e "$PACKAGE_DIR" ]] || fail "package directory already exists: $PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

SOURCE_ARCHIVE="$PACKAGE_DIR/source.tar.gz"
SOURCE_BUNDLE="$PACKAGE_DIR/source.bundle"
METADATA="$PACKAGE_DIR/release-metadata.json"

git -C "$PROJECT_DIR" archive \
  --format=tar.gz \
  --prefix=wufan-workstation/ \
  --output="$SOURCE_ARCHIVE" \
  "$COMMIT_SHA"

git -C "$PROJECT_DIR" update-ref "$PACKAGE_REF" "$COMMIT_SHA"
git -C "$PROJECT_DIR" bundle create "$SOURCE_BUNDLE" "$PACKAGE_REF"
git -C "$PROJECT_DIR" bundle verify "$SOURCE_BUNDLE" >/dev/null
git -C "$PROJECT_DIR" update-ref -d "$PACKAGE_REF"

git -C "$PROJECT_DIR" archive "$TOOLING_COMMIT" \
  scripts/release-from-package.sh \
  scripts/release-backup.sh \
  scripts/release-business-baseline-check.sh \
  scripts/release-business-baseline-check.mjs \
  scripts/release-maintenance-mode.mjs \
  scripts/release-classify.sh \
  scripts/release-health-check.sh \
  scripts/release-migration-preview.sh \
  scripts/release-migration-runner.mjs \
  server/releaseMaintenanceService.js \
  | tar -x -C "$PACKAGE_DIR"
chmod +x "$PACKAGE_DIR"/scripts/*.sh

CLASSIFICATION="$(
  PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$(command -v node)" \
    "$PACKAGE_DIR/scripts/release-classify.sh" \
      --current "$PARENT_COMMIT" \
      --target "$COMMIT_SHA" \
      --change-type "$CHANGE_TYPE" \
      --format json
)"

SOURCE_SHA256="$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')"
BUNDLE_SHA256="$(shasum -a 256 "$SOURCE_BUNDLE" | awk '{print $1}')"

export METADATA COMMIT_SHA PARENT_COMMIT COMMIT_MESSAGE TOOLING_COMMIT CREATED_AT CHANGE_TYPE
export SOURCE_SHA256 BUNDLE_SHA256 CLASSIFICATION
node <<'NODE'
const fs = require("fs");
const classification = JSON.parse(process.env.CLASSIFICATION);
const metadata = {
  commit: process.env.COMMIT_SHA,
  parentCommit: process.env.PARENT_COMMIT,
  commitMessage: process.env.COMMIT_MESSAGE,
  toolingCommit: process.env.TOOLING_COMMIT,
  createdAt: process.env.CREATED_AT,
  changeType: process.env.CHANGE_TYPE,
  sourceSha256: process.env.SOURCE_SHA256,
  bundleSha256: process.env.BUNDLE_SHA256,
  packageJsonChanged: classification.packageJsonChanged,
  packageLockChanged: classification.packageLockChanged,
  schemaChanged: classification.schemaChanged,
  migrationCodeChanged: classification.migrationCodeChanged,
  requiresNpmCi: classification.requiresNpmCi,
  requiresClientRestart: classification.requiresClientRestart,
  requiresServerRestart: classification.requiresServerRestart,
  requiresMigrationPreview: classification.requiresMigrationPreview,
  manualBrowserVerificationRequired: true,
};
fs.writeFileSync(process.env.METADATA, `${JSON.stringify(metadata, null, 2)}\n`);
NODE

(
  cd "$PACKAGE_DIR"
  find . -type f ! -name SHA256SUMS -print \
    | LC_ALL=C sort \
    | while IFS= read -r file; do
        shasum -a 256 "$file"
      done > SHA256SUMS
  shasum -a 256 -c SHA256SUMS >/dev/null
)

trap - ERR
echo "RELEASE_PACKAGE_CREATED=true"
echo "PACKAGE_DIR=$PACKAGE_DIR"
echo "TARGET_COMMIT=$COMMIT_SHA"
echo "SOURCE_SHA256=$SOURCE_SHA256"
echo "BUNDLE_SHA256=$BUNDLE_SHA256"
echo "PACKAGE_SIZE_BYTES=$(du -sk "$PACKAGE_DIR" | awk '{print $1 * 1024}')"
