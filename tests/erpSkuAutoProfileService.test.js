import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "erp-sku-auto-profile-"));
process.env.WUFAN_ENV = "test";
process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const {
  autoCreateProductProfilesForImportBatch,
  getProductAutoProfileSettings,
  updateProductAutoProfileSettings,
} = await import("../server/erpSkuService.js");

initializeDatabase();

function insertSku({ batchId, code, goodsCode = code.replace(/-\d+$/u, "") }) {
  const database = getDatabase();
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO erp_goods
    (id,goodsCode,goodsName,brand,category,rawSourceData,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'{}',?,'active',?,?)`)
    .run(`goods-${code}`, goodsCode, `货品 ${code}`, "测试品牌", "测试分类", batchId, now, now);
  database.prepare(`INSERT INTO erp_skus
    (id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'{}',?,?,'active',?,?)`)
    .run(`sku-${code}`, code, `goods-${code}`, "默认规格", "active", batchId, batchId, now, now);
}

test("自动建档默认关闭且开启后仅处理指定新同步批次", () => {
  const database = getDatabase();
  database.prepare("UPDATE data_sync_tasks SET configJson=? WHERE taskCode='erp_goods'")
    .run(JSON.stringify({ retainedSetting: "keep" }));
  insertSku({ batchId: "batch-before-enabled", code: "AUTO100-1" });
  assert.equal(getProductAutoProfileSettings().enabled, false);
  assert.equal(autoCreateProductProfilesForImportBatch("batch-before-enabled").createdCount, 0);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM products WHERE skuCode='AUTO100-1'").get().total, 0);

  const settings = updateProductAutoProfileSettings({ enabled: true }, "admin-test");
  assert.equal(settings.enabled, true);
  assert.equal(settings.updatedBy, "admin-test");
  assert.equal(JSON.parse(database.prepare("SELECT configJson FROM data_sync_tasks WHERE taskCode='erp_goods'").get().configJson).retainedSetting, "keep");

  insertSku({ batchId: "batch-after-enabled", code: "AUTO101-1" });
  const result = autoCreateProductProfilesForImportBatch("batch-after-enabled");
  assert.deepEqual({ attemptedCount: result.attemptedCount, createdCount: result.createdCount, failedCount: result.failedCount }, { attemptedCount: 1, createdCount: 1, failedCount: 0 });
  const product = database.prepare("SELECT id,skuCode,sourceSystem,status FROM products WHERE skuCode='AUTO101-1'").get();
  const mapping = database.prepare("SELECT productId,erpSkuId,matchMethod,currentState FROM product_erp_mappings WHERE merchantSkuCode='AUTO101-1'").get();
  assert.equal(product.sourceSystem, "旺店通ERP自动建档");
  assert.equal(product.status, "开发中");
  assert.deepEqual(mapping, { productId: product.id, erpSkuId: "sku-AUTO101-1", matchMethod: "erp_sync_auto_profile", currentState: "active" });

  const repeated = autoCreateProductProfilesForImportBatch("batch-after-enabled");
  assert.equal(repeated.attemptedCount, 0);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM products WHERE skuCode='AUTO101-1'").get().total, 1);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM products WHERE skuCode='AUTO100-1'").get().total, 0);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});
