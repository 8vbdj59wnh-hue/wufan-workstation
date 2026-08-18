import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sales-fact-v2-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase();
const db = databaseModule.getDatabase();
const adapter = await import("../server/salesFactDataSyncAdapter.js");
const center = await import("../server/dataSyncCenterService.js");
const stamp = new Date().toISOString();

db.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES ('shop-test','tmall','点意旗舰店','点意旗舰店','点意旗舰店','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_shop_aliases (id,shopId,rawName,createdAt) VALUES ('shop-alias-test','shop-test','点意旗舰店-天猫-公司',?)").run(stamp);
db.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,currentState,createdAt,updatedAt) VALUES ('link-test','shop-test','G-100','测试链接','goods_id','platform_link_operations','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,currentState,createdAt,updatedAt) VALUES ('erp-goods-test','ERP-G-100','测试ERP货品','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES ('erp-sku-test','SKU-100','erp-goods-test','标准款','test','test','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES ('erp-sku-test-2','SKU-200','erp-goods-test','大号款','test','test','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_skus (id,salesLinkId,erpSkuId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,systemGoodsType,matchStatus,currentState,createdAt,updatedAt) VALUES ('link-sku-test','link-test','erp-sku-test','PS-100','SKU-100','sku-100','标准款','标准款','单品','matched','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,systemGoodsType,matchStatus,currentState,createdAt,updatedAt) VALUES ('link-sku-combo','link-test','PS-COMBO','COMBO','combo','组合装','组合装','组合装','unmatched','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,systemGoodsType,matchStatus,currentState,createdAt,updatedAt) VALUES ('link-sku-missing','link-test','PS-MISSING','MISSING','missing','关系缺失','关系缺失','组合装','unmatched','active',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('map-test','link-sku-test','erp-sku-test','single',1,'active','test',?,?)").run(stamp, stamp);
const reviewer = db.prepare("SELECT id FROM persons ORDER BY createdAt,id LIMIT 1").get();
assert.ok(reviewer);
db.prepare("INSERT INTO sales_link_sku_product_structures (id,salesLinkSkuId,structureCode,structureHash,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES ('structure-combo','link-sku-combo','STRUCTURE-COMBO','structure-combo-hash','draft','test','{}',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_sku_product_structure_components (id,productStructureId,erpSkuId,quantity,sortOrder,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES ('structure-component-1','structure-combo','erp-sku-test',1,1,'test','{}',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_sku_product_structure_components (id,productStructureId,erpSkuId,quantity,sortOrder,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES ('structure-component-2','structure-combo','erp-sku-test-2',2,2,'test','{}',?,?)").run(stamp, stamp);
db.prepare("UPDATE sales_link_sku_product_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id='structure-combo'").run(reviewer.id, stamp, stamp, stamp);
db.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,productStructureId,createdAt,updatedAt) VALUES ('map-combo-1','link-sku-combo','erp-sku-test','combo',1,'active','test','structure-combo',?,?)").run(stamp, stamp);
db.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,productStructureId,createdAt,updatedAt) VALUES ('map-combo-2','link-sku-combo','erp-sku-test-2','combo',2,'active','test','structure-combo',?,?)").run(stamp, stamp);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
  { 店铺: "点意旗舰店-天猫-公司", 平台货品ID: "G-100", 平台规格ID: "PS-100", 商家编码: "SKU-100", 日期: "2026-08-01", 销量: 3, 销售额: 300, 成本: 180, 利润: 120 },
  { 店铺: "点意旗舰店-天猫-公司", 平台货品ID: "G-100", 平台规格ID: "PS-COMBO", 商家编码: "SKU-100", 日期: "2026-08-01", 销量: 1, 销售额: 25.1111, 成本: 15, 利润: 10.1111 },
  { 店铺: "点意旗舰店-天猫-公司", 平台货品ID: "G-100", 平台规格ID: "PS-COMBO", 商家编码: "SKU-200", 日期: "2026-08-01", 销量: 1, 销售额: 50.1234, 成本: 30.0123, 利润: 20.1111 },
  { 店铺: "点意旗舰店-天猫-公司", 平台货品ID: "G-100", 平台规格ID: "PS-MISSING", 商家编码: "SKU-200", 日期: "2026-08-01", 销量: 1, 销售额: 10.4321, 成本: 6.1234, 利润: 4.3087 },
  { 店铺: "合计:", 平台货品ID: "NA", 平台规格ID: "NA", 商家编码: "", 日期: "NA", 销量: 6, 销售额: 385.6666, 成本: 231.1357, 利润: 154.5309 },
]), "真实销售");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const task = center.getDataSyncTask("sync-task-real-sales");
const before = { facts: db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total, links: db.prepare("SELECT COUNT(*) total FROM sales_links").get().total, products: db.prepare("SELECT COUNT(*) total FROM products").get().total };
const preview = adapter.previewSalesFactDataSync({ taskId: task.id, buffer, fileName: "链接利润报表.xlsx" });
assert.equal(preview.dataSyncBatch.status, "preview_ready");
assert.equal(preview.summary.parserVersion, "sales-fact-v3-v2-relation-resolution");
assert.equal(preview.summary.total, 4);
assert.equal(preview.summary.valid, 3);
assert.equal(preview.summary.exceptionCount, 1);
assert.equal(preview.summary.ignoredSummaryRows, 1);
assert.equal(preview.summary.periodStart, "2026-08-01T00:00:00");
assert.equal(preview.summary.periodEnd, "2026-08-01T23:59:59");
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType='combo_goods'").get(preview.dataSyncBatch.id).total, 0);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND exceptionType='missing_erp_mapping'").get(preview.dataSyncBatch.id).total, 1);

const oldHash = crypto.createHash("sha256").update(buffer).digest("hex");
assert.notEqual(preview.dataSyncBatch.fileHash, oldHash);
assert.equal(JSON.parse(preview.dataSyncBatch.scopeJson).sourceFileHash, oldHash);
const repeated = adapter.previewSalesFactDataSync({ taskId: task.id, buffer, fileName: "再次上传.xlsx" });
assert.equal(repeated.idempotent, true);
assert.equal(repeated.dataSyncBatch.id, preview.dataSyncBatch.id);

const committed = adapter.commitSalesFactDataSync(preview.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "partial");
assert.equal(committed.result.factsCreated, 3);
const fact = db.prepare("SELECT * FROM connection_sku_sales_facts WHERE salesLinkSkuId='link-sku-test'").get();
assert.equal(fact.erpSkuId, "erp-sku-test");
assert.deepEqual([fact.shippedQuantity, fact.salesAmount, fact.costAmount, fact.profitAmount], [3, 300, 180, 120]);
const comboFacts = db.prepare("SELECT * FROM connection_sku_sales_facts WHERE salesLinkSkuId='link-sku-combo' ORDER BY erpSkuId").all();
assert.equal(comboFacts.length, 2);
assert.deepEqual(comboFacts.map((row) => [row.erpSkuId, row.salesAmount, row.costAmount, row.profitAmount]), [
  ["erp-sku-test", 25.1111, 15, 10.1111],
  ["erp-sku-test-2", 50.1234, 30.0123, 20.1111],
]);
assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, before.products);

const updatedWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(updatedWorkbook, XLSX.utils.json_to_sheet([
  { 店铺: "点意旗舰店-天猫-公司", 平台货品ID: "G-100", 平台规格ID: "PS-100", 商家编码: "SKU-100", 日期: "2026-08-01", 销量: 4, 销售额: 450, 成本: 240, 利润: 210 },
]), "真实销售");
const updatedBuffer = XLSX.write(updatedWorkbook, { type: "buffer", bookType: "xlsx" });
const updatedPreview = adapter.previewSalesFactDataSync({ taskId: task.id, buffer: updatedBuffer, fileName: "链接利润报表修正版.xlsx" });
assert.equal(updatedPreview.summary.valid, 1);
assert.equal(updatedPreview.summary.exceptionCount, 0);
const updatedCommit = adapter.commitSalesFactDataSync(updatedPreview.dataSyncBatch.id);
assert.equal(updatedCommit.result.factsCreated, 0);
assert.equal(updatedCommit.result.factsUpdated, 1);
assert.equal(updatedCommit.result.factsAffected, 1);
const updatedFact = db.prepare("SELECT * FROM connection_sku_sales_facts WHERE salesLinkSkuId='link-sku-test'").get();
assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts WHERE salesLinkSkuId='link-sku-test'").get().total, 1);
assert.deepEqual([updatedFact.shippedQuantity, updatedFact.salesAmount, updatedFact.costAmount, updatedFact.profitAmount], [4, 450, 240, 210]);

databaseModule.closeDatabase();
databaseModule.initializeDatabase();
assert.equal(databaseModule.getDatabase().pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(databaseModule.getDatabase().pragma("foreign_key_check"), []);
databaseModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ parserVersion: "sales-fact-v3-v2-relation-resolution", exactPlatformSkuId: true, exactErpMapping: true, totalRowFiltered: true, comboResolvedByV2Relation: true, fourDecimalAmountsPreserved: true, missingRelationIsolated: true, erpSkuIdWritten: true, samePeriodUpdate: true, fileVersionIsolation: true, noAutoLinkOrProduct: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
