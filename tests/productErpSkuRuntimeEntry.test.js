import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-erp-runtime-entry-"));
process.env.WUFAN_ENV = "test";
process.env.WUFAN_ALLOW_DB_RESET = "1";
process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");

const { closeDatabase, getDatabase, initializeDatabase, replaceActionProducts, retireLinkCenterLegacyStructuresPhase3 } = await import("../server/db.js");
const { getProductAutoProfileSettings } = await import("../server/erpSkuService.js");
const { getProductCenterV2SkuDetail, listActionProductOptions, listProductCenterV2Skus, resolveActionProductOptions } = await import("../server/productCenterV2Service.js");
const { getProductDailySalesPerformance } = await import("../server/productDailySalesService.js");

initializeDatabase({ reset: true });

function count(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
}

test("Phase C 以 ERP SKU 作为产品中心与关键行动的运行身份", () => {
  const database = getDatabase();
  const now = "2026-08-28T08:00:00.000Z";
  const before = Object.fromEntries([
    "products", "product_erp_mappings", "connection_sku_sales_daily_facts", "erp_sku_inventory_daily_summaries",
    "sales_objects", "sales_object_structures", "sales_object_structure_components", "sales_links", "tasks",
  ].map((table) => [table, count(database, table)]));

  database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
    .run("goods-phase-c-direct", "DBCL", "无 Legacy 产品的真实 ERP 货品", "{}", "active", now, now);
  database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("erp-sku-phase-c-direct", "DBCL004", "goods-phase-c-direct", "默认规格", "active", "{}", "sync-phase-c", "sync-phase-c", "active", now, now);

  database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
    .run("goods-phase-c-legacy", "LEGACY", "Legacy 兼容货品", "{}", "active", now, now);
  database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("erp-sku-phase-c-legacy", "LEGACY001-1", "goods-phase-c-legacy", "默认规格", "active", "{}", "sync-phase-c", "sync-phase-c", "active", now, now);
  database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
    .run("product-phase-c-legacy", "LEGACY001-1", "Legacy 产品", "稳定销售", now, now);
  database.prepare(`INSERT INTO product_erp_mappings
    (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,latestStateJson,currentState,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run("mapping-phase-c-legacy", "product-phase-c-legacy", "goods-phase-c-legacy", "erp-sku-phase-c-legacy", "LEGACY001-1", "legacy_compatibility", "{}", "active", now, now);
  database.prepare(`INSERT INTO process_instances
    (id,templateId,templateVersion,name,goalId,initiatorId,status,customFields,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run("action-phase-c", "template-phase-c", 1, "Phase C 关联验证", "goal-phase-c", "person-phase-c", "draft", "{}", now, now);

  assert.equal(getProductAutoProfileSettings().enabled, false);
  assert.equal(listProductCenterV2Skus({ search: "DBCL004", includeHistorical: true }).rows[0].erpSkuId, "erp-sku-phase-c-direct");
  assert.equal(getProductCenterV2SkuDetail("erp-sku-phase-c-direct", { scope: "summary" }).extensionAvailability.status, "unmaintained");
  const directOption = listActionProductOptions({ search: "DBCL004" }).rows[0];
  assert.equal(directOption.erpSkuId, "erp-sku-phase-c-direct");
  assert.equal(directOption.status, "unmaintained");
  assert.equal(directOption.productId, null);
  assert.equal(resolveActionProductOptions([{ erpSkuId: "erp-sku-phase-c-direct" }])[0].erpSkuId, "erp-sku-phase-c-direct");
  const dailySales = getProductDailySalesPerformance({ erpSkuId: "erp-sku-phase-c-direct", startDate: "2026-08-01", endDate: "2026-08-28" });
  assert.equal(dailySales.erpSkuId, "erp-sku-phase-c-direct");
  assert.equal(dailySales.productId, null);

  replaceActionProducts("action-phase-c", ["product-phase-c-legacy", "erp-sku-phase-c-direct"]);
  assert.deepEqual(database.prepare("SELECT productId,erpSkuId FROM action_products WHERE actionId=? ORDER BY erpSkuId").all("action-phase-c"), [
    { productId: null, erpSkuId: "erp-sku-phase-c-direct" },
    { productId: "product-phase-c-legacy", erpSkuId: "erp-sku-phase-c-legacy" },
  ]);
  assert.equal(count(database, "products"), before.products + 1);
  assert.equal(count(database, "product_erp_mappings"), before.product_erp_mappings + 1);

  for (const table of ["connection_sku_sales_daily_facts", "erp_sku_inventory_daily_summaries", "sales_objects", "sales_object_structures", "sales_object_structure_components", "sales_links", "tasks"]) {
    assert.equal(count(database, table), before[table], `${table} 不应被运行入口验证修改`);
  }
});

test("Phase 3 将已退役的历史健康记录保留为只读归档", () => {
  const database = getDatabase();
  database.exec(`CREATE TABLE connection_health_records (
    id TEXT PRIMARY KEY,connectionId TEXT NOT NULL,snapshotId TEXT NOT NULL,healthScore REAL NOT NULL,
    healthStatus TEXT NOT NULL,problemsJson TEXT NOT NULL DEFAULT '[]',suggestionsJson TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL
  )`);
  database.prepare("INSERT INTO connection_health_records VALUES(?,?,?,?,?,?,?,?,?)")
    .run("historic-health", "historic-link", "historic-snapshot", 88, "healthy", "[]", "[]", "2026-08-22T13:17:16.130Z", "2026-08-22T13:17:16.130Z");
  retireLinkCenterLegacyStructuresPhase3();
  assert.equal(database.prepare("SELECT COUNT(*) total FROM legacy_connection_health_records").get().total, 1);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM sqlite_master WHERE type='table' AND name='connection_health_records'").get().total, 0);
  assert.throws(() => database.prepare("DELETE FROM legacy_connection_health_records").run(), /legacy archive is read only/);
  retireLinkCenterLegacyStructuresPhase3();
  assert.equal(database.pragma("foreign_key_check").length, 0);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});
