#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_DIR="${WUFAN_PROJECT_DIR:?WUFAN_PROJECT_DIR is required}"
RELEASE_ROOT="${WUFAN_RELEASE_ROOT:?WUFAN_RELEASE_ROOT is required}"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

RELEASE_DIR=""
REASON=""
DRY_RUN=false

fail() {
  echo "ROLLBACK_PLAN_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-dir) RELEASE_DIR="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$RELEASE_DIR" == /* && -d "$RELEASE_DIR" ]] || fail "--release-dir must exist and be absolute"
[[ -n "$REASON" ]] || fail "--reason is required"

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
[[ -f "$MANIFEST" ]] || fail "release manifest missing"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
CURRENT_DATABASE="${WUFAN_DB_PATH:?WUFAN_DB_PATH is required}"
CURRENT_DATABASE_SHA=""
[[ -f "$CURRENT_DATABASE" ]] && CURRENT_DATABASE_SHA="$(shasum -a 256 "$CURRENT_DATABASE" | awk '{print $1}')"

BACKUP_PATH="$("$NODE_COMMAND" -e 'const m=require(process.argv[1]);process.stdout.write(m.databaseBackupPath||"")' "$MANIFEST")"
BACKUP_INTEGRITY="missing"
if [[ -f "$BACKUP_PATH" ]]; then
  BACKUP_INTEGRITY="$(sqlite3 "$BACKUP_PATH" 'PRAGMA integrity_check;')"
fi

export MANIFEST RELEASE_DIR REASON DRY_RUN CURRENT_COMMIT CURRENT_DATABASE_SHA BACKUP_PATH BACKUP_INTEGRITY
"$NODE_COMMAND" <<'NODE'
const fs = require("fs");
const path = require("path");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
const dependencyChanged = manifest.packageJsonChanged === true || manifest.packageLockChanged === true || manifest.requiresNpmCi === true;
const schemaChanged = manifest.schemaChanged === true || manifest.migrationCodeChanged === true || manifest.requiresMigrationPreview === true;
const databaseChangedSincePrepare =
  process.env.CURRENT_DATABASE_SHA !== "" &&
  manifest.databaseSha256 !== "" &&
  process.env.CURRENT_DATABASE_SHA !== manifest.databaseSha256;
const possibleBusinessWrites = manifest.status === "deployed" || databaseChangedSincePrepare;
const sourceOnlyAllowed = !dependencyChanged && !schemaChanged;
const databaseOverwriteForbidden = possibleBusinessWrites || schemaChanged;
const needsForwardFix = schemaChanged || possibleBusinessWrites;

const recommended = needsForwardFix
  ? "Preserve the current production database. Prefer a forward-fix commit and reviewed forward migration; reconcile post-release writes before considering any manual restore."
  : dependencyChanged
    ? "Publish a forward revert commit and reinstall the previous lockfile with Node 22, then run targeted health checks."
    : "Publish a forward revert commit and restart only the affected services after health validation.";

const plan = {
  createdAt: new Date().toISOString(),
  dryRun: process.env.DRY_RUN === "true",
  reason: process.env.REASON,
  releaseId: manifest.releaseId,
  releaseStatus: manifest.status,
  beforeCommit: manifest.currentCommit,
  targetCommit: manifest.targetCommit,
  currentCommit: process.env.CURRENT_COMMIT,
  dependencyChanged,
  schemaChanged,
  databaseBackupPath: process.env.BACKUP_PATH,
  databaseBackupIntegrity: process.env.BACKUP_INTEGRITY,
  databaseChangedSincePrepare,
  possibleBusinessWrites,
  recommendedRollback: recommended,
  sourceOnlyRollbackAllowed: sourceOnlyAllowed,
  forwardFixRequired: needsForwardFix,
  databaseOverwriteForbidden,
  suggestedOrder: [
    "Declare a maintenance window and stop new writes if feasible.",
    "Preserve the current database and collect current health, commit, and service evidence.",
    "Determine whether migrations ran and whether post-release business writes occurred.",
    "Prepare and review a forward revert or forward-fix commit on Dev-01.",
    "If dependencies changed, restore the prior lockfile through Git history and run npm ci with Node 22.",
    "Run migration preview when schema or migration code is involved.",
    "Deploy through the controlled release workflow and complete rollback-phase health checks.",
  ],
  humanConfirmationRisks: [
    "Confirm whether any employee wrote data after deployment.",
    "Confirm whether the backend started and executed migrations.",
    "Confirm the backup integrity and retention before any manual database operation.",
    "Never overwrite the live database solely because source rollback succeeded.",
  ],
};

fs.writeFileSync(path.join(process.env.RELEASE_DIR, "rollback-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
const markdown = `# Rollback plan: ${manifest.releaseId}

- Reason: ${process.env.REASON}
- Before commit: ${manifest.currentCommit}
- Target commit: ${manifest.targetCommit}
- Current commit: ${process.env.CURRENT_COMMIT}
- Dependency changed: ${dependencyChanged}
- Schema or migration changed: ${schemaChanged}
- Backup: ${process.env.BACKUP_PATH}
- Backup integrity: ${process.env.BACKUP_INTEGRITY}
- Possible post-release business writes: ${possibleBusinessWrites}
- Source-only rollback allowed: ${sourceOnlyAllowed}
- Forward fix required: ${needsForwardFix}
- Database overwrite forbidden: ${databaseOverwriteForbidden}

## Recommendation

${recommended}

## Suggested order

${plan.suggestedOrder.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Required human confirmations

${plan.humanConfirmationRisks.map((item) => `- ${item}`).join("\n")}

This file is a plan only. It does not execute Git, service, dependency, or database rollback.
`;
fs.writeFileSync(path.join(process.env.RELEASE_DIR, "rollback-plan.md"), markdown);
NODE

echo "ROLLBACK_PLAN_JSON=$RELEASE_DIR/rollback-plan.json"
echo "ROLLBACK_PLAN_MARKDOWN=$RELEASE_DIR/rollback-plan.md"
echo "ROLLBACK_EXECUTED=false"
