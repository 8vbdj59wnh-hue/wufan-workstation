import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-link-data-status-"));
const databasePath = path.join(directory, "isolated.db");
process.env.WUFAN_DB_PATH = databasePath;
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE data_sync_tasks (id TEXT PRIMARY KEY,taskCode TEXT,name TEXT);
  CREATE TABLE data_sync_batches (id TEXT PRIMARY KEY,taskId TEXT,status TEXT,periodEnd TEXT,requestEnd TEXT,exceptionCount INTEGER,sourceBatchId TEXT,createdAt TEXT,startedAt TEXT,completedAt TEXT);
  CREATE TABLE data_sync_exceptions (id TEXT PRIMARY KEY,taskId TEXT,batchId TEXT,status TEXT);
  CREATE TABLE connection_import_batches (id TEXT PRIMARY KEY,sourceType TEXT,importType TEXT,businessDate TEXT,periodEnd TEXT,status TEXT,errorRows INTEGER,createdAt TEXT,updatedAt TEXT,completedAt TEXT);
  CREATE TABLE connection_import_rows (id TEXT PRIMARY KEY,batchId TEXT,status TEXT);
  CREATE TABLE connection_sku_sales_facts (id TEXT PRIMARY KEY,periodEnd TEXT);
  CREATE TABLE connection_period_snapshots (id TEXT PRIMARY KEY,periodEnd TEXT);
`);
database.prepare("INSERT INTO data_sync_tasks VALUES (?,?,?)").run("task-sales", "sales_fact_excel_import", "真实销售导入");
database.prepare("INSERT INTO data_sync_batches VALUES (?,?,?,?,?,?,?,?,?,?)").run("batch-sales", "task-sales", "completed", "2026-08-08", null, 1, null, "2026-08-09T01:00:00Z", "2026-08-09T01:01:00Z", "2026-08-09T01:02:00Z");
database.prepare("INSERT INTO data_sync_exceptions VALUES (?,?,?,?)").run("exception-1", "task-sales", "batch-sales", "open");
database.prepare("INSERT INTO connection_sku_sales_facts VALUES (?,?)").run("fact-1", "2026-08-08T23:59:59Z");
database.prepare("INSERT INTO connection_period_snapshots VALUES (?,?)").run("snapshot-1", "2026-08-07");
database.close();

const { getLinkDataStatus } = await import("../server/linkDataStatusService.js");
const operator = getLinkDataStatus();
if (operator.latestDataDate !== "2026-08-08" || operator.status !== "updated_with_exceptions" || operator.exceptionCount !== 1) throw new Error("运营摘要验证失败。");
if (operator.details !== undefined) throw new Error("运营摘要不应包含管理员技术明细。");
const admin = getLinkDataStatus({ includeDetails: true });
if (admin.details.latestBatch.id !== "batch-sales" || admin.details.exceptionCounts.unified !== 1) throw new Error("管理员明细验证失败。");
const check = new Database(databasePath, { readonly: true });
if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("integrity_check 失败。");
if (check.pragma("foreign_key_check").length) throw new Error("foreign_key_check 失败。");
check.close();
console.log(JSON.stringify({ operator, adminDetails: admin.details, integrityCheck: "ok", foreignKeyCheck: 0 }));
