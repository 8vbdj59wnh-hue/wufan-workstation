import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "product-management-v2-relations-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const database = dbModule.getDatabase();
const { getProductBusinessAnalysis } = await import("../server/productManagementV2Service.js");
const timestamp = "2026-08-11T00:00:00.000Z";

database.prepare("INSERT INTO persons (id,name,account,departmentId,positionId,role,status,createdAt,updatedAt) VALUES ('phase1b-reviewer','Phase1B审核人','phase1b-reviewer','verification-department','verification-position','admin','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES ('phase1b-shop','jd','Phase1B店铺','phase1b店铺','Phase1B店铺','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES ('phase1b-goods','PHASE1B-GOODS','Phase1B ERP货品','{}','active',?,?)").run(timestamp, timestamp);
for (const [erpSkuId, merchantSkuCode] of [["phase1b-erp-1", "PHASE1B-ERP-1"], ["phase1b-erp-2", "PHASE1B-ERP-2"]]) {
  database.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?,'phase1b-goods',?,'{}','verification','verification','active',?,?)")
    .run(erpSkuId, merchantSkuCode, merchantSkuCode, timestamp, timestamp);
}
for (const [productId, skuCode, erpSkuId, merchantSkuCode] of [
  ["phase1b-product-1", "PHASE1B-P1", "phase1b-erp-1", "PHASE1B-ERP-1"],
  ["phase1b-product-2", "PHASE1B-P2", "phase1b-erp-2", "PHASE1B-ERP-2"],
]) {
  database.prepare("INSERT INTO products (id,skuCode,name,status,createdAt,updatedAt) VALUES (?,?,?,'active',?,?)").run(productId, skuCode, productId, timestamp, timestamp);
  database.prepare("INSERT INTO product_erp_mappings (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'verification','active',?,?)")
    .run(`phase1b-map-${productId}`, productId, "phase1b-goods", erpSkuId, merchantSkuCode, timestamp, timestamp);
}
database.prepare("INSERT INTO connection_import_batches (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,createdAt,updatedAt) VALUES ('phase1b-batch','verification','','phase1b.xlsx','phase1b-hash','2026-08-10','completed',?,?)").run(timestamp, timestamp);

function addLink(index, legacyProductId, payAmount, visitorCount, conversionRate) {
  const linkId = `phase1b-link-${index}`;
  const linkSkuId = `phase1b-link-sku-${index}`;
  const mappingId = `phase1b-data-map-${index}`;
  database.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt) VALUES (?,'phase1b-shop',?,?,'strong','verification','complete','active',?,?)")
    .run(linkId, `PHASE1B-GOODS-${index}`, `Phase1B链接${index}`, timestamp, timestamp);
  database.prepare("INSERT INTO sales_link_skus (id,salesLinkId,productId,platformSkuId,platformSkuCode,currentState,matchStatus,createdAt,updatedAt) VALUES (?,?,?,?,?,'active','matched_manual',?,?)")
    .run(linkSkuId, linkId, legacyProductId, `PHASE1B-SKU-${index}`, `PHASE1B-SKU-${index}`, timestamp, timestamp);
  database.prepare("INSERT INTO connection_data_mappings (id,sourceType,salesLinkId,externalType,externalId,matchStatus,createdAt,updatedAt) VALUES (?,'verification',?,'sales_link',?,'matched',?,?)")
    .run(mappingId, linkId, `PHASE1B-EXTERNAL-${index}`, timestamp, timestamp);
  database.prepare("INSERT INTO connection_period_snapshots (id,salesLinkId,mappingId,importBatchId,sourceType,externalId,periodStart,periodEnd,visitorCount,conversionRate,payAmount,createdAt) VALUES (?,?,?,'phase1b-batch','verification',?,'2026-08-04','2026-08-10',?,?,?,?)")
    .run(`phase1b-period-${index}`, linkId, mappingId, `PHASE1B-EXTERNAL-${index}`, visitorCount, conversionRate, payAmount, timestamp);
  return { linkId, linkSkuId };
}

const single = addLink(1, null, 100, 10, 0.1);
database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('phase1b-relation-1',?,'phase1b-erp-1','single',1,'active','verification',?,?)")
  .run(single.linkSkuId, timestamp, timestamp);
const multiQuantity = addLink(2, "phase1b-product-2", 200, 20, 0.2);
database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES ('phase1b-relation-2',?,'phase1b-erp-1','single',2,'active','verification',?,?)")
  .run(multiQuantity.linkSkuId, timestamp, timestamp);
const combo = addLink(3, null, 400, 40, 0.3);
database.prepare("INSERT INTO sales_link_sku_combo_groups (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,createdAt,updatedAt) VALUES ('phase1b-combo',?,'PHASE1B-COMBO','pending','verification','[]',?,?)")
  .run(combo.linkSkuId, timestamp, timestamp);
for (const [erpSkuId, quantity, sortOrder] of [["phase1b-erp-1", 1, 1], ["phase1b-erp-2", 3, 2]]) {
  database.prepare("INSERT INTO sales_link_sku_combo_group_components (id,comboGroupId,erpSkuId,quantity,quantitySource,sourceType,sortOrder,status,createdAt,updatedAt) VALUES (?,'phase1b-combo',?,?,'manual_confirmation','verification',?,'included',?,?)")
    .run(`phase1b-component-${erpSkuId}`, erpSkuId, quantity, sortOrder, timestamp, timestamp);
}
database.prepare("UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy='phase1b-reviewer',reviewedAt=?,approvedAt=?,updatedAt=? WHERE id='phase1b-combo'")
  .run(timestamp, timestamp, timestamp);
for (const [erpSkuId, quantity] of [["phase1b-erp-1", 1], ["phase1b-erp-2", 3]]) {
  database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt) VALUES (?,?,?,'combo',?,'active','verification','phase1b-combo',?,?)")
    .run(`phase1b-combo-relation-${erpSkuId}`, combo.linkSkuId, erpSkuId, quantity, timestamp, timestamp);
}

const product1 = getProductBusinessAnalysis("phase1b-product-1").connections.current;
const product2 = getProductBusinessAnalysis("phase1b-product-2").connections.current;
assert.equal(product1.payAmount, 700, "产品1应通过V2关系命中single×1、single×2和组合链接");
assert.equal(product1.visitorCount, 70);
assert.ok(Math.abs(product1.conversionRate - 17 / 70) < 1e-12);
assert.equal(product2.payAmount, 400, "产品2应通过组合组件关系命中组合链接");
assert.equal(product2.visitorCount, 40);
assert.equal(product2.conversionRate, 0.3);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  product1: { payAmount: product1.payAmount, visitorCount: product1.visitorCount, conversionRate: product1.conversionRate, expectedLinkCount: 3 },
  product2: { payAmount: product2.payAmount, visitorCount: product2.visitorCount, conversionRate: product2.conversionRate, expectedLinkCount: 1 },
  legacyFieldsDeliberatelyIncomplete: true,
  supportedShapes: ["single×1", "single×quantity", "multi-ERP×quantity"],
  integrityCheck: "ok",
}, null, 2));

dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
