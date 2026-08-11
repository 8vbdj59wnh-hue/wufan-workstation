import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "connection-cockpit-v2-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const database = dbModule.getDatabase();
const { getConnectionBusinessCockpit } = await import("../server/connectionBusinessCockpitService.js");
const timestamp = "2026-08-11T00:00:00.000Z";

database.prepare("INSERT INTO persons (id,name,account,departmentId,positionId,role,status,createdAt,updatedAt) VALUES ('cockpit-reviewer','驾驶舱审核人','cockpit-reviewer','verification-department','verification-position','admin','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES ('cockpit-shop','jd','驾驶舱店铺','驾驶舱店铺','驾驶舱店铺','active',?,?)").run(timestamp, timestamp);
database.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES ('cockpit-goods','COCKPIT-GOODS','驾驶舱ERP货品','{}','active',?,?)").run(timestamp, timestamp);
for (const [erpSkuId, merchantSkuCode] of [["cockpit-erp-1", "COCKPIT-ERP-1"], ["cockpit-erp-2", "COCKPIT-ERP-2"]]) {
  database.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?, 'cockpit-goods',?,'{}','verification','verification','active',?,?)")
    .run(erpSkuId, merchantSkuCode, merchantSkuCode, timestamp, timestamp);
}
for (const [productId, skuCode, productName, erpSkuId, merchantSkuCode] of [
  ["cockpit-product-1", "COCKPIT-P1", "驾驶舱产品1", "cockpit-erp-1", "COCKPIT-ERP-1"],
  ["cockpit-product-2", "COCKPIT-P2", "驾驶舱产品2", "cockpit-erp-2", "COCKPIT-ERP-2"],
]) {
  database.prepare("INSERT INTO products (id,skuCode,name,status,createdAt,updatedAt) VALUES (?,?,?,'active',?,?)").run(productId, skuCode, productName, timestamp, timestamp);
  database.prepare("INSERT INTO product_erp_mappings (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'verification','active',?,?)")
    .run(`mapping-${productId}`, productId, "cockpit-goods", erpSkuId, merchantSkuCode, timestamp, timestamp);
}
database.prepare("INSERT INTO connection_import_batches (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,createdAt,updatedAt) VALUES ('cockpit-batch','verification','','verification.xlsx','cockpit-hash','2026-08-10','completed',?,?)").run(timestamp, timestamp);

function addLink({ index, productId, mappings, salesAmount, profitAmount }) {
  const linkId = `cockpit-link-${index}`;
  const connectionId = `cockpit-connection-${index}`;
  const linkSkuId = `cockpit-link-sku-${index}`;
  database.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt) VALUES (?,'cockpit-shop',?,?,'strong','verification','complete','active',?,?)")
    .run(linkId, `COCKPIT-GOODS-${index}`, `驾驶舱链接${index}`, timestamp, timestamp);
  database.prepare("INSERT INTO connection_profiles (id,salesLinkId,name,status,originSource,createdAt,updatedAt) VALUES (?,?,?,'active','verification',?,?)")
    .run(connectionId, linkId, `驾驶舱链接${index}`, timestamp, timestamp);
  database.prepare("INSERT INTO sales_link_skus (id,salesLinkId,productId,platformSkuId,platformSkuCode,currentState,matchStatus,createdAt,updatedAt) VALUES (?,?,?,?,?,'active','matched_manual',?,?)")
    .run(linkSkuId, linkId, productId, `PLATFORM-SKU-${index}`, `PLATFORM-SKU-${index}`, timestamp, timestamp);
  for (const mapping of mappings) {
    database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt) VALUES (?,?,?,?,?,'active','verification',?,?,?)")
      .run(`relation-${index}-${mapping.erpSkuId}`, linkSkuId, mapping.erpSkuId, mapping.mappingType, mapping.quantity, mapping.comboGroupId ?? null, timestamp, timestamp);
  }
  database.prepare("INSERT INTO connection_sku_sales_facts (id,batchId,salesLinkId,salesLinkSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,createdAt) VALUES (?,'cockpit-batch',?,?,?,?, '2026-08-04','2026-08-10',1,?,?,?,?)")
    .run(`fact-${index}`, linkId, linkSkuId, `COCKPIT-GOODS-${index}`, `PLATFORM-SKU-${index}`, salesAmount, salesAmount - profitAmount, profitAmount, timestamp);
  return { linkId, connectionId, linkSkuId };
}

const single = addLink({ index: 1, productId: "cockpit-product-1", mappings: [{ erpSkuId: "cockpit-erp-1", mappingType: "single", quantity: 1 }], salesAmount: 100, profitAmount: 30 });
const multiQuantity = addLink({ index: 2, productId: "cockpit-product-2", mappings: [{ erpSkuId: "cockpit-erp-2", mappingType: "single", quantity: 2 }], salesAmount: 200, profitAmount: 50 });
const combo = addLink({ index: 3, productId: "cockpit-product-1", mappings: [], salesAmount: 400, profitAmount: 80 });
const comboGroupId = "cockpit-combo-group";
database.prepare("INSERT INTO sales_link_sku_combo_groups (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,createdAt,updatedAt) VALUES (?,?,'COCKPIT-COMBO','pending','verification','[]',?,?)")
  .run(comboGroupId, combo.linkSkuId, timestamp, timestamp);
for (const [erpSkuId, quantity, sortOrder] of [["cockpit-erp-1", 1, 1], ["cockpit-erp-2", 3, 2]]) {
  database.prepare("INSERT INTO sales_link_sku_combo_group_components (id,comboGroupId,erpSkuId,quantity,quantitySource,sourceType,sortOrder,status,createdAt,updatedAt) VALUES (?,?,?,?, 'manual_confirmation','verification',?,'included',?,?)")
    .run(`component-${erpSkuId}`, comboGroupId, erpSkuId, quantity, sortOrder, timestamp, timestamp);
}
database.prepare("UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy='cockpit-reviewer',reviewedAt=?,approvedAt=?,updatedAt=? WHERE id=?")
  .run(timestamp, timestamp, timestamp, comboGroupId);
for (const [erpSkuId, quantity] of [["cockpit-erp-1", 1], ["cockpit-erp-2", 3]]) {
  database.prepare("INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt) VALUES (?,?,?,'combo',?,'active','verification',?,?,?)")
    .run(`relation-3-${erpSkuId}`, combo.linkSkuId, erpSkuId, quantity, comboGroupId, timestamp, timestamp);
}

const cockpit = getConnectionBusinessCockpit("", true);
const byProduct = new Map(cockpit.productChannels.map((row) => [row.productId, row]));
assert.equal(cockpit.summary.salesAmount, 700, "链接级销售总额不得变化");
assert.equal(cockpit.summary.profitAmount, 160, "链接级利润总额不得变化");
assert.equal(byProduct.get("cockpit-product-1").salesAmount, 200, "single×1金额应保持100，组合按1/4分配100");
assert.equal(byProduct.get("cockpit-product-1").profitAmount, 50);
assert.equal(byProduct.get("cockpit-product-2").salesAmount, 500, "single×2金额应保持200，组合按3/4分配300");
assert.equal(byProduct.get("cockpit-product-2").profitAmount, 110);
assert.equal([...byProduct.values()].reduce((sum, row) => sum + row.salesAmount, 0), cockpit.summary.salesAmount);
assert.equal([...byProduct.values()].reduce((sum, row) => sum + row.profitAmount, 0), cockpit.summary.profitAmount);
const coreByLink = new Map(cockpit.coreLinks.map((row) => [row.salesLinkId, row]));
assert.deepEqual(coreByLink.get(single.linkId).products.map((row) => row.id), ["cockpit-product-1"]);
assert.deepEqual(coreByLink.get(multiQuantity.linkId).products.map((row) => row.id), ["cockpit-product-2"]);
assert.deepEqual(coreByLink.get(combo.linkId).products.map((row) => row.id), ["cockpit-product-1", "cockpit-product-2"]);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  linkTotals: { salesAmount: cockpit.summary.salesAmount, profitAmount: cockpit.summary.profitAmount, linkCount: cockpit.summary.connectionCount },
  products: Object.fromEntries([...byProduct].map(([productId, row]) => [productId, { salesAmount: row.salesAmount, profitAmount: row.profitAmount, linkCount: row.linkCount }])),
  supportedShapes: ["single×1", "single×quantity", "multi-ERP combo"],
  integrityCheck: "ok",
}, null, 2));

dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
