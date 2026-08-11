import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "connection-core-sku-sales-v2-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const database = dbModule.getDatabase();
const { getConnectionCoreDetail } = await import("../server/connectionCorePageService.js");
const timestamp = "2026-08-11T00:00:00.000Z";

database.prepare("INSERT INTO persons (id,name,account,departmentId,positionId,role,status,createdAt,updatedAt) VALUES ('phase1c-reviewer','Phase1C审核人','phase1c-reviewer','verification-department','verification-position','admin','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES ('phase1c-shop','jd','Phase1C店铺','phase1c店铺','Phase1C店铺','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt) VALUES ('phase1c-link','phase1c-shop','PHASE1C-GOODS','Phase1C链接','strong','verification','complete','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO connection_profiles (id,salesLinkId,name,status,originSource,createdAt,updatedAt) VALUES ('phase1c-connection','phase1c-link','Phase1C链接','active','verification',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES ('phase1c-goods','PHASE1C-ERP-GOODS','Phase1C ERP货品','{}','active',?,?)").run(timestamp, timestamp);
for (const [erpSkuId, code] of [["phase1c-erp-1", "PHASE1C-ERP-1"], ["phase1c-erp-2", "PHASE1C-ERP-2"]]) {
  database.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?,'phase1c-goods',?,'{}','verification','verification','active',?,?)")
    .run(erpSkuId, code, code, timestamp, timestamp);
}
for (const [productId, code, erpSkuId, erpCode] of [
  ["phase1c-product-1", "PHASE1C-P1", "phase1c-erp-1", "PHASE1C-ERP-1"],
  ["phase1c-product-2", "PHASE1C-P2", "phase1c-erp-2", "PHASE1C-ERP-2"],
]) {
  database.prepare("INSERT INTO products (id,skuCode,name,status,createdAt,updatedAt) VALUES (?,?,?,'active',?,?)").run(productId, code, productId, timestamp, timestamp);
  database.prepare("INSERT INTO product_erp_mappings (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'verification','active',?,?)")
    .run(`phase1c-product-map-${productId}`, productId, "phase1c-goods", erpSkuId, erpCode, timestamp, timestamp);
}
database.prepare("INSERT INTO connection_import_batches (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,createdAt,updatedAt) VALUES ('phase1c-batch','verification','','phase1c.xlsx','phase1c-hash','2026-08-10','completed',?,?)").run(timestamp, timestamp);

function addLinkSku(index, legacyProductId = null, legacyErpSkuId = null) {
  const id = `phase1c-link-sku-${index}`;
  database.prepare("INSERT INTO sales_link_skus (id,salesLinkId,productId,erpSkuId,platformSkuId,platformSkuCode,specificationName,currentState,matchStatus,createdAt,updatedAt) VALUES (?,'phase1c-link',?,?,?,?,?,'active','matched_manual',?,?)")
    .run(id, legacyProductId, legacyErpSkuId, `PHASE1C-SKU-${index}`, `PHASE1C-SKU-${index}`, `Phase1C规格${index}`, timestamp, timestamp);
  return id;
}

function addFact(index, salesLinkSkuId, periodStart, periodEnd, quantity, salesAmount, profitAmount) {
  database.prepare("INSERT INTO connection_sku_sales_facts (id,batchId,salesLinkId,salesLinkSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,createdAt) VALUES (?,'phase1c-batch','phase1c-link',?,'PHASE1C-GOODS',?,?,?,?,?,?,?,?)")
    .run(`phase1c-fact-${index}`, salesLinkSkuId, `PHASE1C-SKU-${index}`, periodStart, periodEnd, quantity, salesAmount, salesAmount - profitAmount, profitAmount, timestamp);
}

const singleSku = addLinkSku(1);
database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('phase1c-relation-1',?,'phase1c-erp-1','single',1,'active','verification',?,?)").run(singleSku, timestamp, timestamp);
addFact(1, singleSku, "2026-08-04", "2026-08-10", 2, 100, 30);

const multiQuantitySku = addLinkSku(2, "phase1c-product-2", "phase1c-erp-2");
database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('phase1c-relation-2',?,'phase1c-erp-1','single',2,'active','verification',?,?)").run(multiQuantitySku, timestamp, timestamp);
addFact(2, multiQuantitySku, "2026-08-04", "2026-08-10", 3, 200, 50);

const comboSku = addLinkSku(3);
database.prepare("INSERT INTO sales_link_sku_combo_groups (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,createdAt,updatedAt) VALUES ('phase1c-combo',?,'PHASE1C-COMBO','pending','verification','[]',?,?)").run(comboSku, timestamp, timestamp);
for (const [erpSkuId, quantity, sortOrder] of [["phase1c-erp-1", 1, 1], ["phase1c-erp-2", 3, 2]]) {
  database.prepare("INSERT INTO sales_link_sku_combo_group_components (id,comboGroupId,erpSkuId,quantity,quantitySource,sourceType,sortOrder,status,createdAt,updatedAt) VALUES (?,'phase1c-combo',?,?,'manual_confirmation','verification',?,'included',?,?)")
    .run(`phase1c-component-${erpSkuId}`, erpSkuId, quantity, sortOrder, timestamp, timestamp);
}
database.prepare("UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy='phase1c-reviewer',reviewedAt=?,approvedAt=?,updatedAt=? WHERE id='phase1c-combo'").run(timestamp, timestamp, timestamp);
for (const [erpSkuId, quantity] of [["phase1c-erp-1", 1], ["phase1c-erp-2", 3]]) {
  database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt) VALUES (?,?,?,'combo',?,'active','verification','phase1c-combo',?,?)")
    .run(`phase1c-combo-relation-${erpSkuId}`, comboSku, erpSkuId, quantity, timestamp, timestamp);
}
addFact(3, comboSku, "2026-08-04", "2026-08-10", 4, 400, 80);

const historicalSku = addLinkSku(4);
database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('phase1c-relation-4',?,'phase1c-erp-1','single',1,'active','verification',?,?)").run(historicalSku, timestamp, timestamp);
addFact(4, historicalSku, "2026-07-28", "2026-08-03", 99, 999, 500);

const detail = getConnectionCoreDetail("phase1c-connection", "", true);
assert.equal(detail.skuSales.length, 3, "SKU销售分析必须继续只展示最新周期SKU");
assert.equal(detail.skuSales.reduce((sum, row) => sum + row.salesAmount, 0), 700, "销售金额不得按关系数量拆分或重算");
assert.equal(detail.skuSales.reduce((sum, row) => sum + row.shippedQuantity, 0), 9, "销量不得按关系数量拆分或重算");
const bySku = new Map(detail.skuSales.map((row) => [row.salesLinkSkuId, row]));
assert.equal(bySku.get(singleSku).salesAmount, 100);
assert.equal(bySku.get(singleSku).products[0].id, "phase1c-product-1");
assert.equal(bySku.get(multiQuantitySku).salesAmount, 200);
assert.equal(bySku.get(multiQuantitySku).erpRelations[0].quantity, 2);
assert.equal(bySku.get(multiQuantitySku).products[0].id, "phase1c-product-1", "产品解释不得读取故意错误的旧productId");
assert.equal(bySku.get(comboSku).salesAmount, 400);
assert.equal(bySku.get(comboSku).erpRelations.length, 2);
assert.deepEqual(bySku.get(comboSku).products.map((row) => row.id), ["phase1c-product-1", "phase1c-product-2"]);
assert.equal(detail.products.length, 2);
assert.equal(detail.profile.productCount, 2);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  latestPeriodOnly: true,
  skuCount: detail.skuSales.length,
  salesAmount: detail.skuSales.reduce((sum, row) => sum + row.salesAmount, 0),
  shippedQuantity: detail.skuSales.reduce((sum, row) => sum + row.shippedQuantity, 0),
  productCount: detail.products.length,
  erpRelationDisplayCount: detail.skuSales.reduce((sum, row) => sum + row.erpRelations.length, 0),
  comboSalesAmountNotSplit: bySku.get(comboSku).salesAmount,
  supportedShapes: ["single×1", "single×quantity", "multi-ERP×quantity"],
  integrityCheck: "ok",
}, null, 2));

dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
