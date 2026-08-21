import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.env.WUFAN_PROJECT_DIR || process.cwd(), "package.json"));
const Database = require("better-sqlite3");

const CORE_TABLES = Object.freeze({
  erpSkus: "erp_skus",
  salesObjects: "sales_objects",
  products: "products",
  links: "sales_links",
  dailyFacts: "connection_sku_sales_daily_facts",
});

const DEFAULT_MINIMUMS = Object.freeze({
  erpSkus: 1_000,
  salesObjects: 1_000,
  products: 500,
  links: 1_000,
  dailyFacts: 1_000,
});

function releaseError(code, cause) {
  const error = new Error(code, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function classifyQueryError(error) {
  if (["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error?.code)) return "database_busy";
  if (["SQLITE_CORRUPT", "SQLITE_NOTADB"].includes(error?.code)) return "database_integrity_failed";
  return "baseline_query_failed";
}

function readBaseline(filePath) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw releaseError("baseline_query_failed", error);
  }
  if (baseline?.version !== 1 || typeof baseline.counts !== "object" || baseline.counts === null) {
    throw releaseError("baseline_query_failed");
  }
  return baseline;
}

export function readConsistentBusinessCounts(database) {
  const read = database.transaction(() => {
    const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const existingTables = new Set(tableRows.map((row) => row.name));
    const counts = {};
    const missingTables = [];
    for (const [key, table] of Object.entries(CORE_TABLES)) {
      if (!existingTables.has(table)) {
        counts[key] = 0;
        missingTables.push(table);
        continue;
      }
      counts[key] = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    }
    return { counts, missingTables };
  });
  return read.deferred();
}

export function runBusinessBaselineCheck({ databasePath, baselinePath, busyTimeoutMs = 250 }) {
  const baseline = readBaseline(baselinePath);
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: busyTimeoutMs });
    database.pragma(`busy_timeout = ${busyTimeoutMs}`);
    const { counts, missingTables } = readConsistentBusinessCounts(database);
    const minimumCounts = { ...DEFAULT_MINIMUMS, ...(baseline.minimumCounts ?? {}) };
    const maximumDeclineRatio = Number.isFinite(Number(baseline.maximumDeclineRatio))
      ? Number(baseline.maximumDeclineRatio)
      : 0.25;
    const failures = missingTables.map((table) => ({ code: "core_table_missing", table }));
    for (const key of Object.keys(CORE_TABLES)) {
      const current = counts[key];
      const previous = Number(baseline.counts[key] ?? 0);
      const minimum = Number(minimumCounts[key] ?? 0);
      if (current < minimum) failures.push({ code: "below_absolute_minimum", object: key, current, minimum });
      if (previous > 0 && current < previous * (1 - maximumDeclineRatio)) {
        failures.push({ code: "decline_ratio_exceeded", object: key, current, previous, maximumDeclineRatio });
      }
    }
    return {
      status: failures.length === 0 ? "ok" : "business_baseline_failed",
      errorType: failures.length === 0 ? null : "business_baseline_failed",
      databasePath,
      baselinePath,
      connectionCount: 1,
      busyTimeoutMs,
      counts,
      baselineCounts: baseline.counts,
      minimumCounts,
      maximumDeclineRatio,
      failures,
    };
  } catch (error) {
    const errorType = error?.code?.startsWith("baseline_") ? error.code : classifyQueryError(error);
    return {
      status: errorType,
      errorType,
      databasePath,
      baselinePath,
      connectionCount: 1,
      busyTimeoutMs,
      counts: null,
      failures: [{ code: errorType, sqliteCode: error?.code ?? null, message: error?.message ?? String(error) }],
    };
  } finally {
    database?.close();
  }
}

function parseArguments(argv) {
  const parsed = { databasePath: "", baselinePath: "", busyTimeoutMs: 250 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") parsed.databasePath = argv[++index] ?? "";
    else if (argument === "--baseline") parsed.baselinePath = argv[++index] ?? "";
    else if (argument === "--busy-timeout-ms") parsed.busyTimeoutMs = Number(argv[++index]);
    else throw releaseError("baseline_query_failed");
  }
  if (!parsed.databasePath || !pathIsAbsolute(parsed.databasePath) || !fs.existsSync(parsed.databasePath)) throw releaseError("baseline_query_failed");
  if (!parsed.baselinePath || !pathIsAbsolute(parsed.baselinePath) || !fs.existsSync(parsed.baselinePath)) throw releaseError("baseline_query_failed");
  if (!Number.isInteger(parsed.busyTimeoutMs) || parsed.busyTimeoutMs < 1 || parsed.busyTimeoutMs > 5_000) throw releaseError("baseline_query_failed");
  return parsed;
}

function pathIsAbsolute(value) {
  return value.startsWith("/");
}

export function isCliEntrypoint(moduleUrl = import.meta.url, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return fs.realpathSync(fileURLToPath(moduleUrl)) === fs.realpathSync(argvPath);
  } catch {
    return false;
  }
}

export function runBusinessBaselineCli(argv = process.argv.slice(2)) {
  let result;
  try {
    result = runBusinessBaselineCheck(parseArguments(argv));
  } catch (error) {
    result = {
      status: error.code ?? "baseline_query_failed",
      errorType: error.code ?? "baseline_query_failed",
      counts: null,
      failures: [{ code: error.code ?? "baseline_query_failed", message: error.message }],
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "ok") process.exitCode = 1;
  return result;
}

if (isCliEntrypoint()) {
  runBusinessBaselineCli();
}
