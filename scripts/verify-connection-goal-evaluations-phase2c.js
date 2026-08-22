import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-goal-phase2c-"));
process.env.WUFAN_DB_PATH = path.join(temporaryDirectory, "verification.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { setConnectionBusinessPositioning } = await import("../server/connectionGoalFoundationService.js");
const { confirmConnectionGoalPlan, createConnectionGoalSuggestion } = await import("../server/connectionGoalPlanService.js");
const { calculateConnectionGoalGrade, evaluateConnectionGoal } = await import("../server/connectionGoalEvaluationService.js");

function dateAtOffset(start, offset) {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  initializeDatabase();
  const timestamp = "2026-08-18T08:00:00.000Z";
  const owner = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();

  assert.equal(calculateConnectionGoalGrade(1.2, 1.2, 1.2), "excellent");
  assert.equal(calculateConnectionGoalGrade(1, 1, 1), "good");
  assert.equal(calculateConnectionGoalGrade(0.8, 0.8, 0.8), "on_target");
  assert.equal(calculateConnectionGoalGrade(0.79, 0.79, 0.79), "underperforming");
  assert.equal(calculateConnectionGoalGrade(0.59, 1.5, 1.3), "underperforming");

  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('phase2c-shop','taobao','Phase 2C店铺','phase 2c店铺','Phase 2C店铺','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2c-link','phase2c-shop','phase2c-goods','Phase 2C验证链接','strong','manual','complete','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`UPDATE sales_links SET displayName='Phase 2C验证链接',ownerId=?,managementStatus='active',managementLevel='new',managementOriginSource='manual' WHERE id='phase2c-link'`).run(owner.id);
  setConnectionBusinessPositioning("phase2c-link", {
    positioningType: "sales_growth",
    decisionReason: "Phase 2C验证定位",
  }, { database, userId: owner.id });

  database.prepare(`INSERT INTO erp_goods
    (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt)
    VALUES ('phase2c-goods-erp','PHASE2C-GOODS','Phase 2C ERP货品','{}','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO erp_skus
    (id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('phase2c-erp-sku','PHASE2C-SKU','phase2c-goods-erp','{}','phase2c-import','phase2c-import','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2c-link-sku','phase2c-link','phase2c-platform-sku','PHASE2C-SKU','phase2c-sku','默认','默认','matched','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType)
    VALUES ('phase2c-import','sales_daily','phase2c.xlsx','phase2c-hash','2026-08-17','committed',30,30,0,0,?,?,?,'sales_daily')`).run(owner.id, timestamp, timestamp);
  const insertFact = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
    (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,1,100,90,10,'normal','phase2c-import',?,'{}',?,?)`);
  for (let index = 0; index < 30; index += 1) {
    if (index === 13) continue;
    insertFact.run(`phase2c-fact-${index}`, "phase2c-link", "phase2c-link-sku", "phase2c-erp-sku", dateAtOffset("2026-07-19", index), index + 1, timestamp, timestamp);
  }

  const draft = createConnectionGoalSuggestion("phase2c-link", { database, userId: owner.id });
  assert.equal(draft.awaitingConfirmation.status, "draft");
  const manual = confirmConnectionGoalPlan("phase2c-link", draft.awaitingConfirmation.id, {
    targetMonth: "2026-08",
    salesAmount: 1000,
    profitMargin: 100,
  }, { database, userId: owner.id });
  const insufficient = evaluateConnectionGoal("phase2c-link", { database, today: "2026-08-18" });
  assert.equal(insufficient.evaluationStatus, "pending");
  assert.equal(insufficient.reasonCode, "insufficient_data");
  assert.equal(insufficient.coverageDays, 16);

  insertFact.run("phase2c-fact-13", "phase2c-link", "phase2c-link-sku", "phase2c-erp-sku", "2026-08-01", 14, timestamp, timestamp);
  const factCountBeforeEvaluation = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;
  const protectedResult = evaluateConnectionGoal("phase2c-link", { database, today: "2026-08-18" });
  assert.equal(protectedResult.salesActual, 1700);
  assert.equal(protectedResult.profitActual, 170);
  assert.equal(protectedResult.salesAchievement, 1.7);
  assert.equal(protectedResult.profitAchievement, 0.17);
  assert.equal(protectedResult.totalAchievement, 1.101);
  assert.equal(protectedResult.grade, "underperforming");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factCountBeforeEvaluation);
  const recalculated = evaluateConnectionGoal("phase2c-link", { database, today: "2026-08-18" });
  assert.equal(recalculated.id, protectedResult.id);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_evaluations WHERE goalPlanId=?").get(manual.current.id).count, 1);

  const suggestion = createConnectionGoalSuggestion("phase2c-link", { database, userId: owner.id });
  const secondPlan = confirmConnectionGoalPlan("phase2c-link", suggestion.awaitingConfirmation.id, {
    targetMonth: "2026-08",
    salesAmount: 1000,
    profitMargin: 10,
  }, { database, userId: owner.id });
  const excellent = evaluateConnectionGoal("phase2c-link", { database, today: "2026-08-18" });
  assert.equal(excellent.salesAchievement, 1.7);
  assert.equal(excellent.profitAchievement, 1.7);
  assert.equal(excellent.totalAchievement, 1.5);
  assert.equal(excellent.grade, "excellent");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_plans WHERE status='active'").get().count, 1);
  assert.equal(secondPlan.history.filter((plan) => plan.status === "expired").length, 1);

  const delayed = evaluateConnectionGoal("phase2c-link", { database, today: "2026-08-20" });
  assert.equal(delayed.evaluationStatus, "pending");
  assert.equal(delayed.reasonCode, "data_delayed");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factCountBeforeEvaluation);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    insufficientDataStatus: insufficient.reasonCode,
    cappedCompositeAchievement: protectedResult.totalAchievement,
    minimumMetricProtectionGrade: protectedResult.grade,
    excellentGrade: excellent.grade,
    delayedStatus: delayed.reasonCode,
    evaluationRowsRecalculatedInPlace: true,
    salesFactsUnchangedByEvaluation: true,
    integrity: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
