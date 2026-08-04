import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sales-fact-sync-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase();
const db = databaseModule.getDatabase();
const adapter = await import("../server/salesFactDataSyncAdapter.js");
const center = await import("../server/dataSyncCenterService.js");
const stamp = new Date().toISOString();

db.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES ('shop-test','tmall','点意旗舰店','点意旗舰店','点意旗舰店','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,currentState,createdAt,updatedAt) VALUES ('link-test','shop-test','G-100','测试链接','goods_id','platform_link_operations','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,currentState,createdAt,updatedAt) VALUES ('erp-goods-test','ERP-G-100','测试ERP货品','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES ('erp-sku-test','SKU-100','erp-goods-test','标准款','test','test','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES ('erp-sku-test-2','SKU-200','erp-goods-test','大号款','test','test','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_skus (id,salesLinkId,erpSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt) VALUES ('link-sku-test','link-test','erp-sku-test','SKU-100','sku-100','标准款','标准款','matched','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_skus (id,salesLinkId,erpSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt) VALUES ('link-sku-test-2','link-test','erp-sku-test-2','SKU-200','sku-200','大号款','大号款','matched','active',?,?)").run(stamp, stamp);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
  { platform: "tmall", shop: "点意旗舰店", platformGoodsId: "G-100", skuCode: "SKU-100", periodStart: "2026-08-01", periodEnd: "2026-08-01", shippedQuantity: 3, salesAmount: 300, costAmount: 180, profitAmount: 120 },
  { platform: "tmall", shop: "点意旗舰店", platformGoodsId: "G-100", skuCode: "SKU-200", periodStart: "2026-08-01", periodEnd: "2026-08-01", shippedQuantity: 2, salesAmount: 220, costAmount: 150, profitAmount: 70 },
]), "真实销售");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const task = center.getDataSyncTask("sync-task-real-sales");
assert.equal(task.taskCode, "sales_fact_excel_import");
assert.equal(task.executionMode, "manual");
assert.equal(task.status, "enabled");

const before = { facts: db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total, links: db.prepare("SELECT COUNT(*) total FROM sales_links").get().total, products: db.prepare("SELECT COUNT(*) total FROM products").get().total };
const preview = adapter.previewSalesFactDataSync({ taskId: task.id, buffer, fileName: "链接利润报表.xlsx" });
assert.equal(preview.dataSyncBatch.status, "preview_ready");
assert.equal(preview.summary.total, 2);
assert.equal(preview.summary.exceptionCount, 0);
assert.equal(preview.importBatch.periodStart, "2026-08-01");
const committed = adapter.commitSalesFactDataSync(preview.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "succeeded");
assert.equal(committed.result.factsCreated, 2);
const fact = db.prepare("SELECT * FROM connection_sku_sales_facts WHERE salesLinkSkuId='link-sku-test'").get();
assert.deepEqual([fact.shippedQuantity, fact.salesAmount, fact.costAmount, fact.profitAmount], [3, 300, 180, 120]);

const repeated = adapter.previewSalesFactDataSync({ taskId: task.id, buffer, fileName: "再次上传.xlsx" });
assert.equal(repeated.idempotent, true);
assert.equal(repeated.dataSyncBatch.id, preview.dataSyncBatch.id);
assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total, before.facts + 2);

const invalidWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(invalidWorkbook, XLSX.utils.json_to_sheet([{ platform: "tmall", shop: "点意旗舰店", platformGoodsId: "MISSING", skuCode: "NO-SKU", periodStart: "2026-08-02", periodEnd: "2026-08-02", salesAmount: 1 }]), "异常");
const invalid = adapter.previewSalesFactDataSync({ taskId: task.id, buffer: XLSX.write(invalidWorkbook, { type: "buffer", bookType: "xlsx" }), fileName: "异常.xlsx" });
assert.equal(invalid.blocked, true);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType='missing_link'").get(invalid.dataSyncBatch.id).total, 1);
assert.throws(() => adapter.commitSalesFactDataSync(invalid.dataSyncBatch.id), /不能确认写入/);

assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, before.products);
assert.deepEqual(db.prepare("SELECT SUM(salesAmount) amount,SUM(profitAmount) profit FROM connection_sku_sales_facts WHERE periodStart='2026-08-01'").get(), { amount: 520, profit: 190 });
databaseModule.closeDatabase();
databaseModule.initializeDatabase();
assert.equal(databaseModule.getDatabase().prepare("SELECT COUNT(*) total FROM data_sync_tasks WHERE taskCode='sales_fact_excel_import'").get().total, 1);
assert.equal(databaseModule.getDatabase().pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(databaseModule.getDatabase().pragma("foreign_key_check"), []);
databaseModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ upload: true, batchPreviewCommit: true, multiSkuSameLink: true, salesFact: { facts: 2, salesAmount: 520, profitAmount: 190 }, fileIdempotent: true, unifiedException: "missing_link", noAutoLinkOrProduct: true, analysisAggregate: true, migrationIdempotent: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
