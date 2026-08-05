import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-erp-image-warning-"));
process.env.WUFAN_DB_PATH = path.join(root, "workstation.db");
const dbModule = await import("../server/db.js");
const syncModule = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/erpGoodsDataSyncAdapter.js");

dbModule.initializeDatabase({ reset: true });
const db = dbModule.getDatabase();
syncModule.setDataSyncTaskStatus("sync-task-erp-goods", "enabled");

const goods = (goodsNo, specNo, imageUrl = "") => ({
  goods_id: goodsNo,
  goods_no: goodsNo,
  goods_name: `货品 ${goodsNo}`,
  modified: "2026-08-01 00:00:00",
  deleted: 0,
  spec_list: [{
    spec_id: specNo,
    spec_no: specNo,
    spec_name: `规格 ${specNo}`,
    spec_modified: "2026-08-01 00:00:00",
    deleted: 0,
    img_url: imageUrl,
  }],
});

const businessCounts = () => ({
  goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total,
  skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
  products: db.prepare("SELECT COUNT(*) total FROM products").get().total,
});
const before = businessCounts();

const requestStart = "2026-08-01 00:00:00";
const requestEnd = "2026-08-02 00:00:00";
let imageApiCalls = 0;
const imagePreview = await adapter.previewErpGoodsDataSync({
  taskId: "sync-task-erp-goods",
  syncMode: "full",
  requestStart,
  requestEnd,
  queryGoods: async ({ pageNo }) => {
    imageApiCalls += 1;
    return { data: { total_count: 1, goods_list: pageNo === 0 ? [goods("G-IMAGE", "SKU-IMAGE", "http://127.0.0.1/missing.jpg")] : [] } };
  },
});
assert.equal(imageApiCalls, 1);
assert.equal(imagePreview.dataSyncBatch.status, "preview_ready");
assert.equal(imagePreview.importBatch.status, "validated");
const imageWarnings = db.prepare("SELECT * FROM data_sync_exceptions WHERE batchId=? AND exceptionType='image_download_warning'").all(imagePreview.dataSyncBatch.id);
assert.equal(imageWarnings.length, 1);
assert.equal(imageWarnings[0].severity, "warning");
assert.deepEqual(businessCounts(), before, "生成预览不得写入ERP或产品数据");

const conflict = await adapter.previewErpGoodsDataSync({
  taskId: "sync-task-erp-goods",
  syncMode: "full",
  requestStart,
  requestEnd,
  queryGoods: async ({ pageNo }) => ({
    data: {
      total_count: 3,
      goods_list: pageNo === 0 ? [goods("G-A", "SKU-CONFLICT"), goods("G-B", "SKU-CONFLICT"), goods("G-VALID", "SKU-VALID")] : [],
    },
  }),
});
assert.equal(conflict.dataSyncBatch.status, "preview_ready", "有主数据异常时仍应生成可查看的正式预览");
assert.equal(conflict.importBatch.status, "validated", "单个编码冲突不得阻断其他有效SKU提交");
assert.equal(conflict.summary.importable, 1);
assert.equal(conflict.summary.skipped, 1);
assert.ok(db.prepare("SELECT 1 FROM data_sync_exceptions WHERE batchId=? AND exceptionType='erp_sku_row_isolated' AND severity='error'").get(conflict.dataSyncBatch.id));
assert.deepEqual(businessCounts(), before);
const committed = adapter.commitErpGoodsDataSync(conflict.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "partial");
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus WHERE merchantSkuCode='SKU-VALID'").get().total, 1);
assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus WHERE merchantSkuCode='SKU-CONFLICT'").get().total, 0);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, before.products);

console.log(JSON.stringify({
  success: true,
  imageWarningCount: imageWarnings.length,
  imagePreviewStatus: imagePreview.dataSyncBatch.status,
  conflictPreviewStatus: conflict.dataSyncBatch.status,
  conflictSourceStatus: conflict.importBatch.status,
  validSkuCommitted: 1,
  conflictSkuSkipped: 1,
  productsUnchanged: true,
}));
db.close();
fs.rmSync(root, { recursive: true, force: true });
