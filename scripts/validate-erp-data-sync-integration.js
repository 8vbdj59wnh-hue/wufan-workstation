import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-erp-data-sync-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const db = dbModule.getDatabase();
const center = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/erpGoodsDataSyncAdapter.js");

const task = center.getDataSyncTask("sync-task-erp-goods");
assert.equal(task.status, "paused");
center.setDataSyncTaskStatus(task.id, "enabled");
const productsBefore = db.prepare("SELECT COUNT(*) total FROM products").get().total;

function payload(count, suffix, updatedName = "") {
  return { status: 0, data: { total_count: count, goods_list: Array.from({ length: count }, (_, index) => ({
    goods_id: index + 1,
    goods_no: `G-${suffix}-${index + 1}`,
    goods_name: updatedName || `货品 ${index + 1}`,
    modified: "2026-08-04 12:00:00",
    deleted: 0,
    spec_list: [{ spec_id: index + 1, spec_no: `SKU-${suffix}-${index + 1}`, spec_name: `规格 ${index + 1}`, spec_modified: "2026-08-04 12:00:00", deleted: 0 }],
  })) } };
}

const previewV1 = await adapter.previewErpGoodsDataSync({
  taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-02 00:00:00", createdBy: "person-admin",
  queryGoods: async () => payload(5, "V1"),
});
assert.equal(previewV1.summary.previewVersion, 1);
assert.equal(previewV1.dataSyncBatch.status, "preview_ready");

const previewV2 = await adapter.previewErpGoodsDataSync({
  taskId: task.id, syncMode: "full", requestStart: "2026-01-01 00:00:00", requestEnd: "2026-08-04 00:00:00", createdBy: "person-admin",
  queryGoods: async () => payload(10, "V2"),
});
assert.equal(previewV2.summary.previewVersion, 2);
assert.equal(adapter.readErpGoodsDataSyncPreview(previewV2.dataSyncBatch.id).summary.previewVersion, 2);
assert.equal(adapter.readErpGoodsDataSyncPreview(previewV1.dataSyncBatch.id).isCurrent, false);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_batches WHERE taskId=?").get(task.id).total, 2);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_import_batches WHERE dataSource='wangdian_api'").get().total, 2);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_sync_runs").get().total, 0, "新入口不得创建旧ERP同步任务");
assert.throws(() => adapter.commitErpGoodsDataSync(previewV1.dataSyncBatch.id), /最新有效预览/u);

const fullCommit = adapter.commitErpGoodsDataSync(previewV2.dataSyncBatch.id);
assert.equal(fullCommit.dataSyncBatch.status, "succeeded");
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total, 10);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total, 10);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, productsBefore);

let incrementalRequest = null;
const incremental = await adapter.previewErpGoodsDataSync({
  taskId: task.id, syncMode: "incremental", requestEnd: "2026-08-05 00:00:00", createdBy: "person-admin",
  queryGoods: async ({ params }) => { incrementalRequest = params; return payload(1, "V2", "增量更新货品"); },
});
assert.ok(new Date(incrementalRequest.start_time).getTime() < new Date(center.getDataSyncTask(task.id).lastSuccessAt).getTime(), "增量同步应从上次成功时间安全回看");
adapter.commitErpGoodsDataSync(incremental.dataSyncBatch.id);
assert.equal(db.prepare("SELECT goodsName FROM erp_goods WHERE goodsCode='G-V2-1'").get().goodsName, "增量更新货品");

db.prepare("UPDATE data_sync_tasks SET nextRunAt='2000-01-01T00:00:00.000Z' WHERE id=?").run(task.id);
assert.equal(center.listDueDataSyncTasks("2026-08-05T00:00:00.000Z").some((item) => item.id === task.id), true);
const scheduled = await adapter.runDueErpGoodsSyncTasks({ queryGoods: async () => payload(1, "V2", "自动增量货品") });
assert.equal(scheduled[0].success, true);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_batches WHERE triggerMode='automatic'").get().total, 1);
assert.ok(new Date(center.getDataSyncTask(task.id).nextRunAt).getTime() > Date.now());

assert.ok(db.prepare("SELECT COUNT(*) total FROM data_sync_logs").get().total >= 9);
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(db.pragma("foreign_key_check"), []);
dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });

console.log(JSON.stringify({ previews: 2, stalePreviewBlocked: true, fullSync: { goods: 10, skus: 10 }, incrementalSync: true, legacyRunsCreated: 0, productsCreated: 0, schedulerExecuted: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
