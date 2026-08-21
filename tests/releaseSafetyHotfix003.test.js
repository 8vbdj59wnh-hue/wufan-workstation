import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

import { runBusinessBaselineCheck } from "../scripts/release-business-baseline-check.mjs";
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
