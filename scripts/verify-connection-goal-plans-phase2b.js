import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-goal-phase2b-"));
process.env.WUFAN_DB_PATH = path.join(temporaryDirectory, "verification.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { setConnectionBusinessPositioning } = await import("../server/connectionGoalFoundationService.js");
const {
  confirmConnectionGoalPlan,
  createConnectionGoalSuggestion,
  readConnectionGoalPlans,
} = await import("../server/connectionGoalPlanService.js");

function dateAtOffset(start, offset) {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  initializeDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_plans").get().count, 0);
  const timestamp = "2026-08-18T08:00:00.000Z";
  const owner = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
  const viewer = database.prepare("SELECT id FROM persons WHERE status='active' AND id<>? ORDER BY id LIMIT 1").get(owner.id);
  assert.ok(owner?.id && viewer?.id);

  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('phase2b-shop','taobao','Phase 2B店铺','phase 2b店铺','Phase 2B店铺','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2b-link','phase2b-shop','phase2b-goods','Phase 2B验证链接','strong','manual','complete','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO connection_profiles
    (id,salesLinkId,name,ownerId,status,level,originSource,createdAt,updatedAt)
    VALUES ('phase2b-connection','phase2b-link','Phase 2B验证链接',?,'active','new','manual',?,?)`).run(owner.id, timestamp, timestamp);
  setConnectionBusinessPositioning("phase2b-connection", {
    positioningType: "sales_growth",
    decisionReason: "Phase 2B验证定位",
  }, { database, userId: owner.id });

  assert.throws(() => createConnectionGoalSuggestion("phase2b-connection", { database, userId: viewer.id }), /仅管理员或该链接负责人/);
  const insufficient = createConnectionGoalSuggestion("phase2b-connection", { database, userId: owner.id });
  assert.equal(insufficient.awaitingConfirmation.status, "draft");
  assert.equal(insufficient.awaitingConfirmation.targetMode, "manual");
  assert.equal(insufficient.awaitingConfirmation.metrics.every((item) => item.suggestedTargetValue === null), true);

  database.prepare(`INSERT INTO erp_goods
    (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt)
    VALUES ('phase2b-goods-erp','PHASE2B-GOODS','Phase 2B ERP货品','{}','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO erp_skus
    (id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('phase2b-erp-sku','PHASE2B-SKU','phase2b-goods-erp','{}','phase2b-import','phase2b-import','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2b-link-sku','phase2b-link','phase2b-platform-sku','PHASE2B-SKU','phase2b-sku','默认','默认','matched','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType)
    VALUES ('phase2b-import','sales_daily','phase2b.xlsx','phase2b-hash','2026-08-09','committed',90,90,0,0,?,?,?,'sales_daily')`).run(owner.id, timestamp, timestamp);
  const insertFact = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
    (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,1,?,?,?,'normal','phase2b-import',?,'{}',?,?)`);
  for (let index = 0; index < 90; index += 1) {
    const dailySales = index < 30 ? 50 : index < 60 ? 200 : 100;
    const dailyProfit = index < 30 ? 5 : index < 60 ? 20 : 10;
    insertFact.run(`phase2b-fact-${index}`, "phase2b-link", "phase2b-link-sku", "phase2b-erp-sku", dateAtOffset("2026-05-12", index), dailySales, dailySales - dailyProfit, dailyProfit, index + 1, timestamp, timestamp);
  }
  const factCountBefore = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;

  const suggested = createConnectionGoalSuggestion("phase2b-connection", { database, userId: owner.id });
  assert.equal(suggested.awaitingConfirmation.status, "pending_confirm");
  assert.equal(suggested.history.filter((plan) => plan.status === "cancelled").length, 1);
  assert.equal(suggested.suggestion.windows.filter((window) => window.complete).length, 3);
  const salesSuggestion = suggested.awaitingConfirmation.metrics.find((item) => item.metricCode === "sales_amount");
  const profitSuggestion = suggested.awaitingConfirmation.metrics.find((item) => item.metricCode === "profit_amount");
  assert.equal(salesSuggestion.suggestedTargetValue, 3000);
  assert.equal(profitSuggestion.suggestedTargetValue, 300);
  assert.equal(suggested.awaitingConfirmation.metrics.reduce((sum, item) => sum + item.weight, 0), 1);

  const first = confirmConnectionGoalPlan("phase2b-connection", suggested.awaitingConfirmation.id, {
    salesAmount: 3000,
    profitAmount: 300,
  }, { database, userId: owner.id });
  assert.equal(first.current.status, "active");
  assert.equal(first.current.targetMode, "system_suggested");
  assert.equal(first.current.approvalReason, "按系统建议确认");

  const nextSuggestion = createConnectionGoalSuggestion("phase2b-connection", { database, userId: owner.id });
  assert.throws(() => confirmConnectionGoalPlan("phase2b-connection", nextSuggestion.awaitingConfirmation.id, {
    salesAmount: 3600,
    profitAmount: 360,
  }, { database, userId: owner.id }), /必须填写原因/);
  const second = confirmConnectionGoalPlan("phase2b-connection", nextSuggestion.awaitingConfirmation.id, {
    salesAmount: 3600,
    profitAmount: 360,
    approvalReason: "负责人结合下月活动调整目标",
  }, { database, userId: owner.id });
  assert.equal(second.current.targetMode, "hybrid");
  assert.equal(second.history.filter((plan) => plan.status === "expired").length, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_plans WHERE connectionId=? AND status='active'").get("phase2b-connection").count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_plans WHERE connectionId=?").get("phase2b-connection").count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factCountBefore);
  assert.equal(readConnectionGoalPlans("phase2b-connection", { database, userId: viewer.id }).permissions.canEdit, false);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    completeWindows: 3,
    medianSuggestion: { salesAmount: 3000, profitAmount: 300 },
    activePlans: 1,
    retainedPlanVersions: 3,
    dailyFactsUnchangedByGoalOperations: true,
    integrity: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
