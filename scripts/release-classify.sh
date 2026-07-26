#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/Users/meiyounaichatouyuna/Projects/goal-execution-system}"
CURRENT_COMMIT=""
TARGET_COMMIT=""
CHANGE_TYPE=""
FORMAT="env"

fail() {
  echo "CLASSIFY_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --current)
      CURRENT_COMMIT="${2:-}"
      shift 2
      ;;
    --target)
      TARGET_COMMIT="${2:-}"
      shift 2
      ;;
    --change-type)
      CHANGE_TYPE="${2:-}"
      shift 2
      ;;
    --format)
      FORMAT="${2:-}"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$CURRENT_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--current must be a full SHA"
[[ "$TARGET_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--target must be a full SHA"
case "$CHANGE_TYPE" in frontend|backend|deps|schema|uploads|runtime) ;; *) fail "invalid change type" ;; esac
case "$FORMAT" in env|json) ;; *) fail "--format must be env or json" ;; esac

git -C "$PROJECT_DIR" cat-file -e "$CURRENT_COMMIT^{commit}"
git -C "$PROJECT_DIR" cat-file -e "$TARGET_COMMIT^{commit}"

CHANGED_FILES="$(git -C "$PROJECT_DIR" diff --name-only "$CURRENT_COMMIT" "$TARGET_COMMIT")"
CHANGED_FILES_COUNT="$(printf '%s\n' "$CHANGED_FILES" | awk 'NF { count++ } END { print count + 0 }')"

matches() {
  printf '%s\n' "$CHANGED_FILES" | grep -Eq "$1"
}

PACKAGE_JSON_CHANGED=false
PACKAGE_LOCK_CHANGED=false
FRONTEND_CHANGED=false
BACKEND_CHANGED=false
SCHEMA_CHANGED=false
MIGRATION_CODE_CHANGED=false
UPLOADS_RELATED_CHANGED=false

matches '^package\.json$' && PACKAGE_JSON_CHANGED=true
matches '^package-lock\.json$' && PACKAGE_LOCK_CHANGED=true
matches '^(index\.html|src/|public/|scripts/static-server\.js$)' && FRONTEND_CHANGED=true
matches '^server/' && BACKEND_CHANGED=true
matches '^server/schema\.sql$' && SCHEMA_CHANGED=true
matches '^server/db\.js$|^scripts/release-migration-runner\.mjs$' && MIGRATION_CODE_CHANGED=true
matches '(^|/)(uploads?|upload)(/|[-_.]|$)' && UPLOADS_RELATED_CHANGED=true

REQUIRES_NPM_CI=false
REQUIRES_CLIENT_RESTART=false
REQUIRES_SERVER_RESTART=false
REQUIRES_MIGRATION_PREVIEW=false
REQUIRES_UPLOADS_BACKUP=false
NO_OP=false

if [[ "$CHANGED_FILES_COUNT" -eq 0 ]]; then
  NO_OP=true
else
  if [[ "$PACKAGE_JSON_CHANGED" == true || "$PACKAGE_LOCK_CHANGED" == true || "$CHANGE_TYPE" == "deps" ]]; then
    REQUIRES_NPM_CI=true
    REQUIRES_CLIENT_RESTART=true
    REQUIRES_SERVER_RESTART=true
  else
    [[ "$FRONTEND_CHANGED" == true ]] && REQUIRES_CLIENT_RESTART=true
    [[ "$BACKEND_CHANGED" == true ]] && REQUIRES_SERVER_RESTART=true
  fi

  if [[ "$SCHEMA_CHANGED" == true || "$MIGRATION_CODE_CHANGED" == true || "$CHANGE_TYPE" == "schema" ]]; then
    REQUIRES_MIGRATION_PREVIEW=true
    REQUIRES_SERVER_RESTART=true
  fi
  if [[ "$UPLOADS_RELATED_CHANGED" == true || "$CHANGE_TYPE" == "uploads" ]]; then
    REQUIRES_UPLOADS_BACKUP=true
  fi
fi

if [[ "$FORMAT" == "env" ]]; then
  echo "CHANGED_FILES_COUNT=$CHANGED_FILES_COUNT"
  echo "PACKAGE_JSON_CHANGED=$PACKAGE_JSON_CHANGED"
  echo "PACKAGE_LOCK_CHANGED=$PACKAGE_LOCK_CHANGED"
  echo "FRONTEND_CHANGED=$FRONTEND_CHANGED"
  echo "BACKEND_CHANGED=$BACKEND_CHANGED"
  echo "SCHEMA_CHANGED=$SCHEMA_CHANGED"
  echo "MIGRATION_CODE_CHANGED=$MIGRATION_CODE_CHANGED"
  echo "UPLOADS_RELATED_CHANGED=$UPLOADS_RELATED_CHANGED"
  echo "REQUIRES_NPM_CI=$REQUIRES_NPM_CI"
  echo "REQUIRES_CLIENT_RESTART=$REQUIRES_CLIENT_RESTART"
  echo "REQUIRES_SERVER_RESTART=$REQUIRES_SERVER_RESTART"
  echo "REQUIRES_MIGRATION_PREVIEW=$REQUIRES_MIGRATION_PREVIEW"
  echo "REQUIRES_UPLOADS_BACKUP=$REQUIRES_UPLOADS_BACKUP"
  echo "NO_OP=$NO_OP"
  while IFS= read -r changed_file; do
    [[ -n "$changed_file" ]] && echo "CHANGED_FILE=$changed_file"
  done <<< "$CHANGED_FILES"
  exit 0
fi

NODE_COMMAND="${NODE_COMMAND:-$(command -v node)}"
export CURRENT_COMMIT TARGET_COMMIT CHANGE_TYPE CHANGED_FILES CHANGED_FILES_COUNT
export PACKAGE_JSON_CHANGED PACKAGE_LOCK_CHANGED FRONTEND_CHANGED BACKEND_CHANGED
export SCHEMA_CHANGED MIGRATION_CODE_CHANGED UPLOADS_RELATED_CHANGED
export REQUIRES_NPM_CI REQUIRES_CLIENT_RESTART REQUIRES_SERVER_RESTART
export REQUIRES_MIGRATION_PREVIEW REQUIRES_UPLOADS_BACKUP NO_OP
"$NODE_COMMAND" <<'NODE'
const bool = (name) => process.env[name] === "true";
const output = {
  currentCommit: process.env.CURRENT_COMMIT,
  targetCommit: process.env.TARGET_COMMIT,
  changeType: process.env.CHANGE_TYPE,
  changedFiles: process.env.CHANGED_FILES.split(/\r?\n/).filter(Boolean),
  changedFilesCount: Number(process.env.CHANGED_FILES_COUNT),
  packageJsonChanged: bool("PACKAGE_JSON_CHANGED"),
  packageLockChanged: bool("PACKAGE_LOCK_CHANGED"),
  frontendChanged: bool("FRONTEND_CHANGED"),
  backendChanged: bool("BACKEND_CHANGED"),
  schemaChanged: bool("SCHEMA_CHANGED"),
  migrationCodeChanged: bool("MIGRATION_CODE_CHANGED"),
  uploadsRelatedChanged: bool("UPLOADS_RELATED_CHANGED"),
  requiresNpmCi: bool("REQUIRES_NPM_CI"),
  requiresClientRestart: bool("REQUIRES_CLIENT_RESTART"),
  requiresServerRestart: bool("REQUIRES_SERVER_RESTART"),
  requiresMigrationPreview: bool("REQUIRES_MIGRATION_PREVIEW"),
  requiresUploadsBackup: bool("REQUIRES_UPLOADS_BACKUP"),
  noOp: bool("NO_OP"),
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
