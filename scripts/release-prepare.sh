#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_PROJECT_DIR="/Users/meiyounaichatouyuna/Projects/goal-execution-system"
RELEASE_ROOT="/Users/meiyounaichatouyuna/WufanWorkstationReleases"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"

COMMIT_SHA=""
CHANGE_TYPE=""
DRY_RUN="false"
RELEASE_DIR=""
RELEASE_DIR_CREATED="false"
BUNDLE_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/release-prepare.sh --commit <40-character-sha> \
    --change-type <frontend|backend|deps|schema|uploads|runtime> [--dry-run]

This command prepares release evidence and a SQLite online backup. It never
updates production source, installs dependencies, restarts PM2, migrates the
database, or creates a Git tag.
USAGE
}

fail() {
  echo "PREPARE_FAIL: $*" >&2
  exit 1
}

is_valid_change_type() {
  case "$1" in
    frontend|backend|deps|schema|uploads|runtime) return 0 ;;
    *) return 1 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      [[ $# -ge 2 ]] || fail "--commit requires a value"
      COMMIT_SHA="$2"
      shift 2
      ;;
    --change-type)
      [[ $# -ge 2 ]] || fail "--change-type requires a value"
      CHANGE_TYPE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --bundle)
      [[ $# -ge 2 ]] || fail "--bundle requires a value"
      BUNDLE_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "--commit must be a full 40-character Git SHA"
is_valid_change_type "$CHANGE_TYPE" || fail "invalid --change-type: $CHANGE_TYPE"

PREFLIGHT_ARGS=(--commit "$COMMIT_SHA" --change-type "$CHANGE_TYPE")
[[ "$DRY_RUN" == "true" ]] && PREFLIGHT_ARGS+=(--dry-run)
[[ -n "$BUNDLE_PATH" ]] && PREFLIGHT_ARGS+=(--bundle "$BUNDLE_PATH")
PREFLIGHT_OUTPUT="$("$SCRIPT_DIR/release-preflight.sh" "${PREFLIGHT_ARGS[@]}")"
echo "$PREFLIGHT_OUTPUT"

if [[ -n "${RELEASE_TEST_PROJECT_DIR:-}" ]]; then
  [[ "${RELEASE_TEST_MODE:-}" == "1" && "$DRY_RUN" == "true" ]] || fail "test mode requires --dry-run"
  PROJECT_DIR="$RELEASE_TEST_PROJECT_DIR"
else
  PROJECT_DIR="$EXPECTED_PROJECT_DIR"
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
RELEASE_ID="release-$TIMESTAMP-${COMMIT_SHA:0:8}"

if [[ "$DRY_RUN" == "true" ]]; then
  RELEASE_DIR="$(mktemp -d "/tmp/wufan-release-dry-run.XXXXXX")"
else
  mkdir -p "$RELEASE_ROOT"
  RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
  [[ ! -e "$RELEASE_DIR" ]] || fail "release directory already exists: $RELEASE_DIR"
  mkdir "$RELEASE_DIR"
fi
RELEASE_DIR_CREATED="true"

cleanup_dry_run() {
  if [[ "$DRY_RUN" == "true" && -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]]; then
    rm -rf "$RELEASE_DIR"
  fi
}

mark_failed() {
  exit_code=$?
  trap - ERR
  if [[ "$RELEASE_DIR_CREATED" == "true" && -d "$RELEASE_DIR" ]]; then
    mkdir -p "$RELEASE_DIR"/{database,git,pm2,config,checks,logs}
    printf '%s\n' "status=failed" "exitCode=$exit_code" > "$RELEASE_DIR/checks/failure.txt"
    if [[ -d "$PROJECT_DIR/.git" ]]; then
      current_commit="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || true)"
      if [[ -n "$current_commit" ]] && git -C "$PROJECT_DIR" cat-file -e "$COMMIT_SHA^{commit}" 2>/dev/null; then
        git -C "$PROJECT_DIR" diff --name-only "$current_commit" "$COMMIT_SHA" \
          > "$RELEASE_DIR/git/changed-files.txt" 2>/dev/null || true
      fi
    fi
    if [[ -f "$RELEASE_DIR/git/changed-files.txt" ]]; then
      MANIFEST_ARGS=(
        --commit "$COMMIT_SHA"
        --change-type "$CHANGE_TYPE"
        --release-dir "$RELEASE_DIR"
        --status failed
      )
      [[ "$DRY_RUN" == "true" ]] && MANIFEST_ARGS+=(--dry-run)
      [[ -n "$BUNDLE_PATH" ]] && MANIFEST_ARGS+=(--bundle "$BUNDLE_PATH")
      "$SCRIPT_DIR/release-manifest.sh" "${MANIFEST_ARGS[@]}" >/dev/null 2>&1 || true
    fi
  fi
  cleanup_dry_run
  exit "$exit_code"
}
trap mark_failed ERR
trap cleanup_dry_run EXIT

mkdir -p "$RELEASE_DIR"/{database,git,pm2,config,checks,logs}
printf '%s\n' "$PREFLIGHT_OUTPUT" > "$RELEASE_DIR/checks/preflight.txt"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$RELEASE_DIR/logs/prepare.log"
}

log "release preparation started: $RELEASE_ID"
log "current project: $PROJECT_DIR"
log "target commit: $COMMIT_SHA"
log "change type: $CHANGE_TYPE"
log "dry run: $DRY_RUN"

BACKUP_ARGS=(
  --commit "$COMMIT_SHA"
  --change-type "$CHANGE_TYPE"
  --release-dir "$RELEASE_DIR"
)
[[ "$DRY_RUN" == "true" ]] && BACKUP_ARGS+=(--dry-run)
"$SCRIPT_DIR/release-backup.sh" "${BACKUP_ARGS[@]}" | tee "$RELEASE_DIR/checks/database-backup.txt"

CURRENT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
git -C "$PROJECT_DIR" rev-parse HEAD > "$RELEASE_DIR/git/current-head.txt"
printf '%s\n' "$COMMIT_SHA" > "$RELEASE_DIR/git/target-head.txt"
git -C "$PROJECT_DIR" status --porcelain=v1 --untracked-files=all > "$RELEASE_DIR/git/status.txt"
git -C "$PROJECT_DIR" branch --show-current > "$RELEASE_DIR/git/branch.txt"
git -C "$PROJECT_DIR" log --oneline "$CURRENT_COMMIT..$COMMIT_SHA" > "$RELEASE_DIR/git/log-range.txt"
git -C "$PROJECT_DIR" diff --stat "$CURRENT_COMMIT" "$COMMIT_SHA" > "$RELEASE_DIR/git/diff-stat.txt"
git -C "$PROJECT_DIR" diff --name-only "$CURRENT_COMMIT" "$COMMIT_SHA" > "$RELEASE_DIR/git/changed-files.txt"
cp "$PROJECT_DIR/package.json" "$RELEASE_DIR/git/package.json"
cp "$PROJECT_DIR/package-lock.json" "$RELEASE_DIR/git/package-lock.json"

if [[ -n "${RELEASE_TEST_PROJECT_DIR:-}" ]]; then
  NODE_COMMAND="$(command -v node)"
  printf '[]\n' > "$RELEASE_DIR/pm2/jlist.json"
  printf '[]\n' > "$RELEASE_DIR/pm2/dump.pm2"
  printf 'test mode\n' > "$RELEASE_DIR/pm2/wufan-client-describe.txt"
  printf 'test mode\n' > "$RELEASE_DIR/pm2/wufan-server-describe.txt"
  printf '{"ok":true,"testMode":true}\n' > "$RELEASE_DIR/checks/health-before.json"
else
  NODE_COMMAND="$NODE22_BIN/node"
  PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" pm2 jlist | "$NODE_COMMAND" -e '
    const fs = require("fs");
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const safe = JSON.parse(input)
        .filter((app) => ["wufan-client", "wufan-server"].includes(app.name))
        .map((app) => ({
          name: app.name,
          pid: app.pid,
          status: app.pm2_env?.status,
          cwd: app.pm2_env?.pm_cwd,
          execPath: app.pm2_env?.pm_exec_path,
          args: app.pm2_env?.args ?? [],
          interpreter: app.pm2_env?.exec_interpreter,
          nodeVersion: app.pm2_env?.node_version,
          uptime: app.pm2_env?.pm_uptime,
          restartCount: app.pm2_env?.restart_time,
          outLog: app.pm2_env?.pm_out_log_path,
          errorLog: app.pm2_env?.pm_err_log_path,
        }));
      process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
    });
  ' > "$RELEASE_DIR/pm2/jlist.json"

  "$NODE_COMMAND" -e '
    const fs = require("fs");
    const file = `${process.env.HOME}/.pm2/dump.pm2`;
    const apps = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const safe = apps
      .filter((app) => ["wufan-client", "wufan-server"].includes(app.name))
      .map((app) => ({
        name: app.name,
        cwd: app.pm_cwd,
        execPath: app.pm_exec_path,
        args: app.args ?? [],
        interpreter: app.exec_interpreter,
      }));
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  ' > "$RELEASE_DIR/pm2/dump.pm2"

  "$NODE_COMMAND" - "$RELEASE_DIR/pm2/jlist.json" wufan-client <<'NODE' > "$RELEASE_DIR/pm2/wufan-client-describe.txt"
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).find((app) => app.name === process.argv[3]);
if (!item) process.exit(1);
for (const [key, value] of Object.entries(item)) {
  process.stdout.write(`${key}: ${Array.isArray(value) ? value.join(" ") : value}\n`);
}
NODE
  "$NODE_COMMAND" - "$RELEASE_DIR/pm2/jlist.json" wufan-server <<'NODE' > "$RELEASE_DIR/pm2/wufan-server-describe.txt"
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).find((app) => app.name === process.argv[3]);
if (!item) process.exit(1);
for (const [key, value] of Object.entries(item)) {
  process.stdout.write(`${key}: ${Array.isArray(value) ? value.join(" ") : value}\n`);
}
NODE

  curl --fail --silent --show-error http://127.0.0.1:3001/api/health \
    > "$RELEASE_DIR/checks/health-before.json"

  CONFIG_PATHS=(
    "$HOME/Library/LaunchAgents/com.banran.pm2.plist"
    "$HOME/Library/LaunchAgents/com.wufan.workstation.backup.plist"
    "$HOME/Library/LaunchAgents/actions.runner.8vbdj59wnh-hue-wufan-workstation.wufan-runner.plist"
  )
  : > "$RELEASE_DIR/config/config-paths.txt"
  for config_path in "${CONFIG_PATHS[@]}"; do
    printf '%s\n' "$config_path" >> "$RELEASE_DIR/config/config-paths.txt"
    if [[ -f "$config_path" ]]; then
      cp "$config_path" "$RELEASE_DIR/config/$(basename "$config_path")"
    fi
  done
  {
    printf 'node=%s\n' "$NODE22_BIN/node"
    printf 'npm=%s\n' "$NODE22_BIN/npm"
    printf 'pm2=%s\n' "$(PATH="$NODE22_BIN:/opt/homebrew/bin:/usr/bin:/bin" command -v pm2)"
    printf 'sqlite3=%s\n' "$(command -v sqlite3)"
  } > "$RELEASE_DIR/config/runtime-paths.txt"
  [[ -f "$PROJECT_DIR/.node-version" ]] \
    && cp "$PROJECT_DIR/.node-version" "$RELEASE_DIR/config/node-version.txt"
  [[ -f "$PROJECT_DIR/ecosystem.config.cjs" ]] \
    && cp "$PROJECT_DIR/ecosystem.config.cjs" "$RELEASE_DIR/config/ecosystem.config.cjs"
fi

MANIFEST_ARGS=(
  --commit "$COMMIT_SHA"
  --change-type "$CHANGE_TYPE"
  --release-dir "$RELEASE_DIR"
  --status prepared
)
[[ "$DRY_RUN" == "true" ]] && MANIFEST_ARGS+=(--dry-run)
[[ -n "$BUNDLE_PATH" ]] && MANIFEST_ARGS+=(--bundle "$BUNDLE_PATH")
"$SCRIPT_DIR/release-manifest.sh" "${MANIFEST_ARGS[@]}"

"$NODE_COMMAND" -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
  "$RELEASE_DIR/release-manifest.json"

REQUIRED_FILES=(
  release-manifest.json
  git/current-head.txt
  git/target-head.txt
  git/status.txt
  git/branch.txt
  git/log-range.txt
  git/diff-stat.txt
  git/changed-files.txt
  git/package.json
  git/package-lock.json
  pm2/jlist.json
  pm2/dump.pm2
  pm2/wufan-client-describe.txt
  pm2/wufan-server-describe.txt
  checks/preflight.txt
  checks/database-backup.txt
  checks/health-before.json
  logs/prepare.log
)
for required_file in "${REQUIRED_FILES[@]}"; do
  [[ -f "$RELEASE_DIR/$required_file" ]] || fail "release evidence missing: $required_file"
done

log "release preparation verified"
echo "RELEASE_ID=$RELEASE_ID"
echo "RELEASE_DIR=$RELEASE_DIR"
echo "DRY_RUN=$DRY_RUN"
echo "READY_FOR_REAL_PREPARE=true"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN_DIRECTORY_WILL_BE_REMOVED=true"
fi
