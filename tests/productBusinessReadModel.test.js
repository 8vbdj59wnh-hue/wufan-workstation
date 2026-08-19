import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("产品中心默认进入产品经营并保留SKU管理与产品档案入口", () => {
  const source = fs.readFileSync(new URL("../src/productCenterPage.js", import.meta.url), "utf8");
  const listRenderer = source.slice(source.indexOf("function renderProductList()"), source.indexOf("function renderProductSkuV2List()"));
  const skuRenderer = source.slice(source.indexOf("function renderProductSkuV2List()"), source.indexOf("function renderProductSkuV2Cards("));
  const detailRenderer = source.slice(source.indexOf("function renderProductDetail(product)"), source.indexOf("function renderInfoGroup("));

  assert.match(source, /let productSubmodule = "business-dashboard";/);
  assert.match(source, /data-view="business-dashboard"[^>]*>产品经营<\/button>/);
  assert.match(source, /data-view="sku-management"[^>]*>SKU管理<\/button>/);
  assert.match(listRenderer, /productSubmodule === "sku-management"\) return renderProductSkuV2List\(\);/);
  assert.match(listRenderer, /return renderProductBusinessDashboard\(\);/);
  assert.match(skuRenderer, /renderProductWorkspaceTabs\(\)/);
  assert.match(skuRenderer, /renderProductSubmoduleTabs\(\)/);
  assert.match(source, /查看关联产品档案 →/);
  assert.match(detailRenderer, /\["strategy", "产品战略"\]/);
  assert.match(detailRenderer, /\["business-diagnosis", "经营诊断"\]/);
  assert.match(detailRenderer, /\["user-insights", "用户洞察"\]/);
});

test("产品经营读取层复用销售、库存、SKU、健康与行动事实", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "product-business-read-model-"));
  process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");
  const { closeDatabase, getDatabase, initializeDatabase, replaceActionProducts } = await import("../server/db.js");
  const { getProductBusinessReadModel, mapProductBusinessLifecycle, salesMetrics } = await import("../server/productBusinessReadModel.js");
  const { readConnectionInventorySupply, readProductInventorySupply } = await import("../server/inventorySupplyQueryService.js");
  const { readConnectionProductsBySalesLinkIds } = await import("../server/connectionService.js");
  const { getConnectionCoreDetail, listConnectionCoreProfilesPage } = await import("../server/connectionCorePageService.js");
  const { buildErpSnapshotRows, collectErpSnapshotFacts } = await import("../server/erpFactSnapshots.js");
  const { createProductHealthAction, getProductImprovementCenter, productIssueTypeCatalog, recordProductImprovementResult } = await import("../server/productManagementV2Service.js");
  const { addProductStrategyStep, createProductStrategyAction, getProductStrategy, saveProductStrategySection, updateProductStrategyStep } = await import("../server/productStrategyService.js");
  const { attachProductDiagnosisSummaries, getProductBusinessDiagnosis } = await import("../server/productBusinessDiagnosisService.js");
  const { getProductInsightCenter, importProductInsights, updateProductInsight } = await import("../server/productInsightService.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const now = "2026-08-08T10:00:00.000Z";
    database.prepare("INSERT INTO products(id,skuCode,name,brand,category,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("product-board-1", "SKU-BOARD-1", "经营看板测试产品", "测试品牌", "测试分类", "成熟期", now, now);
    database.prepare("INSERT INTO products(id,skuCode,name,brand,category,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("product-board-no-data", "SKU-NO-DATA", "无数据产品", "测试品牌", "测试分类", "开发中", now, now);
    database.prepare("INSERT INTO products(id,skuCode,name,brand,category,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("product-board-decline", "SKU-DECLINE", "连续下降产品", "测试品牌", "测试分类", "成熟期", now, now);
    database.prepare("INSERT INTO goals(id,name,level,type,ownerId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("goal-health-action", "健康改善目标", "company", "business", "person-board-1", "active", now, now);
    database.prepare("INSERT INTO process_templates(id,name,ownerId,status,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("process-template-health", "产品改善流程", "person-board-1", "active", 1, now, now);
    database.prepare("INSERT INTO task_templates(id,name,defaultProcessTemplateId,departmentId,ownerId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("task-template-health", "产品改善行动标准", "process-template-health", "department-board-1", "person-board-1", "active", now, now);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("erp-goods-board-1", "PRODUCT-CODE-1", "经营看板测试产品", "{}", "active", now, now);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("erp-batch-board-1", "goods_info", "test.xlsx", "hash-board-1", "completed", now);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-board-1", "ERP-SKU-BOARD-1", "erp-goods-board-1", "{}", "erp-batch-board-1", "erp-batch-board-1", "active", now, now);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-board-decline", "ERP-SKU-DECLINE", "erp-goods-board-1", "{}", "erp-batch-board-1", "erp-batch-board-1", "active", now, now);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("mapping-board-1", "product-board-1", "erp-goods-board-1", "erp-sku-board-1", "ERP-SKU-BOARD-1", "exact_sku", "active", now, now);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("mapping-board-decline", "product-board-decline", "erp-goods-board-1", "erp-sku-board-decline", "ERP-SKU-DECLINE", "exact_sku", "active", now, now);
    database.prepare("INSERT INTO wangdian_inventory_sync_batches(id,importMode,businessDate,requestJson,status,startedAt) VALUES(?,?,?,?,?,?)")
      .run("inventory-batch-board-1", "incremental", "2026-08-08", "{}", "completed", now);
    database.prepare("INSERT INTO erp_sku_inventory_daily_summaries(id,businessDate,erpSkuId,warehouseCount,stockNum,availableSendStock,costPrice,inventoryCostAmount,sales7d,salesMonth,sales90d,syncBatchId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("inventory-summary-board-1", "2026-08-08", "erp-sku-board-1", 1, 40, 30, 20, 800, 7, 30, 80, "inventory-batch-board-1", now, now);
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("shop-board-1", "测试平台", "测试店铺", "测试店铺", "测试店铺", "active", now, now);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-board-1", "shop-board-1", "goods-board-1", "测试链接", "strong", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,productId,erpSkuId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("link-sku-board-1", "link-board-1", "product-board-1", "erp-sku-board-1", "platform-sku-board-1", "matched", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,productId,erpSkuId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("link-sku-board-decline", "link-board-1", "product-board-decline", null, "platform-sku-board-decline", "matched", "active", now, now);
    const reviewerId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    for (const [suffix, linkSkuId, erpSkuId] of [
      ["board-1", "link-sku-board-1", "erp-sku-board-1"],
      ["board-decline", "link-sku-board-decline", "erp-sku-board-decline"],
    ]) {
      database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
        .run(`sales-object-${suffix}`, `SO-${suffix}`, `so-${suffix}`, "single", "test", "product_structure", linkSkuId, now, now, now, now);
      database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,'active','product_structure','{}',?,?)")
        .run(`sales-object-relation-${suffix}`, linkSkuId, `sales-object-${suffix}`, now, now, now);
      database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'draft','product_structure','{}',?,?)")
        .run(`sales-object-structure-${suffix}`, `sales-object-${suffix}`, 1, `structure-hash-${suffix}`, now, now, now);
      database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,1,'active','product_structure','{}',?,?)")
        .run(`sales-object-component-${suffix}`, `sales-object-structure-${suffix}`, `sales-object-${suffix}`, erpSkuId, 1, now, now);
      database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=?")
        .run(reviewerId, now, now, now, `sales-object-structure-${suffix}`);
    }
    database.prepare("INSERT INTO connection_import_batches(id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("sales-batch-board-1", "erp_sales", "", "sales.xlsx", "sales-hash-board-1", "2026-08-07", "2026-08-01", "2026-08-07", "completed", now, now);
    const fact = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
      (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,'normal','sales-batch-board-1',?,'{}',?,?)`);
    fact.run("sales-fact-board-current", "link-board-1", "link-sku-board-1", "erp-sku-board-1", "2026-08-07", 10, 1000, 700, 300, 1, now, now);
    fact.run("sales-fact-board-previous", "link-board-1", "link-sku-board-1", "erp-sku-board-1", "2026-07-31", 5, 500, 400, 100, 2, now, now);
    fact.run("sales-fact-decline-current", "link-board-1", "link-sku-board-decline", "erp-sku-board-decline", "2026-08-07", 1, 100, null, null, 3, now, now);
    fact.run("sales-fact-decline-previous", "link-board-1", "link-sku-board-decline", "erp-sku-board-decline", "2026-07-31", 2, 200, null, null, 4, now, now);
    fact.run("sales-fact-decline-earlier", "link-board-1", "link-sku-board-decline", "erp-sku-board-decline", "2026-07-24", 3, 300, null, null, 5, now, now);
    fact.run("sales-fact-decline-30d-previous", "link-board-1", "link-sku-board-decline", "erp-sku-board-decline", "2026-06-26", 7, 700, null, null, 6, now, now);
    fact.run("sales-fact-decline-30d-earlier", "link-board-1", "link-sku-board-decline", "erp-sku-board-decline", "2026-05-26", 8, 800, null, null, 7, now, now);
    const distributed = salesMetrics(database, "2026-08-01", "2026-08-07");
    assert.equal(distributed.get("product-board-1").salesAmount, 1000);
    assert.equal(distributed.get("product-board-1").grossProfit, 300);
    assert.equal(distributed.get("product-board-decline").salesAmount, 100);
    database.prepare("INSERT INTO product_health_records(id,productId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("health-board-1", "product-board-1", "snapshot-board-1", 82, "growth", "{}", "[]", "[]", now, now);
    database.prepare("INSERT INTO process_instances(id,templateId,templateVersion,name,goalId,initiatorId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("action-board-1", "template-board-1", 1, "测试关键行动", "goal-board-1", "person-board-1", "running", now, now);
    database.prepare("INSERT INTO action_products(id,actionId,productId,createdAt) VALUES(?,?,?,?)")
      .run("action-product-board-1", "action-board-1", "product-board-1", now);
    database.prepare("INSERT INTO tasks(id,name,goalId,source,processInstanceId,departmentId,ownerId,initiatorId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("task-board-1", "测试任务", "goal-board-1", "process", "action-board-1", "department-board-1", "person-board-1", "person-board-1", "doing", now, now);

    const result = getProductBusinessReadModel({ range: "custom", periodStart: "2026-08-01", periodEnd: "2026-08-07" }, { includeInventoryCost: true });
    const item = result.items.find((entry) => entry.id === "product-board-1");
    assert.ok(item);
    assert.equal(result.summary.totalProducts, database.prepare("SELECT COUNT(*) count FROM products").get().count);
    assert.equal(item.sales.amount, 1000);
    assert.equal(item.sales.quantity, 10);
    assert.equal(item.sales.trend.code, "up");
    assert.equal(item.lifecycle, "爆款");
    assert.equal(item.structure.skuCount, 1);
    assert.equal(item.structure.salesLinkCount, 1);
    assert.equal(item.inventory.quantity, 40);
    assert.equal(item.inventory.amount, 800);
    assert.equal(item.inventory.status.code, "healthy");
    assert.equal(item.profit.grossProfit, 300);
    assert.equal(item.profit.grossMargin, 0.3);
    assert.equal(item.health.score, 82);
    assert.equal(item.healthAnalysis.overall.code, "healthy");
    assert.equal(item.healthAnalysis.dimensions.sales.code, "growth");
    assert.equal(item.healthAnalysis.dimensions.inventory.code, "healthy");
    assert.equal(item.healthAnalysis.dimensions.profit.code, "excellent");
    assert.equal(item.healthAnalysis.dimensions.links.code, "normal");
    assert.equal(item.healthAnalysis.dimensions.lifecycle.code, "growth");
    assert.equal(item.healthAnalysis.readOnly, true);
    assert.equal(item.actions.actionCount, 1);
    assert.equal(item.actions.taskCount, 1);
    assert.equal(item.actions.pendingCount, 2);
    assert.equal(result.definitions.readOnly, true);
    const noDataItem = result.items.find((entry) => entry.id === "product-board-no-data");
    assert.equal(noDataItem.healthAnalysis.overall.code, "no_data");
    assert.equal(noDataItem.healthAnalysis.dimensions.sales.code, "no_data");
    assert.equal(noDataItem.healthAnalysis.dimensions.profit.code, "no_data");
    const declineItem = result.items.find((entry) => entry.id === "product-board-decline");
    assert.equal(declineItem.healthAnalysis.dimensions.sales.code, "down");
    assert.equal(declineItem.healthAnalysis.dimensions.sales.evidence.sustained, true);
    assert.equal(declineItem.healthAnalysis.overall.code, "attention");
    assert.ok(declineItem.healthAnalysis.recommendations.some((entry) => entry.code === "sales_decline"));
    const taskCountBeforeAction = database.prepare("SELECT COUNT(*) count FROM tasks").get().count;
    const factCountBeforeAction = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;
    const improvementHealth = { overall: { code: "attention", label: "关注" }, dimensions: { profit: { severity: "attention", evidence: { grossMargin: 0.08 } } },
      recommendations: [{ code: "profit_low", title: "优化产品成本结构", reason: "毛利率 8.0%，低于正常阈值。" }] };
    const created = createProductHealthAction("product-board-1", {
      recommendationCode: "profit_low", goalId: "goal-health-action", taskTemplateId: "task-template-health",
    }, "person-board-1", improvementHealth);
    assert.equal(created.instance.status, "draft");
    assert.equal(created.instance.goalId, "goal-health-action");
    assert.equal(created.instance.customFields.recommendationCode, "profit_low");
    assert.equal(created.instance.customFields.problemType, "gross_margin_insufficient");
    assert.equal(created.instance.customFields.improvementGoal, "提升产品盈利能力");
    assert.equal(created.actionProduct.productId, "product-board-1");
    assert.equal(created.issue.issueType, "gross_margin_insufficient");
    assert.equal(created.issue.status, "improving");
    assert.equal(created.improvement.issueId, created.issue.id);
    assert.equal(created.improvement.actionId, created.instance.id);
    assert.ok(productIssueTypeCatalog.some((entry) => entry.code === "detail_page_issue" && entry.category === "内容问题"));
    replaceActionProducts(created.instance.id, ["product-board-1", "product-board-no-data"]);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM action_products WHERE actionId=?").get(created.instance.id).count, 2);
    const center = getProductImprovementCenter("product-board-1", improvementHealth);
    assert.equal(center.currentIssues[0].issueType, "gross_margin_insufficient");
    assert.equal(center.improvements[0].actionId, created.instance.id);
    assert.equal(center.improvements[0].resultSummary, null);
    assert.throws(() => recordProductImprovementResult(created.improvement.id, { improvementMeasures: "优化成本", resultSummary: "毛利率提升", completedAt: "2026-08-09" }), /关键行动完成后/);
    database.prepare("UPDATE process_instances SET status='done',completedAt=?,updatedAt=? WHERE id=?").run("2026-08-09T10:00:00.000Z", now, created.instance.id);
    const recorded = recordProductImprovementResult(created.improvement.id, { improvementMeasures: "重新谈判供应成本", resultSummary: "毛利率 8.0% → 12.0%", completedAt: "2026-08-09" });
    assert.equal(recorded.status, "result_recorded");
    assert.equal(recorded.improvementMeasures, "重新谈判供应成本");
    assert.equal(recorded.resultSummary, "毛利率 8.0% → 12.0%");
    assert.equal(database.prepare("SELECT status FROM product_issues WHERE id=?").get(created.issue.id).status, "improving");
    assert.equal(database.prepare("SELECT status FROM process_instances WHERE id=?").get(created.instance.id).status, "done");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM tasks").get().count, taskCountBeforeAction);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factCountBeforeAction);
    const strategyFactCounts = {
      sales: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
      inventory: database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count,
      erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
    };
    const positioningVersion = saveProductStrategySection("product-board-1", "positioning", {
      targetUsers: "追求品质的家居用户", coreScenarios: "客厅软装", positioning: "中高端装饰花器", pricePositioning: "中高价位", productRole: "核心产品",
    }, "person-board-1");
    assert.equal(positioningVersion.version, 1);
    saveProductStrategySection("product-board-1", "competition", { mainCompetitors: "同价位花器", strengths: "原创设计", weaknesses: "内容不足", priceStrategy: "保持价格", differentiation: "强化场景", description: "差异化竞争" }, "person-board-1");
    saveProductStrategySection("product-board-1", "goals", { targetSalesAmount: "500000", targetSalesQuantity: "3000", targetGrossMargin: "35", targetInventoryStatus: "健康", targetLifecycleStatus: "风险期" }, "person-board-1");
    saveProductStrategySection("product-board-1", "management", { ownerId: "person-board-1", periodType: "季度", periodLabel: "2026 Q3", periodStart: "2026-07-01", periodEnd: "2026-09-30", currentStrategy: "扩大主销颜色库存，提升主链接转化", notes: "经营会议确认" }, "person-board-1");
    let strategyVersion = addProductStrategyStep("product-board-1", { content: "优化主图", priority: "高", ownerId: "person-board-1", plannedAt: "2026-08-20" }, "person-board-1");
    strategyVersion = addProductStrategyStep("product-board-1", { content: "增加蓝色SKU", priority: "中", ownerId: "person-board-1", plannedAt: "2026-09-01" }, "person-board-1");
    const strategyItem = strategyVersion.content.nextStrategies[0];
    strategyVersion = updateProductStrategyStep("product-board-1", strategyItem.id, { content: "优化主图与详情页", priority: "高", status: "推进中", ownerId: "person-board-1", plannedAt: "2026-08-22" }, "person-board-1");
    const strategyAction = createProductStrategyAction("product-board-1", strategyItem.id, { goalId: "goal-health-action", taskTemplateId: "task-template-health" }, "person-board-1");
    assert.equal(strategyAction.instance.status, "draft");
    assert.equal(strategyAction.instance.customFields.source, "product_strategy");
    assert.equal(strategyAction.instance.customFields.strategyContent, "优化主图与详情页");
    assert.equal(strategyAction.instance.customFields.strategyPeriod, "2026 Q3");
    assert.equal(strategyAction.instance.customFields.strategyOwnerId, "person-board-1");
    assert.equal(strategyAction.actionProduct.productId, "product-board-1");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM tasks").get().count, strategyFactCounts.tasks);
    replaceActionProducts(strategyAction.instance.id, ["product-board-1", "product-board-no-data"]);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM action_products WHERE actionId=?").get(strategyAction.instance.id).count, 2);
    const restoredStrategy = getProductStrategy("product-board-1");
    assert.throws(() => getProductStrategy("product-board-1", { visibleProductIds: [] }), (error) => error.statusCode === 403);
    assert.equal(restoredStrategy.current.content.positioning.productRole, "核心产品");
    assert.equal(restoredStrategy.current.content.competition.description, "差异化竞争");
    assert.equal(restoredStrategy.current.content.goals.targetGrossMargin, 35);
    assert.equal(restoredStrategy.current.content.management.currentStrategy, "扩大主销颜色库存，提升主链接转化");
    assert.equal(restoredStrategy.current.content.nextStrategies.length, 2);
    assert.equal(restoredStrategy.current.content.nextStrategies[0].action.actionId, strategyAction.instance.id);
    assert.ok(restoredStrategy.history.length >= 7);
    assert.equal(restoredStrategy.history.at(-1).content.positioning.positioning, "中高端装饰花器");
    assert.equal(database.prepare("SELECT status FROM products WHERE id='product-board-1'").get().status, "成熟期");
    assert.equal(database.prepare("PRAGMA table_info(products)").all().some((column) => column.name.toLowerCase().includes("strategy")), false);
    assert.deepEqual({
      sales: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
      inventory: database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count,
      erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
    }, strategyFactCounts);
    saveProductStrategySection("product-board-decline", "positioning", { productRole: "核心产品", positioning: "重点增长产品" }, "person-board-1");
    saveProductStrategySection("product-board-decline", "management", { ownerId: "person-board-1", periodType: "季度", periodLabel: "2026 Q3", currentStrategy: "扩大销量并增加内容投放" }, "person-board-1");
    const diagnosisReadCounts = {
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      actions: database.prepare("SELECT COUNT(*) count FROM process_instances").get().count,
      health: database.prepare("SELECT COUNT(*) count FROM product_health_records").get().count,
      strategies: database.prepare("SELECT COUNT(*) count FROM product_strategy_versions").get().count,
      improvements: database.prepare("SELECT COUNT(*) count FROM product_improvements").get().count,
      lifecycle: database.prepare("SELECT COUNT(*) count FROM product_lifecycle_events").get().count,
    };
    const diagnosisOptions = { periodQuery: { range: "custom", periodStart: "2026-08-01", periodEnd: "2026-08-07" } };
    const normalDiagnosis = getProductBusinessDiagnosis("product-board-1", diagnosisOptions);
    assert.equal(normalDiagnosis.status.code, "normal");
    assert.ok(normalDiagnosis.advantages.some((entry) => entry.code === "profit_healthy"));
    assert.ok(normalDiagnosis.advantages.some((entry) => entry.code === "inventory_healthy"));
    assert.equal(normalDiagnosis.readOnly, true);
    assert.equal(normalDiagnosis.createsActions, false);
    const noDataDiagnosis = getProductBusinessDiagnosis("product-board-no-data", diagnosisOptions);
    assert.equal(noDataDiagnosis.status.code, "no_data");
    assert.deepEqual(noDataDiagnosis.advantages, []);
    assert.deepEqual(noDataDiagnosis.risks, []);
    assert.deepEqual(noDataDiagnosis.focusDirections, []);
    const declineDiagnosis = getProductBusinessDiagnosis("product-board-decline", diagnosisOptions);
    assert.equal(declineDiagnosis.status.code, "attention");
    assert.ok(declineDiagnosis.risks.some((entry) => entry.code === "sales_decline"));
    assert.ok(declineDiagnosis.risks.some((entry) => entry.code === "strategy_sales_gap"));
    assert.ok(declineDiagnosis.focusDirections.some((entry) => entry.code === "review_strategy_gap"));
    assert.equal(declineDiagnosis.sourceSummary.strategyVersion, 2);
    assert.deepEqual(getProductBusinessDiagnosis("product-board-decline", diagnosisOptions), declineDiagnosis);
    const diagnosisDashboard = attachProductDiagnosisSummaries(getProductBusinessReadModel({ range: "custom", periodStart: "2026-08-01", periodEnd: "2026-08-07" }));
    assert.equal(diagnosisDashboard.items.find((entry) => entry.id === "product-board-1").diagnosis.provider.id, "rule");
    assert.deepEqual({
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      actions: database.prepare("SELECT COUNT(*) count FROM process_instances").get().count,
      health: database.prepare("SELECT COUNT(*) count FROM product_health_records").get().count,
      strategies: database.prepare("SELECT COUNT(*) count FROM product_strategy_versions").get().count,
      improvements: database.prepare("SELECT COUNT(*) count FROM product_improvements").get().count,
      lifecycle: database.prepare("SELECT COUNT(*) count FROM product_lifecycle_events").get().count,
    }, diagnosisReadCounts);
    const insightBoundaryBefore = {
      product: database.prepare("SELECT name,skuCode,status,updatedAt FROM products WHERE id=?").get("product-board-1"),
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      actions: database.prepare("SELECT COUNT(*) count FROM process_instances").get().count,
      strategies: database.prepare("SELECT COUNT(*) count FROM product_strategy_versions").get().count,
      sales: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
      inventory: database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count,
      erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
    };
    const importedInsights = importProductInsights("product-board-1", [
      { insightType: "attention", content: "设计感", importance: 5, description: "用户关注现代家居搭配效果", source: "淘宝评价分析" },
      { insightType: "satisfaction", content: "高级感强", frequencyText: "32%", source: "天猫评价分析", note: "可作为卖点表达参考" },
      { insightType: "dissatisfaction", content: "尺寸偏小", impactLevel: "高", handlingStatus: "待处理", relatedImprovementId: created.improvement.id, source: "客服记录" },
      { insightType: "opportunity", content: "增加大尺寸版本", opportunityType: "规格", priority: "高", status: "待评估",
        relatedStrategyVersionId: restoredStrategy.current.id, relatedActionId: strategyAction.instance.id, source: "用户反馈汇总" },
    ], "person-board-1");
    assert.equal(importedInsights.length, 4);
    const dissatisfiedInsight = importedInsights.find((entry) => entry.insightType === "dissatisfaction");
    const opportunityInsight = importedInsights.find((entry) => entry.insightType === "opportunity");
    assert.equal(dissatisfiedInsight.relatedImprovementId, created.improvement.id);
    assert.equal(opportunityInsight.strategyVersion, restoredStrategy.current.version);
    assert.equal(opportunityInsight.relatedActionId, strategyAction.instance.id);
    const updatedInsight = updateProductInsight("product-board-1", dissatisfiedInsight.id, { handlingStatus: "改善中" }, "person-board-1");
    assert.equal(updatedInsight.handlingStatus, "改善中");
    assert.throws(() => importProductInsights("product-board-no-data", { insightType: "dissatisfaction", content: "错误关联", source: "测试", relatedImprovementId: created.improvement.id }, "person-board-1"), /不属于当前产品/);
    const insightCenter = getProductInsightCenter("product-board-1");
    assert.equal(insightCenter.groups.attention.length, 1);
    assert.equal(insightCenter.groups.satisfaction[0].frequencyText, "32%");
    assert.equal(insightCenter.groups.dissatisfaction[0].handlingStatus, "改善中");
    assert.equal(insightCenter.groups.opportunity[0].actionName, strategyAction.instance.displayTitle);
    assert.equal(insightCenter.provider.aiReady, true);
    assert.deepEqual(getProductInsightCenter("product-board-1"), insightCenter);
    assert.throws(() => getProductInsightCenter("product-board-1", { visibleProductIds: [] }), (error) => error.statusCode === 403);
    assert.deepEqual({
      product: database.prepare("SELECT name,skuCode,status,updatedAt FROM products WHERE id=?").get("product-board-1"),
      tasks: database.prepare("SELECT COUNT(*) count FROM tasks").get().count,
      actions: database.prepare("SELECT COUNT(*) count FROM process_instances").get().count,
      strategies: database.prepare("SELECT COUNT(*) count FROM product_strategy_versions").get().count,
      sales: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
      inventory: database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count,
      erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
    }, insightBoundaryBefore);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM product_insights WHERE productId=?").get("product-board-1").count, 4);
    database.prepare("INSERT INTO products(id,skuCode,name,brand,category,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("product-inventory-component", "SKU-INVENTORY-COMPONENT", "库存组合组件", "测试品牌", "测试分类", "成熟期", now, now);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-inventory-component", "ERP-INVENTORY-COMPONENT", "erp-goods-board-1", "{}", "erp-batch-board-1", "erp-batch-board-1", "active", now, now);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("mapping-inventory-component", "product-inventory-component", "erp-goods-board-1", "erp-sku-inventory-component", "ERP-INVENTORY-COMPONENT", "exact_sku", "active", now, now);
    database.prepare("INSERT INTO erp_sku_inventory_daily_summaries(id,businessDate,erpSkuId,warehouseCount,stockNum,availableSendStock,costPrice,inventoryCostAmount,sales7d,salesMonth,sales90d,syncBatchId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("inventory-summary-component", "2026-08-08", "erp-sku-inventory-component", 1, 9, 8, 10, 90, 3, 6, 12, "inventory-batch-board-1", now, now);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-inventory-structure", "shop-board-1", "goods-inventory-structure", "结构库存测试链接", "strong", "active", now, now);
    for (const [salesLinkSkuId, platformSkuId] of [["link-sku-inventory-single", "platform-inventory-single"], ["link-sku-inventory-combo", "platform-inventory-combo"]]) {
      database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,'matched','active',?,?)")
        .run(salesLinkSkuId, "link-inventory-structure", platformSkuId, now, now);
    }
    const structureReviewerId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    const addStructure = (id, salesLinkSkuId, components) => {
      const salesObjectId = `${id}-sales-object`;
      const objectType = components.length === 1 && Number(components[0][1]) === 1 ? "single" : "bundle";
      database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
        .run(salesObjectId, `SO-${id}`, `so-${id}`, objectType, "verification", "product_structure", salesLinkSkuId, now, now, now, now);
      database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,'active','product_structure','{}',?,?)")
        .run(`${id}-sales-object-relation`, salesLinkSkuId, salesObjectId, now, now, now);
      database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'draft','product_structure','{}',?,?)")
        .run(`${id}-sales-object-structure`, salesObjectId, 1, `sales-object-hash-${id}`, now, now, now);
      components.forEach(([erpSkuId, quantity], index) => database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'active','product_structure','{}',?,?)")
        .run(`${id}-sales-object-component-${index}`, `${id}-sales-object-structure`, salesObjectId, erpSkuId, quantity, index + 1, now, now));
      database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=?")
        .run(structureReviewerId, now, now, now, `${id}-sales-object-structure`);
    };
    addStructure("structure-inventory-single", "link-sku-inventory-single", [["erp-sku-board-1", 2]]);
    addStructure("structure-inventory-combo", "link-sku-inventory-combo", [["erp-sku-board-1", 2], ["erp-sku-inventory-component", 3]]);
    database.prepare("INSERT INTO connection_profiles(id,salesLinkId,name,status,originSource,createdAt,updatedAt) VALUES(?,?,?,'active','verification',?,?)")
      .run("connection-inventory-structure", "link-inventory-structure", "结构库存测试链接", now, now);
    const connectionProducts = readConnectionProductsBySalesLinkIds(database, ["link-inventory-structure"]).get("link-inventory-structure");
    assert.deepEqual(connectionProducts.map((row) => row.id), ["product-board-1", "product-inventory-component"]);
    const connectionInventory = readConnectionInventorySupply("link-inventory-structure", { includeCost: true, database });
    assert.equal(connectionInventory.rows.length, 2);
    assert.equal(connectionInventory.linkSkuAvailability.find((row) => row.salesLinkSkuId === "link-sku-inventory-single").availableSendStock, 15);
    assert.equal(connectionInventory.linkSkuAvailability.find((row) => row.salesLinkSkuId === "link-sku-inventory-combo").stockNum, 3);
    assert.equal(connectionInventory.linkSkuAvailability.find((row) => row.salesLinkSkuId === "link-sku-inventory-combo").availableSendStock, 2);
    const connectionDetail = getConnectionCoreDetail("connection-inventory-structure", "", true);
    assert.deepEqual(connectionDetail.products.map((row) => row.id), ["product-board-1", "product-inventory-component"]);
    assert.equal(connectionDetail.inventory.length, 2);
    assert.equal(connectionDetail.linkSkuAvailability.find((row) => row.salesLinkSkuId === "link-sku-inventory-combo").availableSendStock, 2);
    const productFilteredConnections = listConnectionCoreProfilesPage({ productCode: "SKU-INVENTORY-COMPONENT", pageSize: 20 }, "", true);
    assert.equal(productFilteredConnections.items.some((row) => row.id === "connection-inventory-structure"), true);
    assert.equal(productFilteredConnections.items.find((row) => row.id === "connection-inventory-structure").productCount, 2);
    const componentProductInventory = readProductInventorySupply("product-inventory-component", { includeCost: true, database });
    assert.equal(componentProductInventory.summary.stockNum, 9);
    assert.equal(componentProductInventory.summary.inventoryCostAmount, 90);
    const snapshotFacts = collectErpSnapshotFacts(database);
    const snapshotRows = buildErpSnapshotRows(snapshotFacts, { id: "snapshot-read-verification", businessDate: "2026-08-08", createdAt: now }, { inventoryBatchId: null, platformGoodsBatchId: null });
    assert.equal(snapshotRows.productRows.length, snapshotFacts.products.length);
    assert.equal(snapshotRows.erpRows.length, snapshotFacts.mappings.length);
    assert.equal(snapshotRows.linkRows.length, snapshotFacts.links.length);
    assert.equal(snapshotRows.skuRows.length, snapshotFacts.skus.length);
    assert.equal(snapshotRows.skuRows.find((row) => row.salesLinkSkuId === "link-sku-inventory-single").productId, "product-board-1");
    assert.equal(snapshotRows.skuRows.find((row) => row.salesLinkSkuId === "link-sku-inventory-single").combinationFlag, 1);
    assert.equal(snapshotRows.skuRows.find((row) => row.salesLinkSkuId === "link-sku-inventory-combo").productId, null);
    assert.equal(snapshotRows.skuRows.find((row) => row.salesLinkSkuId === "link-sku-inventory-combo").combinationFlag, 1);
    assert.ok(snapshotRows.relationRows.some((row) => row.productId === "product-inventory-component" && row.shopId === "shop-board-1"));
    assert.deepEqual([
      mapProductBusinessLifecycle("开发中", null, "no_data"),
      mapProductBusinessLifecycle("成长期", null, "stable"),
      mapProductBusinessLifecycle("成熟期", "hit", "stable"),
      mapProductBusinessLifecycle("成熟期", "active", "stable"),
      mapProductBusinessLifecycle("风险期", null, "stable"),
      mapProductBusinessLifecycle("清仓", null, "stable"),
      mapProductBusinessLifecycle("已归档", null, "stable"),
    ], ["新品", "成长", "爆款", "稳定销售", "衰退", "清仓", "归档"]);
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'product_business%'").all(), []);
  } catch (error) {
    assert.fail(error?.stack || error?.message || String(error));
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
