#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
RELEASE_ROOT="/Users/meiyounaichatouyuna/WufanWorkstationReleases"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"
export PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
PACKAGE_REF="refs/wufan-package/offline-target"
MINIMUM_SAFETY_BYTES=$((10 * 1024 * 1024 * 1024))
NPM_TEMP_BYTES=$((2 * 1024 * 1024 * 1024))

PACKAGE_DIR=""
CONFIRM=""
DRY_RUN=false
RELEASE_DIR=""
MANIFEST=""
STAGE="argument-validation"
SOURCE_STAGING=""

fail() {
  echo "RELEASE_FROM_PACKAGE_FAIL: $*" >&2
  exit 1
}

cleanup() {
  git -C "$EXPECTED_PROJECT_DIR" update-ref -d "$PACKAGE_REF" >/dev/null 2>&1 || true
  [[ -z "$SOURCE_STAGING" || ! -d "$SOURCE_STAGING" ]] || rm -rf "$SOURCE_STAGING"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-dir) PACKAGE_DIR="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$PACKAGE_DIR" == /* && -d "$PACKAGE_DIR" ]] || fail "--package-dir must be an existing absolute directory"
[[ "$DRY_RUN" == true || "$CONFIRM" == "DEPLOY" ]] || fail "--confirm must exactly equal DEPLOY"

REQUIRED_FILES=(
  source.tar.gz
  source.bundle
  release-metadata.json
  SHA256SUMS
  scripts/release-backup.sh
  scripts/release-classify.sh
  scripts/release-health-check.sh
  scripts/release-migration-preview.sh
  scripts/release-migration-runner.mjs
)
for required in "${REQUIRED_FILES[@]}"; do
  [[ -f "$PACKAGE_DIR/$required" ]] || fail "package file missing: $required"
done

(
  cd "$PACKAGE_DIR"
  shasum -a 256 -c SHA256SUMS
) >/dev/null || fail "SHA256SUMS verification failed"

NODE_COMMAND="$NODE22_BIN/node"
[[ -x "$NODE_COMMAND" ]] || NODE_COMMAND="$(command -v node || true)"
[[ -x "$NODE_COMMAND" ]] || fail "Node is unavailable for metadata validation"
"$NODE_COMMAND" -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
  "$PACKAGE_DIR/release-metadata.json" || fail "release metadata is invalid"

metadata_value() {
  "$NODE_COMMAND" -e \
    'const m=require(process.argv[1]);const v=m[process.argv[2]];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' \
    "$PACKAGE_DIR/release-metadata.json" "$1"
}

TARGET_COMMIT="$(metadata_value commit)"
PARENT_COMMIT="$(metadata_value parentCommit)"
CHANGE_TYPE="$(metadata_value changeType)"
SOURCE_SHA256="$(metadata_value sourceSha256)"
BUNDLE_SHA256="$(metadata_value bundleSha256)"

[[ "$TARGET_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "metadata commit is invalid"
[[ "$PARENT_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "metadata parentCommit is invalid"
case "$CHANGE_TYPE" in
  frontend|backend|deps|schema|runtime) ;;
  uploads) fail "uploads releases require a separately reviewed process" ;;
  *) fail "metadata changeType is invalid" ;;
esac
[[ "$(shasum -a 256 "$PACKAGE_DIR/source.tar.gz" | awk '{print $1}')" == "$SOURCE_SHA256" ]] \
  || fail "source archive SHA does not match metadata"
[[ "$(shasum -a 256 "$PACKAGE_DIR/source.bundle" | awk '{print $1}')" == "$BUNDLE_SHA256" ]] \
  || fail "source bundle SHA does not match metadata"
BUNDLE_ADVERTISED_TARGET="$(
  git bundle list-heads "$PACKAGE_DIR/source.bundle" \
    | awk -v target="$TARGET_COMMIT" '$1 == target { print $1; exit }'
)"
[[ "$BUNDLE_ADVERTISED_TARGET" == "$TARGET_COMMIT" ]] \
  || fail "metadata target commit is not advertised by source bundle"

NODE_COMMAND="$NODE22_BIN/node"
NPM_COMMAND="$NODE22_BIN/npm"
[[ -x "$NODE_COMMAND" && -x "$NPM_COMMAND" ]] || fail "Node 22 runtime is unavailable"

PROJECT_DIR="$EXPECTED_PROJECT_DIR"
[[ -d "$PROJECT_DIR/.git" ]] || fail "production Git repository is missing"
[[ "$(id -un)" == "meiyounaichatouyuna" ]] || fail "must run as the production user"
[[ "$(cd "$PROJECT_DIR" && pwd -P)" == "$PROJECT_DIR" ]] || fail "production path mismatch"
[[ "$(git -C "$PROJECT_DIR" branch --show-current)" == "main" ]] || fail "production branch must be main"
git -C "$PROJECT_DIR" diff --quiet || fail "production worktree contains unstaged changes"
git -C "$PROJECT_DIR" diff --cached --quiet || fail "production index contains staged changes"
[[ -z "$(git -C "$PROJECT_DIR" status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "production worktree contains modified or untracked files"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
git -C "$PROJECT_DIR" bundle verify "$PACKAGE_DIR/source.bundle" >/dev/null 2>&1 \
  || fail "source bundle verification failed"
git -C "$PROJECT_DIR" update-ref -d "$PACKAGE_REF" >/dev/null 2>&1 || true
git -C "$PROJECT_DIR" bundle unbundle "$PACKAGE_DIR/source.bundle" >/dev/null 2>&1 \
  || fail "unable to import verified bundle objects"
git -C "$PROJECT_DIR" cat-file -e "$TARGET_COMMIT^{commit}" \
  || fail "bundle does not contain metadata target commit"
git -C "$PROJECT_DIR" update-ref "$PACKAGE_REF" "$TARGET_COMMIT"
[[ "$(git -C "$PROJECT_DIR" rev-parse "$PACKAGE_REF^{commit}")" == "$TARGET_COMMIT" ]] \
  || fail "imported target commit mismatch"
git -C "$PROJECT_DIR" merge-base --is-ancestor "$CURRENT_COMMIT" "$TARGET_COMMIT" \
  || fail "target commit is not a descendant of current production HEAD"

ARCHIVE_CHECK_SHA="$(
  git -C "$PROJECT_DIR" archive --format=tar.gz --prefix=wufan-workstation/ "$TARGET_COMMIT" \
    | shasum -a 256 \
    | awk '{print $1}'
)"
[[ "$ARCHIVE_CHECK_SHA" == "$SOURCE_SHA256" ]] || fail "source archive does not match target Git commit"

DATABASE_PATH="$PROJECT_DIR/data/workstation.db"
[[ -f "$DATABASE_PATH" ]] || fail "production database is missing"
DATABASE_INTEGRITY="$(sqlite3 "file:$DATABASE_PATH?mode=ro" 'PRAGMA integrity_check;')"
[[ "$DATABASE_INTEGRITY" == "ok" ]] || fail "production database integrity check failed"
DATABASE_SIZE="$(stat -f '%z' "$DATABASE_PATH")"
DISK_FREE_BYTES="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {printf "%.0f\n", $4 * 1024}')"
REQUIRED_FREE_BYTES=$((DATABASE_SIZE + NPM_TEMP_BYTES + MINIMUM_SAFETY_BYTES))
[[ "$DISK_FREE_BYTES" -gt "$REQUIRED_FREE_BYTES" ]] || fail "insufficient disk space"

LSOF_BIN="$(command -v lsof || true)"
if [[ -z "$LSOF_BIN" && -x /usr/sbin/lsof ]]; then
  LSOF_BIN="/usr/sbin/lsof"
fi
[[ -n "$LSOF_BIN" && -x "$LSOF_BIN" ]] || fail "lsof is unavailable for port checks"

PM2_JSON="$(pm2 jlist)"
PROJECT_DIR="$PROJECT_DIR" PM2_JSON="$PM2_JSON" "$NODE_COMMAND" <<'NODE' >/dev/null
const apps = JSON.parse(process.env.PM2_JSON);
for (const name of ["wufan-client", "wufan-server"]) {
  const app = apps.find((item) => item.name === name);
  if (!app || app.pm2_env?.status !== "online") throw new Error(`${name} is not online`);
  if (app.pm2_env?.pm_cwd !== process.env.PROJECT_DIR) throw new Error(`${name} cwd mismatch`);
}
NODE
for port in 5173 3001; do
  "$LSOF_BIN" -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null \
    || fail "port $port is not listening"
done
curl --fail --silent --show-error http://127.0.0.1:3001/api/health \
  | "$NODE_COMMAND" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);const current=h.status==="ok"&&h.database==="ok";const legacy=h.ok===true;if(!current&&!legacy)process.exit(1)})'

CLASSIFICATION_JSON="$(
  PROJECT_DIR="$PROJECT_DIR" NODE_COMMAND="$NODE_COMMAND" \
    "$PACKAGE_DIR/scripts/release-classify.sh" \
      --current "$CURRENT_COMMIT" \
      --target "$TARGET_COMMIT" \
      --change-type "$CHANGE_TYPE" \
      --format json
)"
class_value() {
  CLASSIFICATION_JSON="$CLASSIFICATION_JSON" "$NODE_COMMAND" -e \
    'const m=JSON.parse(process.env.CLASSIFICATION_JSON);process.stdout.write(String(m[process.argv[1]]))' "$1"
}
REQUIRES_NPM_CI="$(class_value requiresNpmCi)"
REQUIRES_CLIENT_RESTART="$(class_value requiresClientRestart)"
REQUIRES_SERVER_RESTART="$(class_value requiresServerRestart)"
REQUIRES_MIGRATION_PREVIEW="$(class_value requiresMigrationPreview)"
NO_OP="$(class_value noOp)"

echo "PACKAGE_VERIFIED=true"
echo "DRY_RUN=$DRY_RUN"
echo "CURRENT_COMMIT=$CURRENT_COMMIT"
echo "TARGET_COMMIT=$TARGET_COMMIT"
echo "PARENT_COMMIT=$PARENT_COMMIT"
echo "CHANGE_TYPE=$CHANGE_TYPE"
echo "NO_OP=$NO_OP"
echo "DATABASE_INTEGRITY=$DATABASE_INTEGRITY"
echo "DISK_FREE_BYTES=$DISK_FREE_BYTES"
echo "REQUIRES_NPM_CI=$REQUIRES_NPM_CI"
echo "REQUIRES_CLIENT_RESTART=$REQUIRES_CLIENT_RESTART"
echo "REQUIRES_SERVER_RESTART=$REQUIRES_SERVER_RESTART"
echo "REQUIRES_MIGRATION_PREVIEW=$REQUIRES_MIGRATION_PREVIEW"
echo "MANUAL_BROWSER_VERIFICATION_REQUIRED=true"

if [[ "$DRY_RUN" == true ]]; then
  echo "DATABASE_BACKUP_CREATED=false"
  echo "SOURCE_UPDATED=false"
  echo "SERVICE_RESTARTED=false"
  echo "TAG_CREATED=false"
  exit 0
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
RELEASE_ID="release-$TIMESTAMP-${TARGET_COMMIT:0:8}"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
[[ ! -e "$RELEASE_DIR" ]] || fail "release directory already exists"
mkdir -p "$RELEASE_DIR"/{database,git,pm2,config,checks,logs,package}
MANIFEST="$RELEASE_DIR/release-manifest.json"

mark_failed() {
  local code=$?
  trap - ERR
  if [[ -n "$MANIFEST" && -f "$MANIFEST" ]]; then
    STATUS="failed" STAGE="$STAGE" MANIFEST="$MANIFEST" "$NODE_COMMAND" <<'NODE' || true
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
manifest.status = process.env.STATUS;
manifest.failureStage = process.env.STAGE;
manifest.failedAt = new Date().toISOString();
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  fi
  echo "RELEASE_FAILED_STAGE=$STAGE" >&2
  echo "No automatic Git or database rollback was attempted." >&2
  exit "$code"
}
trap mark_failed ERR

cp "$PACKAGE_DIR/release-metadata.json" "$RELEASE_DIR/package/"
cp "$PACKAGE_DIR/SHA256SUMS" "$RELEASE_DIR/package/"
printf '%s\n' "$CURRENT_COMMIT" > "$RELEASE_DIR/git/current-head.txt"
printf '%s\n' "$TARGET_COMMIT" > "$RELEASE_DIR/git/target-head.txt"
git -C "$PROJECT_DIR" status --porcelain=v1 --untracked-files=all > "$RELEASE_DIR/git/status.txt"
PM2_JSON="$PM2_JSON" OUTPUT="$RELEASE_DIR/pm2/jlist-before.json" "$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const apps = JSON.parse(process.env.PM2_JSON).filter(a => ["wufan-client","wufan-server"].includes(a.name));
fs.writeFileSync(process.env.OUTPUT, `${JSON.stringify(apps.map(a => ({
  name:a.name,pid:a.pid,status:a.pm2_env?.status,cwd:a.pm2_env?.pm_cwd,
  restartCount:a.pm2_env?.restart_time
})), null, 2)}\n`);
NODE
{
  echo "node=$NODE_COMMAND"
  echo "npm=$NPM_COMMAND"
  echo "pm2=$(command -v pm2)"
  echo "sqlite3=$(command -v sqlite3)"
} > "$RELEASE_DIR/config/runtime-paths.txt"
[[ ! -f "$PROJECT_DIR/.node-version" ]] \
  || cp "$PROJECT_DIR/.node-version" "$RELEASE_DIR/config/node-version.txt"
[[ ! -f "$PROJECT_DIR/ecosystem.config.cjs" ]] \
  || cp "$PROJECT_DIR/ecosystem.config.cjs" "$RELEASE_DIR/config/ecosystem.config.cjs"

STAGE="database-backup"
BACKUP_OUTPUT="$(
  "$PACKAGE_DIR/scripts/release-backup.sh" \
    --commit "$TARGET_COMMIT" \
    --change-type "$CHANGE_TYPE" \
    --release-dir "$RELEASE_DIR"
)"
printf '%s\n' "$BACKUP_OUTPUT" | tee "$RELEASE_DIR/checks/database-backup.txt"
BACKUP_PATH="$(printf '%s\n' "$BACKUP_OUTPUT" | awk -F= '$1=="DATABASE_BACKUP_PATH"{sub(/^[^=]*=/,"");print}')"
BACKUP_SIZE="$(printf '%s\n' "$BACKUP_OUTPUT" | awk -F= '$1=="DATABASE_BACKUP_SIZE"{print $2}')"
BACKUP_SHA="$(printf '%s\n' "$BACKUP_OUTPUT" | awk -F= '$1=="DATABASE_BACKUP_SHA256"{print $2}')"
BACKUP_INTEGRITY="$(printf '%s\n' "$BACKUP_OUTPUT" | awk -F= '$1=="DATABASE_BACKUP_INTEGRITY"{print $2}')"

export MANIFEST RELEASE_ID CURRENT_COMMIT TARGET_COMMIT PARENT_COMMIT CHANGE_TYPE
export SOURCE_SHA256 BUNDLE_SHA256 BACKUP_PATH BACKUP_SIZE BACKUP_SHA BACKUP_INTEGRITY
export REQUIRES_NPM_CI REQUIRES_CLIENT_RESTART REQUIRES_SERVER_RESTART REQUIRES_MIGRATION_PREVIEW
"$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const bool = n => process.env[n] === "true";
const manifest = {
  releaseId: process.env.RELEASE_ID,
  status: "prepared",
  createdAt: new Date().toISOString(),
  sourceMode: "local-release-package",
  currentCommit: process.env.CURRENT_COMMIT,
  targetCommit: process.env.TARGET_COMMIT,
  parentCommit: process.env.PARENT_COMMIT,
  changeType: process.env.CHANGE_TYPE,
  sourceSha256: process.env.SOURCE_SHA256,
  bundleSha256: process.env.BUNDLE_SHA256,
  databaseBackupPath: process.env.BACKUP_PATH,
  databaseBackupSize: Number(process.env.BACKUP_SIZE),
  databaseBackupSha256: process.env.BACKUP_SHA,
  databaseBackupIntegrity: process.env.BACKUP_INTEGRITY,
  requiresNpmCi: bool("REQUIRES_NPM_CI"),
  requiresClientRestart: bool("REQUIRES_CLIENT_RESTART"),
  requiresServerRestart: bool("REQUIRES_SERVER_RESTART"),
  requiresMigrationPreview: bool("REQUIRES_MIGRATION_PREVIEW"),
  manualBrowserVerificationRequired: true,
};
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

if [[ "$REQUIRES_MIGRATION_PREVIEW" == "true" ]]; then
  STAGE="migration-preview"
  "$PACKAGE_DIR/scripts/release-migration-preview.sh" \
    --commit "$TARGET_COMMIT" \
    --release-dir "$RELEASE_DIR"
fi

STAGE="health-before"
"$PACKAGE_DIR/scripts/release-health-check.sh" \
  --commit "$TARGET_COMMIT" \
  --release-dir "$RELEASE_DIR" \
  --phase before

STAGE="source-staging"
SOURCE_STAGING="$(mktemp -d /tmp/wufan-source-staging.XXXXXX)"
tar -xzf "$PACKAGE_DIR/source.tar.gz" -C "$SOURCE_STAGING"
[[ -f "$SOURCE_STAGING/wufan-workstation/package.json" ]] || fail "staged source is incomplete"

STAGE="git-fast-forward"
git -C "$PROJECT_DIR" merge-base --is-ancestor HEAD "$TARGET_COMMIT"
if [[ "$NO_OP" == "false" ]]; then
  git -C "$PROJECT_DIR" merge --ff-only "$TARGET_COMMIT"
fi
[[ "$(git -C "$PROJECT_DIR" rev-parse HEAD)" == "$TARGET_COMMIT" ]]

if [[ "$REQUIRES_NPM_CI" == "true" ]]; then
  STAGE="dependencies"
  "$NPM_COMMAND" ci --no-audit --no-fund --prefix "$PROJECT_DIR"
  "$NPM_COMMAND" ls --depth=0 --prefix "$PROJECT_DIR"
  "$NODE_COMMAND" -e "require('$PROJECT_DIR/node_modules/better-sqlite3')"
fi

STAGE="code-check"
(cd "$PROJECT_DIR" && "$NPM_COMMAND" run check)

STAGE="service-restart"
[[ "$REQUIRES_CLIENT_RESTART" != "true" ]] || pm2 restart wufan-client
[[ "$REQUIRES_SERVER_RESTART" != "true" ]] || pm2 restart wufan-server

STAGE="service-stabilization"
if [[ "$REQUIRES_CLIENT_RESTART" == "true" ]]; then
  for attempt in {1..10}; do
    curl --fail --silent http://127.0.0.1:5173/ >/dev/null && break
    [[ "$attempt" -lt 10 ]]
    sleep 2
  done
fi
for attempt in {1..10}; do
  curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null && break
  [[ "$attempt" -lt 10 ]]
  sleep 2
done

STAGE="health-after"
"$PACKAGE_DIR/scripts/release-health-check.sh" \
  --commit "$TARGET_COMMIT" \
  --release-dir "$RELEASE_DIR" \
  --phase after
[[ "$(sqlite3 "file:$DATABASE_PATH?mode=ro" 'PRAGMA integrity_check;')" == "ok" ]]

STAGE="manifest-finalize"
PM2_AFTER="$(pm2 jlist)"
PM2_AFTER="$PM2_AFTER" MANIFEST="$MANIFEST" "$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
const apps = JSON.parse(process.env.PM2_AFTER).filter(a => ["wufan-client","wufan-server"].includes(a.name));
manifest.status = "deployed";
manifest.completedAt = new Date().toISOString();
manifest.finalCommit = manifest.targetCommit;
manifest.serviceStatusAfter = apps.map(a => ({
  name:a.name,pid:a.pid,status:a.pm2_env?.status,cwd:a.pm2_env?.pm_cwd,
  restartCount:a.pm2_env?.restart_time
}));
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
pm2 save

STAGE="production-tag"
TAG_NAME="production-$(date '+%Y-%m-%d-%H%M')"
git -C "$PROJECT_DIR" rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null \
  && fail "production tag already exists"
TAG_MESSAGE="Wufan Workstation production release
targetCommit: $TARGET_COMMIT
releaseId: $RELEASE_ID
changeType: $CHANGE_TYPE
databaseBackupSha256: $BACKUP_SHA
migrationPreview: $([[ "$REQUIRES_MIGRATION_PREVIEW" == "true" ]] && echo passed || echo not-required)
healthCheck: passed
manualBrowserVerificationRequired: true"
printf '%s\n' "$TAG_NAME" > "$RELEASE_DIR/checks/production-tag-name.txt"
printf '%s\n' "$TAG_MESSAGE" > "$RELEASE_DIR/checks/production-tag-message.txt"
git -C "$PROJECT_DIR" tag -a "$TAG_NAME" "$TARGET_COMMIT" -m "$TAG_MESSAGE"

trap - ERR
echo "RELEASE_DEPLOYED=true"
echo "RELEASE_DIR=$RELEASE_DIR"
echo "FINAL_COMMIT=$TARGET_COMMIT"
echo "TAG_NAME=$TAG_NAME"
echo "TAG_PUSHED=false"
echo "MANUAL_BROWSER_VERIFICATION_REQUIRED=true"
