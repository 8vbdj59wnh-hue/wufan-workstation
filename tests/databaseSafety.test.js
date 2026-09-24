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
  isAllowedIsolationDatabasePath,
  resolveDatabasePath,
} from "../server/databaseSafety.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const configuredProductionDatabasePath = "/Users/wufan001/WufanWorkstationData/production/workstation.db";
const configuredProductionEnvironment = {
  WUFAN_ENV: "production",
  WUFAN_PROJECT_DIR: "/Users/wufan001/Projects/goal-execution-system",
  WUFAN_DATA_ROOT: "/Users/wufan001/WufanWorkstationData/production",
  WUFAN_DB_PATH: configuredProductionDatabasePath,
  WUFAN_DB_BASELINE_PATH: "/Users/wufan001/WufanWorkstationData/production/business-baseline.json",
  WUFAN_UPLOADS_PATH: "/Users/wufan001/WufanWorkstationData/production/uploads",
  WUFAN_AUTH_SECRET_PATH: "/Users/wufan001/WufanWorkstationData/production/auth.secret",
  WUFAN_RELEASE_ROOT: "/Users/wufan001/WufanWorkstationReleases",
};

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
    () => resolveDatabasePath({ environment: { ...configuredProductionEnvironment, WUFAN_DB_PATH: path.join(projectRoot, "data/workstation.db") }, projectRoot: configuredProductionEnvironment.WUFAN_PROJECT_DIR }),
    (error) => error.code === "production_database_path_inside_repository" || error.code === "production_database_path_outside_data_root",
  );
  assert.equal(resolveDatabasePath({
    environment: configuredProductionEnvironment,
    projectRoot: configuredProductionEnvironment.WUFAN_PROJECT_DIR,
  }), configuredProductionDatabasePath);
});

test("migration preview requires an explicit database inside its isolated root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-preview-"));
  const previewDatabase = path.join(directory, "preview.db");
  const environment = {
    WUFAN_ENV: "migration-preview",
    WUFAN_DB_PATH: previewDatabase,
    WUFAN_PRODUCTION_DB_PATH: configuredProductionDatabasePath,
    WUFAN_ISOLATION_DATABASE_ROOT: directory,
  };
  try {
    assert.equal(isAllowedIsolationDatabasePath(previewDatabase, environment), true);
    assert.equal(resolveDatabasePath({ environment, projectRoot }), previewDatabase);
    assert.throws(
      () => resolveDatabasePath({ environment: { ...environment, WUFAN_DB_PATH: "" }, projectRoot }),
      (error) => error.code === "isolation_database_path_required",
    );
    assert.throws(
      () => resolveDatabasePath({ environment: { ...environment, WUFAN_DB_PATH: "relative.db" }, projectRoot }),
      (error) => error.code === "isolation_database_path_must_be_absolute",
    );
    assert.throws(
      () => resolveDatabasePath({ environment: { ...environment, WUFAN_DB_PATH: configuredProductionDatabasePath }, projectRoot }),
      (error) => error.code === "isolation_database_path_not_allowed",
    );
    assert.throws(
      () => resolveDatabasePath({ environment: { ...environment, WUFAN_ISOLATION_DATABASE_ROOT: "" }, projectRoot }),
      (error) => error.code === "isolation_database_path_not_allowed",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("database module keeps the explicit preview path and child processes inherit it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-preview-module-"));
  const previewDatabase = path.join(directory, "preview.db");
  fs.closeSync(fs.openSync(previewDatabase, "w"));
  try {
    const result = runDatabaseModule(`
      import { spawnSync } from "node:child_process";
      import { databasePath } from "./server/db.js";
      const expected = process.env.WUFAN_DB_PATH;
      if (databasePath !== expected) process.exit(2);
      const child = spawnSync(process.execPath, ["--input-type=module", "--eval",
        'const {databasePath}=await import("./server/db.js");if(databasePath!==process.env.WUFAN_DB_PATH)process.exit(3)'],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" });
      if (child.status !== 0) throw new Error(child.stderr || "child path mismatch");
      process.env.WUFAN_DB_PATH = "/private/tmp/should-not-rebind.db";
      const cached = await import("./server/db.js");
      if (cached.databasePath !== expected) process.exit(4);
    `, {
      WUFAN_ENV: "migration-preview",
      WUFAN_DB_PATH: previewDatabase,
      WUFAN_ISOLATION_DATABASE_ROOT: directory,
      WUFAN_MIGRATION_PREVIEW: "1",
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
      { WUFAN_ENV: "migration-preview", WUFAN_ALLOW_DB_RESET: "1", WUFAN_ISOLATION_DATABASE_ROOT: directory },
    ]) {
      const target = environment.WUFAN_ENV === "test" && environment.WUFAN_ALLOW_DB_RESET === "1"
        ? configuredProductionDatabasePath
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

test("production reset remains blocked for a configured external database", () => {
  assert.throws(
    () => assertDatabaseResetAllowed(configuredProductionDatabasePath, {
      ...configuredProductionEnvironment,
      WUFAN_ALLOW_DB_RESET: "1",
    }),
    (error) => error.code === "production_database_reset_blocked",
  );
});

test("production database module refuses to load without an explicit path", () => {
  const result = runDatabaseModule('await import("./server/db.js")', {
    ...configuredProductionEnvironment,
    WUFAN_PROJECT_DIR: projectRoot,
    WUFAN_DATA_ROOT: "/Users/mac/WufanWorkstationPathTest/production",
    WUFAN_DB_BASELINE_PATH: "/Users/mac/WufanWorkstationPathTest/production/business-baseline.json",
    WUFAN_UPLOADS_PATH: "/Users/mac/WufanWorkstationPathTest/production/uploads",
    WUFAN_AUTH_SECRET_PATH: "/Users/mac/WufanWorkstationPathTest/production/auth.secret",
    WUFAN_ENV: "production",
    WUFAN_DB_PATH: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /wufan_db_path_required|production_database_path_required/u);
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
