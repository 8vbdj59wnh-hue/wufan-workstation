import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("清仓计划独立保存并只读组合销售库存事实", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "product-clearance-plan-"));
  process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { getProductClearancePlanCenter, saveProductClearancePlan, updateProductClearancePlan } = await import("../server/productClearancePlanService.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const timestamp = "2026-08-27T08:00:00.000Z";
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("product-clearance-test", "CLEARANCE-001", "清仓计划测试产品", "成熟期", timestamp, timestamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("erp-goods-clearance-test", "CLEARANCE", "清仓计划测试产品", "{}", "batch-clearance", "active", timestamp, timestamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-clearance-test", "CLEARANCE-001", "erp-goods-clearance-test", "{}", "batch-clearance", "batch-clearance", "active", timestamp, timestamp);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("mapping-clearance-test", "product-clearance-test", "erp-goods-clearance-test", "erp-sku-clearance-test", "CLEARANCE-001", "exact_sku", "active", timestamp, timestamp);
    const productBefore = database.prepare("SELECT * FROM products WHERE id=?").get("product-clearance-test");
    const salesFactCountBefore = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;
    const inventoryFactCountBefore = database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count;

    const created = saveProductClearancePlan("product-clearance-test", {
      startDate: "2026-08-27", targetDays: 30, targetInventoryQuantity: 0, note: "30天完成清仓",
    }, "");
    assert.equal(created.status, "active");
    assert.equal(created.targetEndDate, "2026-09-25");

    const updated = saveProductClearancePlan("product-clearance-test", { startDate: "2026-08-27", targetDays: 45, targetInventoryQuantity: 0 }, "");
    assert.equal(updated.id, created.id, "重复加入应更新当前计划而不是创建第二条进行中计划");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM product_clearance_plans WHERE productId=? AND status='active'").get("product-clearance-test").count, 1);

    const center = getProductClearancePlanCenter({ range: "30d", status: "active" }, { visibleProductIds: ["product-clearance-test"] });
    assert.equal(center.summary.activePlanCount, 1);
    assert.equal(center.items[0].productName, "清仓计划测试产品");
    assert.equal(center.items[0].inventoryProgress, null, "无库存事实时不得模拟清仓进度");
    assert.equal(center.definitions.automaticProductStatusChange, false);

    updateProductClearancePlan(created.id, { status: "completed" });
    assert.equal(database.prepare("SELECT status FROM product_clearance_plans WHERE id=?").get(created.id).status, "completed");
    assert.deepEqual(database.prepare("SELECT * FROM products WHERE id=?").get("product-clearance-test"), productBefore, "计划操作不得修改产品事实");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, salesFactCountBefore);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count, inventoryFactCountBefore);
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("产品经营列表与卡片均提供清仓入口，清仓中心提供每日总览和进度条", () => {
  const source = fs.readFileSync(new URL("../src/productCenterPage.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import\s+["']\.\/productClearancePlan\.css["']/);
  assert.match(source, /data-product-clearance-plan-styles/);
  assert.match(source, /data-view="clearance-plans"[^>]*>清仓计划<\/button>/);
  assert.ok((source.match(/data-action="open-product-clearance-plan"/g) || []).length >= 3);
  assert.match(source, /每日清仓总览/);
  assert.match(source, /库存清仓进度/);
  assert.match(source, /计划时间进度/);
});
