import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("未建立 Legacy Product 的 ERP SKU 可直接维护全部经营扩展且不创建产品映射", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-business-extension-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase, replaceActionProducts } = await import("../server/db.js");
  const { getProductBusinessProfile, upsertProductBusinessProfile } = await import("../server/productBusinessProfileService.js");
  const { getProductStrategy, saveProductStrategySection } = await import("../server/productStrategyService.js");
  const { getProductInsightCenter, importProductInsights } = await import("../server/productInsightService.js");
  const { getProductMarketingAsset, saveProductMarketingAsset } = await import("../server/productMarketingAssetService.js");
  const { getProductClearancePlanCenter, saveProductClearancePlan } = await import("../server/productClearancePlanService.js");
  const { changeProductLifecycle, createProductHealthAction, getProductImprovementCenter } = await import("../server/productManagementV2Service.js");
  const { getProductCenterV2SkuDetail, listProductCenterV2Skus } = await import("../server/productCenterV2Service.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const timestamp = "2026-08-28T08:00:00.000Z";
    const userId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    const departmentId = database.prepare("SELECT id FROM departments ORDER BY id LIMIT 1").get().id;
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,brand,category,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-goods-phase-b", "DBCL", "独立经营样本", "测试品牌", "测试分类", "{}", "active", timestamp, timestamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-phase-b", "DBCL004", "erp-goods-phase-b", "独立规格", "{}", "phase-b-fixture", "phase-b-fixture", "active", timestamp, timestamp);
    const before = {
      products: database.prepare("SELECT COUNT(*) count FROM products").get().count,
      mappings: database.prepare("SELECT COUNT(*) count FROM product_erp_mappings").get().count,
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
    };

    assert.equal(getProductBusinessProfile("erp-sku-phase-b").profile, null);
    assert.equal(listProductCenterV2Skus({ search: "DBCL004" }).rows[0].erpSkuId, "erp-sku-phase-b");
    upsertProductBusinessProfile("erp-sku-phase-b", { businessStatus: "active", lifecycle: "成长期", ownerId: userId }, userId);
    saveProductMarketingAsset("erp-sku-phase-b", { positioning: "测试定位", targetAudience: "测试用户", usageScenarios: ["客厅"], sellingPoints: [{ text: "设计感" }], keywords: ["花器"] }, userId);
    saveProductStrategySection("erp-sku-phase-b", "positioning", { targetUsers: "家居用户", positioning: "场景花器", productRole: "核心产品" }, userId);
    importProductInsights("erp-sku-phase-b", { insightType: "attention", content: "设计感", importance: 5, source: "人工访谈" }, userId);
    saveProductClearancePlan("erp-sku-phase-b", { startDate: "2026-08-28", targetDays: 30, targetInventoryQuantity: 0 }, userId);
    changeProductLifecycle("erp-sku-phase-b", { status: "成熟期", reason: "人工确认" }, userId);

    database.prepare("INSERT INTO goals(id,name,level,type,ownerId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("goal-phase-b", "经营改善目标", "company", "business", userId, "active", timestamp, timestamp);
    database.prepare("INSERT INTO process_templates(id,name,ownerId,status,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("process-phase-b", "经营改善流程", userId, "active", 1, timestamp, timestamp);
    database.prepare("INSERT INTO task_templates(id,name,defaultProcessTemplateId,departmentId,ownerId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("task-template-phase-b", "经营改善行动", "process-phase-b", departmentId, userId, "active", timestamp, timestamp);
    const health = { overall: { code: "attention", label: "关注" }, dimensions: { profit: { severity: "attention", evidence: { grossMargin: 0.05 } } },
      recommendations: [{ code: "profit_low", title: "优化产品成本结构", reason: "毛利率偏低" }] };
    const action = createProductHealthAction("erp-sku-phase-b", { recommendationCode: "profit_low", goalId: "goal-phase-b", taskTemplateId: "task-template-phase-b" }, userId, health);
    replaceActionProducts(action.instance.id, ["erp-sku-phase-b"]);

    const profile = getProductBusinessProfile("erp-sku-phase-b");
    assert.equal(profile.profile.lifecycle, "成熟期");
    assert.deepEqual(profile.completeness.stages, ["basic", "strategy", "marketing", "insight"]);
    assert.equal(getProductStrategy("erp-sku-phase-b").current.content.positioning.productRole, "核心产品");
    assert.equal(getProductInsightCenter("erp-sku-phase-b").groups.attention.length, 1);
    assert.equal(getProductMarketingAsset("erp-sku-phase-b").asset.positioning, "测试定位");
    assert.equal(getProductClearancePlanCenter({ status: "active" }).items.some((item) => item.erpSkuId === "erp-sku-phase-b"), true);
    assert.equal(getProductImprovementCenter("erp-sku-phase-b", health).improvements[0].actionId, action.instance.id);
    assert.equal(getProductCenterV2SkuDetail("erp-sku-phase-b", { scope: "summary" }).extensionAvailability.status, "maintained");
    assert.deepEqual(database.prepare("SELECT productId,erpSkuId FROM action_products WHERE actionId=?").get(action.instance.id),
      { productId: null, erpSkuId: "erp-sku-phase-b" });
    for (const table of ["product_strategy_versions", "product_insights", "product_marketing_assets", "product_clearance_plans", "product_health_records", "product_issues", "product_improvements", "action_products", "product_lifecycle_events"]) {
      const row = database.prepare(`SELECT productId,erpSkuId FROM ${table} WHERE erpSkuId=? LIMIT 1`).get("erp-sku-phase-b");
      assert.equal(row?.erpSkuId, "erp-sku-phase-b", `${table} 应直接记录 ERP SKU`);
      assert.equal(row?.productId, null, `${table} 不应伪造 Legacy productId`);
    }
    assert.deepEqual({
      products: database.prepare("SELECT COUNT(*) count FROM products").get().count,
      mappings: database.prepare("SELECT COUNT(*) count FROM product_erp_mappings").get().count,
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
    }, before);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
