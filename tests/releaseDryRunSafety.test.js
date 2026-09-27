import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../scripts/release-from-package.sh", import.meta.url), "utf8");
const healthCheckSource = fs.readFileSync(new URL("../scripts/release-health-check.sh", import.meta.url), "utf8");

test("ordinary dry-run exits before maintenance and release creation", () => {
  const dryRunExit = source.indexOf('if [[ "$DRY_RUN" == true ]]; then\n  echo "DATABASE_BACKUP_CREATED=false"');
  const maintenance = source.indexOf('"$PACKAGE_DIR/scripts/release-maintenance-mode.mjs" enter');
  const releaseDirectory = source.indexOf('RELEASE_ID="release-$TIMESTAMP-${TARGET_COMMIT:0:8}"');
  assert.ok(dryRunExit > 0);
  assert.ok(maintenance > dryRunExit);
  assert.ok(releaseDirectory > maintenance);

  const dryRunBlock = source.slice(dryRunExit, maintenance);
  assert.match(dryRunBlock, /DATABASE_BACKUP_CREATED=false/u);
  assert.match(dryRunBlock, /SOURCE_UPDATED=false/u);
  assert.match(dryRunBlock, /SERVICE_RESTARTED=false/u);
  assert.match(dryRunBlock, /TAG_CREATED=false/u);
  assert.match(dryRunBlock, /exit 0/u);
});

test("ordinary dry-run inspects bundles only in a temporary repository", () => {
  assert.match(source, /BUNDLE_INSPECTION_DIR="\$\(mktemp -d \/tmp\/wufan-bundle-inspection\.XXXXXX\)"/u);
  assert.match(source, /git -C "\$BUNDLE_INSPECTION_DIR" bundle unbundle/u);
  assert.match(source, /GIT_INSPECTION_DIR="\$BUNDLE_INSPECTION_DIR"/u);
  assert.match(source, /PROJECT_DIR="\$GIT_INSPECTION_DIR" NODE_COMMAND="\$NODE_COMMAND"/u);
});

test("production package ref cleanup only runs after a formal import", () => {
  assert.match(source, /PACKAGE_REF_IMPORTED=false/u);
  assert.match(source, /if \[\[ "\$PACKAGE_REF_IMPORTED" == true \]\]; then\s+git -C "\$EXPECTED_PROJECT_DIR" update-ref -d/u);
  assert.match(source, /git -C "\$PROJECT_DIR" update-ref "\$PACKAGE_REF" "\$TARGET_COMMIT"\s+PACKAGE_REF_IMPORTED=true/u);
});

test("dry-run retains read-only service and data gates", () => {
  const dryRunExit = source.indexOf('if [[ "$DRY_RUN" == true ]]; then\n  echo "DATABASE_BACKUP_CREATED=false"');
  const prefix = source.slice(0, dryRunExit);
  assert.match(prefix, /PM2_JSON="\$\("\$PM2_COMMAND" jlist\)"/u);
  assert.match(prefix, /port in 5173 3001/u);
  assert.match(prefix, /api\/health/u);
  assert.match(prefix, /PRAGMA integrity_check/u);
  assert.match(prefix, /release-business-baseline-check\.sh/u);
  assert.match(prefix, /release-classify\.sh/u);
});

test("release resolves the configured Node 22 runtime instead of requiring a Homebrew location", () => {
  assert.match(source, /source "\$SCRIPT_DIR\/lib\/node-runtime\.sh"/u);
  assert.match(source, /wufan_resolve_node_runtime/u);
  assert.doesNotMatch(source, /NODE_COMMAND="\$NODE22_BIN\/node"/u);
  assert.doesNotMatch(source, /NPM_COMMAND="\$NODE22_BIN\/npm"/u);
  assert.doesNotMatch(source, /\bpm2 (jlist|stop|restart|save)\b/u);
});

test("post-release health check uses the same configured Node and PM2 runtime", () => {
  assert.match(healthCheckSource, /source "\$SCRIPT_DIR\/lib\/node-runtime\.sh"/u);
  assert.match(healthCheckSource, /wufan_resolve_node_runtime/u);
  assert.match(healthCheckSource, /PM2_RAW="\$\("\$PM2_COMMAND" jlist\)"/u);
  assert.doesNotMatch(healthCheckSource, /NODE22_BIN/u);
  assert.doesNotMatch(healthCheckSource, /\bpm2 jlist\b/u);
});
