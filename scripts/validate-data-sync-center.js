import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-data-sync-center-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");

const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase();
const database = databaseModule.getDatabase();
const service = await import("../server/dataSyncCenterService.js");

const initial = service.getDataSyncCenterOverview();
assert.equal(initial.tasks.length, 6);
assert.equal(initial.tasks.filter((task) => task.transportType === "api").length, 3);
assert.equal(initial.tasks.filter((task) => task.executionMode === "manual").length, 3);

const erpTask = initial.tasks.find((task) => task.taskCode === "erp_goods");
assert.equal(erpTask.status, "paused");
service.setDataSyncTaskStatus(erpTask.id, "enabled");
const queued = service.createManualDataSyncBatch(erpTask.id, { syncMode: "full", requestStart: "2021-01-01T00:00:00Z", requestEnd: "2026-08-04T23:59:59Z", createdBy: "person-admin" });
assert.equal(queued.status, "queued");
assert.equal(queued.triggerMode, "manual");
service.startDataSyncBatch(queued.id);
const completed = service.completeDataSyncBatch(queued.id, {
  status: "partial", totalCount: 100, createdCount: 80, updatedCount: 19,
  exceptions: [{ exceptionType: "field_error", message: "模拟字段异常", entityType: "erp_sku", entityId: "SKU-ERROR" }],
});
assert.equal(completed.status, "partial");
assert.equal(completed.exceptionCount, 1);
assert.equal(service.getDataSyncTask(erpTask.id).lastSuccessAt, "2026-08-04T23:59:59Z", "部分成功应保留已读取完成的增量水位");

const overview = service.getDataSyncCenterOverview();
assert.equal(overview.batches.length, 1);
assert.equal(overview.exceptions.length, 1);
assert.equal(overview.counts.openExceptionCount, 1);
service.resolveDataSyncException(overview.exceptions[0].id, { note: "已人工确认", resolvedBy: "person-admin" });
assert.equal(service.getDataSyncCenterOverview().counts.openExceptionCount, 0);

databaseModule.closeDatabase();
databaseModule.initializeDatabase();
assert.equal(databaseModule.getDatabase().prepare("SELECT COUNT(*) total FROM data_sync_tasks").get().total, 6, "重复迁移不得重复初始化任务");
assert.equal(databaseModule.getDatabase().pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(databaseModule.getDatabase().pragma("foreign_key_check"), []);
databaseModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });

console.log(JSON.stringify({ tasks: 6, apiTasks: 3, manualTasks: 3, lifecycle: ["queued", "running", "partial"], exceptionResolved: true, migrationIdempotent: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
