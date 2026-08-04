import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-inventory-center-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const db = dbModule.getDatabase();
const center = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/inventoryDataSyncAdapter.js");
const now = "2026-08-04T00:00:00.000Z";

db.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES ('goods-1','G-1','ERP货品','{}','active',?,?)").run(now, now);
const insertSku = db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?,?,'{}','baseline','baseline','active',?,?)");
insertSku.run("sku-1", "SKU-1", "goods-1", now, now);
insertSku.run("sku-2", "SKU-2", "goods-1", now, now);
db.prepare("INSERT INTO wangdian_inventory_sync_batches (id,importMode,businessDate,status,createdBy,startedAt,completedAt) VALUES ('legacy-inventory','full','2026-08-03','completed','legacy',?,?)").run(now, now);
db.prepare("INSERT INTO erp_sku_warehouse_inventory_facts (id,businessDate,erpSkuId,warehouseId,warehouseNo,warehouseName,stockNum,availableSendStock,costPrice,rawSourceData,syncBatchId,createdAt,updatedAt) VALUES ('legacy-fact','2026-08-03','sku-1','9','W-9','历史仓',7,7,19,'{}','legacy-inventory',?,?)").run(now, now);
db.prepare("INSERT INTO erp_sku_inventory_daily_summaries (id,businessDate,erpSkuId,warehouseCount,stockNum,availableSendStock,costPrice,inventoryCostAmount,syncBatchId,createdAt,updatedAt) VALUES ('legacy-summary','2026-08-03','sku-1',1,7,7,19,133,'legacy-inventory',?,?)").run(now, now);

const task = center.getDataSyncTask("sync-task-inventory");
assert.equal(task.taskCode, "wangdian_inventory");
assert.equal(task.status, "paused");
center.setDataSyncTaskStatus(task.id, "enabled");

const row = (specNo, warehouseId, stock, cost, overrides = {}) => ({ rec_id: `${specNo}-${warehouseId}`, spec_no: specNo, warehouse_id: warehouseId, warehouse_no: `W-${warehouseId}`, warehouse_name: `仓库${warehouseId}`, warehouse_type: 1, stock_num: stock, available_send_stock: stock, cost_price: cost, num_7days: 1, num_month: 4, num_90days: 12, modified: "2026-08-04 10:00:00", ...overrides });
const source = [
  row("SKU-1", "1", 10, 20), row("SKU-1", "2", 30, 30), row("SKU-2", "1", 5, 40),
  (() => { const item = row("SKU-1", "3", 2, null); delete item.cost_price; return item; })(),
  row("MISSING", "1", 1, 10), row("SKU-1", "", 1, 20), row("SKU-1", "4", "bad", 20),
];
let requestParams = null;
const query = (rows) => async ({ params }) => { requestParams = params; return { status: 0, data: { detail_list: rows, total_count: rows.length } }; };
const options = { taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-04 23:59:59", businessDate: "2026-08-04", scope: { specNos: ["SKU-1", "SKU-2"], warehouseIds: ["1", "2", "3", "4"] }, createdBy: "person-admin", queryApi: query(source) };

const previewV1 = await adapter.previewInventoryDataSync(options);
assert.equal(previewV1.summary.matched, 4);
assert.equal(previewV1.summary.exceptionCount, 4);
assert.equal(requestParams.spec_nos, "SKU-1,SKU-2");
assert.deepEqual(previewV1.dataSyncBatch.scope, options.scope);
const previewV2 = await adapter.previewInventoryDataSync(options);
assert.equal(adapter.readInventoryDataSyncPreview(previewV1.dataSyncBatch.id).isCurrent, false);
assert.throws(() => adapter.commitInventoryDataSync(previewV1.dataSyncBatch.id), /最新有效预览/u);
const committed = adapter.commitInventoryDataSync(previewV2.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "succeeded");
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_sku_warehouse_inventory_facts WHERE businessDate='2026-08-04'").get().total, 4);

const sku1 = db.prepare("SELECT * FROM erp_sku_inventory_daily_summaries WHERE businessDate='2026-08-04' AND erpSkuId='sku-1'").get();
assert.equal(sku1.warehouseCount, 3);
assert.equal(sku1.stockNum, 42);
assert.equal(sku1.availableSendStock, 42);
assert.equal(Math.round(sku1.costPrice * 100) / 100, 27.5);
assert.equal(sku1.inventoryCostAmount, 1100);

const changed = [row("SKU-1", "2", 40, 30, { modified: "2026-08-04 11:00:00" })];
const incremental = await adapter.previewInventoryDataSync({ taskId: task.id, syncMode: "incremental", requestEnd: "2026-08-05 00:00:00", businessDate: "2026-08-04", createdBy: "person-admin", queryApi: query(changed) });
adapter.commitInventoryDataSync(incremental.dataSyncBatch.id);
assert.equal(db.prepare("SELECT stockNum FROM erp_sku_inventory_daily_summaries WHERE businessDate='2026-08-04' AND erpSkuId='sku-1'").get().stockNum, 52);

const repeated = await adapter.previewInventoryDataSync({ taskId: task.id, syncMode: "incremental", requestEnd: "2026-08-05 01:00:00", businessDate: "2026-08-04", createdBy: "person-admin", queryApi: query(changed) });
const repeatedCommit = adapter.commitInventoryDataSync(repeated.dataSyncBatch.id);
assert.equal(repeatedCommit.inventorySync.unchangedCount, 1);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_sku_warehouse_inventory_facts WHERE businessDate='2026-08-04'").get().total, 4);
assert.equal(db.prepare("SELECT stockNum FROM erp_sku_inventory_daily_summaries WHERE id='legacy-summary'").get().stockNum, 7);

const types = db.prepare("SELECT DISTINCT exceptionType FROM data_sync_exceptions WHERE taskId=?").all(task.id).map((item) => item.exceptionType);
for (const expected of ["missing_erp_sku", "missing_warehouse", "invalid_field", "cost_permission"]) assert.ok(types.includes(expected));
assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_inventory_facts").get().total, 0);
assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total, 0);
db.prepare("UPDATE data_sync_tasks SET nextRunAt='2000-01-01T00:00:00.000Z' WHERE id=?").run(task.id);
const scheduled = await adapter.runDueInventorySyncTasks({ queryApi: query([row("SKU-2", "1", 6, 40)]) });
assert.equal(scheduled[0].success, true);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_batches WHERE taskId=? AND triggerMode='automatic'").get(task.id).total, 1);
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(db.pragma("foreign_key_check"), []);
for (const item of db.prepare("SELECT id FROM wangdian_inventory_sync_batches").all()) fs.rmSync(path.join(dbModule.uploadsDir, "wangdian-inventory-sync", `${item.id}.json`), { force: true });
dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });

console.log(JSON.stringify({ taskCode: task.taskCode, full: { facts: 4, summaries: 2 }, multiWarehouse: { sku1Stock: 42, weightedCost: 27.5 }, incrementalUpdated: true, idempotent: true, automaticScheduled: true, legacyLinkInventoryUnchanged: true, salesFactsUnchanged: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
