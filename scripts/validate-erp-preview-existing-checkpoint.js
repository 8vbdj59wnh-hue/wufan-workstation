import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceCheckpointPath = process.argv[2];
if (!sourceCheckpointPath || !fs.existsSync(sourceCheckpointPath)) throw new Error("请提供现有ERP全量断点副本路径。");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-erp-existing-checkpoint-"));
process.env.WUFAN_DB_PATH = path.join(root, "workstation.db");
const dbModule = await import("../server/db.js");
const syncModule = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/erpGoodsDataSyncAdapter.js");

dbModule.initializeDatabase({ reset: true });
const db = dbModule.getDatabase();
syncModule.setDataSyncTaskStatus("sync-task-erp-goods", "enabled");
const before = {
  goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total,
  skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
  products: db.prepare("SELECT COUNT(*) total FROM products").get().total,
};

const batch = syncModule.createDataSyncBatch("sync-task-erp-goods", {
  syncMode: "full",
  requestStart: "2021-01-01T00:00",
  requestEnd: "2026-08-05T00:59",
});
syncModule.startDataSyncBatch(batch.id);
syncModule.interruptDataSyncBatch(batch.id, new Error("加载已有断点副本"));

const checkpoint = JSON.parse(fs.readFileSync(sourceCheckpointPath, "utf8"));
for (const goods of checkpoint.rows ?? []) {
  for (const specification of goods.spec_list ?? []) {
    specification.img_url = "";
    specification.img_more_url = [];
  }
}
const lastGoodsWithSpecification = [...(checkpoint.rows ?? [])].reverse().find((goods) => goods.spec_list?.length);
const retainedSpecification = lastGoodsWithSpecification?.spec_list?.[0];
if (!retainedSpecification) throw new Error("断点中没有可验证的SKU记录。");
retainedSpecification.img_url = "http://127.0.0.1/missing.jpg";
const checkpointDirectory = path.join(dbModule.uploadsDir, "data-sync-checkpoints");
fs.mkdirSync(checkpointDirectory, { recursive: true });
const targetCheckpointPath = path.join(checkpointDirectory, `${batch.id}.json`);
fs.writeFileSync(targetCheckpointPath, JSON.stringify(checkpoint));

let apiCalls = 0;
try {
  const result = await adapter.previewErpGoodsDataSync({
    taskId: "sync-task-erp-goods",
    resumeBatchId: batch.id,
    queryGoods: async () => {
      apiCalls += 1;
      throw new Error("已有完整断点不得重新调用旺店通");
    },
  });
  const warningCount = db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType='image_download_warning'").get(batch.id).total;
  const isolatedCount = db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType IN ('erp_sku_row_isolated','erp_sku_identity_missing') AND severity='error'").get(batch.id).total;
  const after = {
    goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total,
    skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
    products: db.prepare("SELECT COUNT(*) total FROM products").get().total,
  };
  assert.equal(apiCalls, 0);
  assert.equal(result.dataSyncBatch.status, "preview_ready");
  assert.equal(warningCount, 1);
  assert.ok(Number(result.summary.error || 0) > 0, "真实断点内的编码冲突必须被识别");
  assert.equal(isolatedCount, result.summary.skipped);
  assert.deepEqual(after, before);
  const mappingsBefore = db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total;
  const committed = adapter.commitErpGoodsDataSync(batch.id);
  assert.equal(committed.dataSyncBatch.status, "partial");
  assert.equal(committed.summary.importedSkus, result.summary.importable);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total, result.summary.importable);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, before.products);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total, mappingsBefore);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  console.log(JSON.stringify({
    success: true,
    sourceRows: checkpoint.rows.length,
    windows: checkpoint.windowCount,
    pages: checkpoint.pageCount,
    apiCalls,
    previewStatus: result.dataSyncBatch.status,
    sourceBatchStatus: result.importBatch.status,
    totalSkuRows: result.summary.total,
    validGoods: result.summary.validGoods,
    validationErrors: result.summary.error,
    importableSkus: result.summary.importable,
    skippedSkus: result.summary.skipped,
    skippedRows: result.summary.skippedRows,
    rowExceptions: isolatedCount,
    imageWarnings: warningCount,
    businessCountsUnchanged: true,
    committedStatus: committed.dataSyncBatch.status,
    importedSkus: committed.summary.importedSkus,
    productsChanged: 0,
    productMappingsChanged: 0,
    integrityCheck: "ok",
    foreignKeyCheck: 0,
  }));
} finally {
  fs.rmSync(targetCheckpointPath, { force: true });
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
