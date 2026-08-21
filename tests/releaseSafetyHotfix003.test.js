import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

import { isCliEntrypoint, runBusinessBaselineCheck } from "../scripts/release-business-baseline-check.mjs";
import {
  beginReleaseManagedJob,
  clearReleaseMaintenanceMarker,
  finishReleaseManagedJob,
  readReleaseMaintenanceStatus,
  writeReleaseMaintenanceMarker,
} from "../server/releaseMaintenanceService.js";
import { shouldRecordApiUsage } from "../server/apiUsageLedgerService.js";
import { scheduleV3ShadowObservation } from "../server/v3ShadowObservationService.js";

function baselineFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-baseline-hotfix-"));
  const databasePath = path.join(directory, "workstation.db");
  const baselinePath = path.join(directory, "business-baseline.json");
  const database = new Database(databasePath);
  for (const table of ["erp_skus", "sales_objects", "products", "sales_links", "connection_sku_sales_daily_facts"]) {
    database.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY); INSERT INTO ${table}(id) VALUES ('one')`);
  }
  database.close();
  fs.writeFileSync(baselinePath, `${JSON.stringify({
    version: 1,
    counts: { erpSkus: 1, salesObjects: 1, products: 1, links: 1, dailyFacts: 1 },
    minimumCounts: { erpSkus: 0, salesObjects: 0, products: 0, links: 0, dailyFacts: 0 },
    maximumDeclineRatio: 0.25,
  })}\n`);
  return { directory, databasePath, baselinePath };
}

async function holdExclusiveLock(databasePath, durationMs) {
  const source = `
    const Database = require("better-sqlite3");
    const database = new Database(process.argv[1]);
    database.exec("BEGIN EXCLUSIVE");
    process.stdout.write("locked\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
    database.exec("COMMIT");
    database.close();
  `;
  const child = spawn(process.execPath, ["--eval", source, databasePath, String(durationMs)], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("locked")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("locked")) reject(new Error(`lock holder exited early: ${code}`));
    });
  });
  return child;
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}

test("baseline uses one connection and absorbs twenty normal short locks", async () => {
  const fixture = baselineFixture();
  const markerPath = path.join(fixture.directory, "release-maintenance.json");
  const maintenanceOptions = { markerPath, environment: {} };
  try {
    for (let round = 0; round < 20; round += 1) {
      writeReleaseMaintenanceMarker({ releaseId: `round-${round}` }, maintenanceOptions);
      assert.equal(shouldRecordApiUsage({ originalUrl: "/api/health" }), false);
      const holder = await holdExclusiveLock(fixture.databasePath, 35);
      const result = runBusinessBaselineCheck({ ...fixture, busyTimeoutMs: 250 });
      await waitForExit(holder);
      assert.equal(result.status, "ok", JSON.stringify(result));
      assert.equal(result.connectionCount, 1);
      assert.deepEqual(result.counts, { erpSkus: 1, salesObjects: 1, products: 1, links: 1, dailyFacts: 1 });
      const snapshotPath = path.join(fixture.directory, `preview-${round}.db`);
      const source = new Database(fixture.databasePath, { readonly: true, fileMustExist: true });
      await source.backup(snapshotPath);
      source.close();
      const preview = new Database(snapshotPath);
      preview.exec("CREATE TABLE IF NOT EXISTS release_preview_guard(id TEXT PRIMARY KEY)");
      preview.exec("CREATE TABLE IF NOT EXISTS release_preview_guard(id TEXT PRIMARY KEY)");
      assert.equal(preview.pragma("integrity_check", { simple: true }), "ok");
      assert.equal(preview.pragma("foreign_key_check").length, 0);
      preview.close();
      assert.equal(runBusinessBaselineCheck({ databasePath: snapshotPath, baselinePath: fixture.baselinePath, busyTimeoutMs: 250 }).status, "ok");
      clearReleaseMaintenanceMarker(maintenanceOptions);
      assert.equal(readReleaseMaintenanceStatus(maintenanceOptions).active, false);
    }
  } finally {
    clearReleaseMaintenanceMarker(maintenanceOptions);
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("baseline CLI entrypoint recognizes logical and symlink paths by physical identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-baseline-symlink-"));
  try {
    const physical = path.join(directory, "baseline.mjs");
    const logical = path.join(directory, "current-baseline.mjs");
    fs.writeFileSync(physical, "// fixture\n");
    fs.symlinkSync(physical, logical);
    assert.equal(isCliEntrypoint(new URL(`file://${physical}`).href, logical), true);
    assert.equal(isCliEntrypoint(new URL(`file://${physical}`).href, path.join(directory, "missing.mjs")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline shell CLI emits parseable JSON through a symlinked package path", async () => {
  const fixture = baselineFixture();
  const repository = path.resolve(import.meta.dirname, "..");
  const physicalPackage = path.join(fixture.directory, "physical-package");
  const logicalPackage = path.join(fixture.directory, "current");
  fs.mkdirSync(physicalPackage);
  fs.cpSync(path.join(repository, "scripts"), path.join(physicalPackage, "scripts"), { recursive: true });
  fs.symlinkSync(physicalPackage, logicalPackage);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(path.join(logicalPackage, "scripts", "release-business-baseline-check.sh"), [
      "--database", fixture.databasePath,
      "--baseline", fixture.baselinePath,
    ], {
      cwd: logicalPackage,
      env: { ...process.env, WUFAN_PROJECT_DIR: repository, WUFAN_NODE_COMMAND: process.execPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
  try {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.trim().length > 0);
    assert.equal(JSON.parse(result.stdout).status, "ok");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("baseline shell CLI blocks successful child processes that emit empty stdout", async () => {
  const fixture = baselineFixture();
  const repository = path.resolve(import.meta.dirname, "..");
  const packageRoot = path.join(fixture.directory, "empty-output-package");
  fs.mkdirSync(packageRoot);
  fs.cpSync(path.join(repository, "scripts", "release-business-baseline-check.sh"), path.join(packageRoot, "release-business-baseline-check.sh"));
  fs.writeFileSync(path.join(packageRoot, "release-business-baseline-check.mjs"), "process.exitCode = 0;\n");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(path.join(packageRoot, "release-business-baseline-check.sh"), [
      "--database", fixture.databasePath,
      "--baseline", fixture.baselinePath,
    ], {
      cwd: packageRoot,
      env: { ...process.env, WUFAN_PROJECT_DIR: repository, WUFAN_NODE_COMMAND: process.execPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
  try {
    assert.equal(result.code, 65);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /baseline_cli_contract_violation/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("pre-switch dry run stops after real readiness gates and before Git mutation", () => {
  const repository = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(repository, "scripts", "release-from-package.sh"), "utf8");
  const migration = source.indexOf('STAGE="migration-preview"');
  const health = source.indexOf('STAGE="health-before"');
  const staging = source.indexOf('STAGE="source-staging"');
  const ready = source.indexOf('if [[ "$PRE_SWITCH_DRY_RUN" == true ]]');
  const fastForward = source.indexOf('STAGE="git-fast-forward"');
  assert.ok(migration > 0 && health > migration && staging > health && ready > staging && fastForward > ready);
  assert.match(source.slice(ready, fastForward), /NEXT_STAGE=git-fast-forward/);
  assert.match(source.slice(ready, fastForward), /SOURCE_UPDATED=false/);
});

test("baseline blocks five sustained locks as database_busy without fake zero counts", async () => {
  const fixture = baselineFixture();
  try {
    for (let round = 0; round < 5; round += 1) {
      const holder = await holdExclusiveLock(fixture.databasePath, 400);
      const result = runBusinessBaselineCheck({ ...fixture, busyTimeoutMs: 100 });
      await waitForExit(holder);
      assert.equal(result.status, "database_busy", JSON.stringify(result));
      assert.equal(result.errorType, "database_busy");
      assert.equal(result.counts, null);
      assert.equal(result.failures[0].sqliteCode, "SQLITE_BUSY");
    }
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("release maintenance rejects new managed jobs and lets in-flight work drain", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-maintenance-"));
  const markerPath = path.join(directory, "maintenance.json");
  const options = { markerPath, environment: {} };
  try {
    const token = beginReleaseManagedJob("inventory_sync", options);
    assert.ok(token);
    writeReleaseMaintenanceMarker({ releaseId: "release-test" }, options);
    assert.equal(beginReleaseManagedJob("shadow", options), null);
    assert.deepEqual(scheduleV3ShadowObservation({ type: "test" }, {
      ...options,
      flags: { projection: "on", shadowEnabled: true, relationWrite: false, relationRead: false },
    }), { scheduled: false, reason: "release_maintenance" });
    assert.equal(readReleaseMaintenanceStatus(options).activeWriteJobs, 1);
    finishReleaseManagedJob(token);
    assert.equal(readReleaseMaintenanceStatus(options).activeWriteJobs, 0);
    clearReleaseMaintenanceMarker(options);
    assert.equal(readReleaseMaintenanceStatus(options).active, false);
  } finally {
    clearReleaseMaintenanceMarker(options);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("health and release maintenance probes never write usage ledger", () => {
  assert.equal(shouldRecordApiUsage({ originalUrl: "/api/health" }), false);
  assert.equal(shouldRecordApiUsage({ originalUrl: "/api/release-maintenance/status?full=1" }), false);
  assert.equal(shouldRecordApiUsage({ originalUrl: "/api/products?page=1" }), true);
});
