import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalizePath, resolveProductionPaths } = require("./productionPaths.cjs");

export const coreBusinessTables = Object.freeze({
  erpSkus: "erp_skus",
  salesObjects: "sales_objects",
  products: "products",
  links: "sales_links",
  dailyFacts: "connection_sku_sales_daily_facts",
});

export const defaultMinimumCounts = Object.freeze({
  erpSkus: 1_000,
  salesObjects: 1_000,
  products: 500,
  links: 1_000,
  dailyFacts: 1_000,
});

const clean = (value) => String(value ?? "").trim();
const isProduction = (environment = process.env) => clean(environment.WUFAN_ENV).toLowerCase() === "production";
const isTest = (environment = process.env) => clean(environment.WUFAN_ENV).toLowerCase() === "test";
const isIsolation = (environment = process.env) => ["isolation", "migration-preview"].includes(clean(environment.WUFAN_ENV).toLowerCase());

function safetyError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pathIsInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function allowedTestRoots(environment = process.env) {
  const roots = [os.tmpdir(), "/tmp", "/private/tmp"];
  const explicitRoot = clean(environment.WUFAN_TEST_DATABASE_ROOT);
  if (explicitRoot !== "") roots.push(explicitRoot);
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function isAllowedTestDatabasePath(databasePath, environment = process.env) {
  const resolved = path.resolve(databasePath);
  return allowedTestRoots(environment).some((root) => pathIsInside(resolved, root));
}

export function isAllowedIsolationDatabasePath(databasePath, environment = process.env) {
  const isolationRoot = clean(environment.WUFAN_ISOLATION_DATABASE_ROOT);
  if (isolationRoot === "" || !path.isAbsolute(isolationRoot)) return false;
  const resolved = path.resolve(databasePath);
  const configuredProductionPath = clean(environment.WUFAN_PRODUCTION_DB_PATH);
  return (configuredProductionPath === "" || resolved !== path.resolve(configuredProductionPath))
    && pathIsInside(resolved, isolationRoot);
}

export function resolveDatabasePath({ environment = process.env, projectRoot } = {}) {
  const configuredPath = clean(environment.WUFAN_DB_PATH);
  if (isProduction(environment)) {
    if (configuredPath === "") throw safetyError("production_database_path_required");
    try {
      const paths = resolveProductionPaths(environment);
      const resolvedProject = canonicalizePath(projectRoot, "PROJECT_ROOT");
      if (paths.projectDir !== resolvedProject) throw safetyError("production_project_path_mismatch");
      return paths.databasePath;
    } catch (error) {
      if (error.code === "wufan_db_path_must_be_absolute") throw safetyError("production_database_path_must_be_absolute");
      throw error;
    }
  }
  if (isTest(environment)) {
    if (configuredPath === "" || !path.isAbsolute(configuredPath)) {
      throw safetyError("test_database_path_required");
    }
    const resolved = path.resolve(configuredPath);
    if (!isAllowedTestDatabasePath(resolved, environment)) {
      throw safetyError("test_database_path_not_isolated");
    }
    return resolved;
  }
  if (isIsolation(environment)) {
    if (configuredPath === "") throw safetyError("isolation_database_path_required");
    if (!path.isAbsolute(configuredPath)) throw safetyError("isolation_database_path_must_be_absolute");
    const resolved = path.resolve(configuredPath);
    if (!isAllowedIsolationDatabasePath(resolved, environment)) {
      throw safetyError("isolation_database_path_not_allowed");
    }
    if (pathIsInside(resolved, projectRoot)) throw safetyError("isolation_database_path_inside_repository");
    return resolved;
  }
  return configuredPath === ""
    ? path.join(projectRoot, "data", "workstation.db")
    : path.resolve(configuredPath);
}

export function assertDatabaseCanOpen(databasePath, environment = process.env) {
  if (isProduction(environment)) {
    const configured = resolveProductionPaths(environment).databasePath;
    if (canonicalizePath(databasePath, "WUFAN_DB_PATH") !== configured) {
      throw safetyError("production_database_path_not_locked");
    }
    if (!fs.existsSync(databasePath)) throw safetyError("production_database_missing");
    if (!fs.statSync(databasePath).isFile()) throw safetyError("production_database_not_a_file");
    return;
  }
  if (isIsolation(environment)) {
    if (!isAllowedIsolationDatabasePath(databasePath, environment)) {
      throw safetyError("isolation_database_path_not_allowed");
    }
    if (!fs.existsSync(databasePath)) throw safetyError("isolation_database_missing");
    if (!fs.statSync(databasePath).isFile()) throw safetyError("isolation_database_not_a_file");
  }
}

export function assertDatabaseResetAllowed(databasePath, environment = process.env) {
  const resetAllowed = clean(environment.WUFAN_ALLOW_DB_RESET).toLowerCase();
  const explicitlyAllowed = resetAllowed === "1" || resetAllowed === "true";
  if (!isTest(environment) || !explicitlyAllowed || !isAllowedTestDatabasePath(databasePath, environment)) {
    throw safetyError("production_database_reset_blocked");
  }
}

export function shouldEnforceBusinessBaseline(environment = process.env) {
  return isProduction(environment) || clean(environment.WUFAN_ENFORCE_DB_BASELINE) === "1";
}

export function resolveBusinessBaselinePath(environment = process.env) {
  if (isProduction(environment)) return resolveProductionPaths(environment).baselinePath;
  const configuredPath = clean(environment.WUFAN_DB_BASELINE_PATH);
  if (configuredPath !== "") {
    if (!path.isAbsolute(configuredPath)) throw safetyError("database_baseline_path_must_be_absolute");
    return path.resolve(configuredPath);
  }
  return "";
}

export function readCoreBusinessCounts(database) {
  const counts = {};
  const missingTables = [];
  for (const [key, table] of Object.entries(coreBusinessTables)) {
    const exists = database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name=?").get(table).count > 0;
    if (!exists) {
      counts[key] = 0;
      missingTables.push(table);
      continue;
    }
    counts[key] = Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
  }
  return { counts, missingTables };
}

export function readBusinessBaseline(baselinePath) {
  if (baselinePath === "" || !fs.existsSync(baselinePath)) {
    throw safetyError("database_baseline_missing");
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline?.version !== 1 || typeof baseline.counts !== "object" || baseline.counts === null) {
    throw safetyError("database_baseline_invalid");
  }
  return baseline;
}

export function evaluateBusinessDataHealth(database, {
  environment = process.env,
  baselinePath = resolveBusinessBaselinePath(environment),
} = {}) {
  const { counts, missingTables } = readCoreBusinessCounts(database);
  if (!shouldEnforceBusinessBaseline(environment)) {
    return { status: "not_enforced", counts, missingTables, failures: [] };
  }

  let baseline;
  try {
    baseline = readBusinessBaseline(baselinePath);
  } catch (error) {
    return {
      status: "baseline_failed",
      counts,
      missingTables,
      failures: [{ code: error.code ?? "database_baseline_invalid" }],
    };
  }

  const minimums = { ...defaultMinimumCounts, ...(baseline.minimumCounts ?? {}) };
  const maximumDeclineRatio = Number.isFinite(Number(baseline.maximumDeclineRatio))
    ? Number(baseline.maximumDeclineRatio)
    : 0.25;
  const failures = missingTables.map((table) => ({ code: "core_table_missing", table }));
  for (const key of Object.keys(coreBusinessTables)) {
    const current = Number(counts[key] ?? 0);
    const minimum = Number(minimums[key] ?? 0);
    const previous = Number(baseline.counts[key] ?? 0);
    if (current < minimum) {
      failures.push({ code: "below_absolute_minimum", object: key, current, minimum });
    }
    if (previous > 0 && current < previous * (1 - maximumDeclineRatio)) {
      failures.push({
        code: "decline_ratio_exceeded",
        object: key,
        current,
        previous,
        declineRatio: (previous - current) / previous,
        maximumDeclineRatio,
      });
    }
  }
  return {
    status: failures.length === 0 ? "ok" : "baseline_failed",
    counts,
    missingTables,
    baseline: {
      path: baselinePath,
      recordedAt: baseline.recordedAt ?? null,
      databaseSha256: baseline.databaseSha256 ?? null,
      counts: baseline.counts,
      minimumCounts: minimums,
      maximumDeclineRatio,
    },
    failures,
  };
}

export function evaluateTechnicalHealth(database) {
  try {
    database.prepare("SELECT 1").get();
    const integrity = database.pragma("integrity_check", { simple: true });
    const foreignKeyFailures = database.pragma("foreign_key_check");
    return {
      status: integrity === "ok" && foreignKeyFailures.length === 0 ? "ok" : "failed",
      sqlite: "ok",
      integrity,
      foreignKeyFailureCount: foreignKeyFailures.length,
    };
  } catch (error) {
    return {
      status: "failed",
      sqlite: "error",
      integrity: "error",
      foreignKeyFailureCount: null,
      error: error.message,
    };
  }
}

export function evaluateDatabaseHealth(database, options = {}) {
  const technicalHealth = evaluateTechnicalHealth(database);
  const businessDataHealth = evaluateBusinessDataHealth(database, options);
  return {
    status: technicalHealth.status === "ok" && businessDataHealth.status !== "baseline_failed" ? "ok" : "error",
    technicalHealth,
    businessDataHealth,
  };
}

export function assertBusinessBaselineHealthy(health) {
  if (health.businessDataHealth.status === "baseline_failed") {
    const error = safetyError("database_baseline_failed");
    error.health = health;
    throw error;
  }
  if (health.technicalHealth.status !== "ok") {
    const error = safetyError("database_technical_health_failed");
    error.health = health;
    throw error;
  }
}
