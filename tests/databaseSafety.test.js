import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

import {
  assertBusinessBaselineHealthy,
  assertDatabaseResetAllowed,
  evaluateDatabaseHealth,
  productionDatabasePath,
  resolveDatabasePath,
} from "../server/databaseSafety.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

function runDatabaseModule(source, environment) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

test("production requires the locked external database path", () => {
  assert.throws(
    () => resolveDatabasePath({ environment: { WUFAN_ENV: "production" }, projectRoot }),
    (error) => error.code === "production_database_path_required",
  );
  assert.throws(
    () => resolveDatabasePath({ environment: { WUFAN_ENV: "production", WUFAN_DB_PATH: path.join(projectRoot, "data/workstation.db") }, projectRoot }),
    (error) => error.code === "production_database_path_not_locked",
  );
  assert.equal(resolveDatabasePath({
    environment: { WUFAN_ENV: "production", WUFAN_DB_PATH: productionDatabasePath },
    projectRoot,
  }), productionDatabasePath);
});

test("reset is allowed only for an explicitly enabled test temporary database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-safety-"));
  const temporaryDatabase = path.join(directory, "workstation.db");
  try {
    assert.doesNotThrow(() => assertDatabaseResetAllowed(temporaryDatabase, {
      WUFAN_ENV: "test",
      WUFAN_ALLOW_DB_RESET: "1",
      WUFAN_TEST_DATABASE_ROOT: directory,
    }));
    for (const environment of [
      { WUFAN_ENV: "production", WUFAN_ALLOW_DB_RESET: "1" },
      { WUFAN_ENV: "test" },
      { WUFAN_ENV: "test", WUFAN_ALLOW_DB_RESET: "1", WUFAN_TEST_DATABASE_ROOT: directory },
    ]) {
      const target = environment.WUFAN_ENV === "test" && environment.WUFAN_ALLOW_DB_RESET === "1"
        ? productionDatabasePath
        : temporaryDatabase;
      assert.throws(
        () => assertDatabaseResetAllowed(target, environment),
        (error) => error.code === "production_database_reset_blocked",
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("initializeDatabase blocks a production reset before touching the file", () => {
  const result = runDatabaseModule(`
    import { initializeDatabase } from "./server/db.js";
    try {
      initializeDatabase({ reset: true });
      process.exit(2);
    } catch (error) {
      if (error.code !== "production_database_reset_blocked") throw error;
    }
  `, {
    WUFAN_ENV: "production",
    WUFAN_DB_PATH: productionDatabasePath,
    WUFAN_ALLOW_DB_RESET: "1",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("production database module refuses to load without an explicit path", () => {
  const result = runDatabaseModule('await import("./server/db.js")', {
    WUFAN_ENV: "production",
    WUFAN_DB_PATH: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production_database_path_required/u);
});

test("initializeDatabase reset works against an explicitly enabled temporary test database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-reset-integration-"));
  const temporaryDatabase = path.join(directory, "workstation.db");
  try {
    const result = runDatabaseModule(`
      import fs from "node:fs";
      import { databasePath, initializeDatabase } from "./server/db.js";
      initializeDatabase({ reset: true });
      if (!fs.existsSync(databasePath)) process.exit(2);
    `, {
      WUFAN_ENV: "test",
      WUFAN_DB_PATH: temporaryDatabase,
      WUFAN_TEST_DATABASE_ROOT: directory,
      WUFAN_ALLOW_DB_RESET: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(temporaryDatabase));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a cliff-edge business count decline fails the production baseline", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-baseline-"));
  const databasePath = path.join(directory, "workstation.db");
  const baselinePath = path.join(directory, "business-baseline.json");
  const database = new Database(databasePath);
  try {
    for (const table of ["erp_skus", "sales_objects", "products", "sales_links", "connection_sku_sales_daily_facts"]) {
      database.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY)`);
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify({
      version: 1,
      recordedAt: "2026-08-20T13:44:52.000Z",
      counts: { erpSkus: 6906, salesObjects: 8099, products: 2958, links: 9293, dailyFacts: 11548 },
      maximumDeclineRatio: 0.25,
    })}\n`);
    const health = evaluateDatabaseHealth(database, {
      environment: { WUFAN_ENV: "test", WUFAN_ENFORCE_DB_BASELINE: "1", WUFAN_DB_BASELINE_PATH: baselinePath },
      baselinePath,
    });
    assert.equal(health.technicalHealth.status, "ok");
    assert.equal(health.businessDataHealth.status, "baseline_failed");
    assert.ok(health.businessDataHealth.failures.some((failure) => failure.code === "decline_ratio_exceeded"));
    assert.throws(() => assertBusinessBaselineHealthy(health), (error) => error.code === "database_baseline_failed");
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
