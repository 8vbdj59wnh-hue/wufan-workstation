import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-erp-row-isolation-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
const center = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/erpGoodsDataSyncAdapter.js");

dbModule.initializeDatabase({ reset: true });
const db = dbModule.getDatabase();
center.setDataSyncTaskStatus("sync-task-erp-goods", "enabled");

const spec = (specNo, { deleted = 0, image = "" } = {}) => ({
  spec_id: `id-${specNo}`,
  spec_no: specNo,
  spec_name: `规格 ${specNo}`,
  spec_modified: "2026-08-05 09:00:00",
  deleted,
  img_url: image,
});
const goods = (goodsId, goodsNo, specs, { name = `货品 ${goodsNo}`, deleted = 0 } = {}) => ({
  goods_id: goodsId,
  goods_no: goodsNo,
  goods_name: name,
  modified: "2026-08-05 09:00:00",
  deleted,
  spec_list: specs,
});

const source = [
  goods("1", "ROW-G-A", [spec("ROW-SKU-A")]),
  goods("2", "ROW-G-C1", [spec("ROW-SKU-CONFLICT")]),
  goods("3", "ROW-G-C2", [spec("ROW-SKU-CONFLICT")]),
  goods("4", "ROW-G-INACTIVE", [spec("ROW-SKU-INACTIVE", { deleted: 1 })]),
  goods("5", "ROW-G-WARN", [spec("ROW-SKU-WARN", { image: "http://127.0.0.1/not-used.jpg" })], { name: "" }),
  goods("6", "ROW-G-HISTORY", [spec("ROW-SKU-H1")]),
  goods("7", "ROW-G-HISTORY", [spec("ROW-SKU-H2")]),
];
const before = {
  goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total,
  skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
  products: db.prepare("SELECT COUNT(*) total FROM products").get().total,
  mappings: db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
};

const preview = await adapter.previewErpGoodsDataSync({
  taskId: "sync-task-erp-goods",
  syncMode: "full",
  requestStart: "2026-08-05 00:00:00",
  requestEnd: "2026-08-05 23:59:59",
  queryGoods: async ({ pageNo }) => ({ data: { total_count: source.length, goods_list: pageNo === 0 ? source : [] } }),
});

assert.equal(preview.dataSyncBatch.status, "preview_ready");
assert.equal(preview.importBatch.status, "validated");
assert.equal(preview.summary.importable, 4);
assert.equal(preview.summary.skipped, 2);
assert.equal(preview.summary.skippedRows, 3);
assert.ok(preview.summary.warningCount >= 4);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType='erp_sku_row_isolated'").get(preview.dataSyncBatch.id).total, 2);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND severity='warning'").get(preview.dataSyncBatch.id).total >= 4, true);
assert.deepEqual({
  goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total,
  skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
  products: db.prepare("SELECT COUNT(*) total FROM products").get().total,
  mappings: db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
}, before, "预览不得修改ERP、产品或映射数据");

const committed = adapter.commitErpGoodsDataSync(preview.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "partial");
assert.equal(committed.summary.importedSkus, 4);
assert.equal(committed.summary.skipped, 2);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus WHERE merchantSkuCode LIKE 'ROW-SKU-%'").get().total, 4);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus WHERE merchantSkuCode IN ('ROW-SKU-CONFLICT','ROW-SKU-INACTIVE')").get().total, 0);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, before.products);
assert.equal(db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total, before.mappings);
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(db.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  success: true,
  preview: { sourceRows: source.length, importable: 4, skippedSkuIdentities: 2, skippedRows: 3 },
  commit: { status: "partial", importedSkus: 4 },
  productsChanged: 0,
  productMappingsChanged: 0,
  integrityCheck: "ok",
  foreignKeyCheck: 0,
}, null, 2));

dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
