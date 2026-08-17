import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-goal-phase2e-"));
process.env.WUFAN_DB_PATH = path.join(temporaryDirectory, "verification.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { readConnectionGoalCockpitSummary } = await import("../server/connectionGoalCockpitService.js");

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  initializeDatabase();
  const timestamp = "2026-08-18T08:00:00.000Z";
  const people = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 2").all();
  const owner = people[0]; const otherOwner = people[1];

  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('phase2e-shop','taobao','Phase 2E店铺','phase 2e店铺','Phase 2E店铺','active',?,?)`).run(timestamp, timestamp);
  const insertLink = database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES (?,'phase2e-shop',?,?, 'strong','manual','complete','active',?,?)`);
  const insertProfile = database.prepare(`INSERT INTO connection_profiles
    (id,salesLinkId,name,ownerId,status,level,originSource,createdAt,updatedAt)
    VALUES (?,?,?,?, 'active','new','manual',?,?)`);
  for (let index = 1; index <= 5; index += 1) {
    insertLink.run(`phase2e-link-${index}`, `phase2e-goods-${index}`, `Phase 2E链接${index}`, timestamp, timestamp);
    insertProfile.run(`phase2e-connection-${index}`, `phase2e-link-${index}`, `Phase 2E链接${index}`, index <= 3 ? owner.id : otherOwner.id, timestamp, timestamp);
  }

  const positions = ["sales_growth", "balanced_sales", "long_tail", "profit_contribution"];
  const insertPosition = database.prepare(`INSERT INTO connection_business_profiles
    (id,connectionId,positioningType,status,effectiveFrom,effectiveTo,decisionReason,decidedBy,createdAt,updatedAt)
    VALUES (?,?,?,'active',?,NULL,'Phase 2E验证定位',?,?,?)`);
  positions.forEach((positioningType, index) => insertPosition.run(`phase2e-position-${index + 1}`, `phase2e-connection-${index + 1}`, positioningType, timestamp, owner.id, timestamp, timestamp));

  const templateByPositioning = new Map(database.prepare("SELECT positioningType,id,version FROM connection_goal_templates WHERE status='active'").all()
    .map((item) => [item.positioningType, item]));
  const insertPlan = database.prepare(`INSERT INTO connection_goal_plans
    (id,connectionId,positioningId,templateId,templateVersion,targetMode,status,baselineStart,baselineEnd,effectiveFrom,effectiveTo,createdBy,approvedBy,approvalReason,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'system_suggested','active','2026-05-20','2026-08-17','2026-08-18','2026-09-16',?,?,'验证确认',?,?)`);
  for (let index = 1; index <= 3; index += 1) {
    const template = templateByPositioning.get(positions[index - 1]);
    insertPlan.run(`phase2e-plan-${index}`, `phase2e-connection-${index}`, `phase2e-position-${index}`, template.id, template.version, owner.id, owner.id, timestamp, timestamp);
  }

  const insertEvaluation = database.prepare(`INSERT INTO connection_goal_evaluations
    (id,connectionId,goalPlanId,periodStart,periodEnd,salesActual,profitActual,salesAchievement,profitAchievement,totalAchievement,grade,evaluationStatus,statusReason,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertEvaluation.run("phase2e-eval-1", "phase2e-connection-1", "phase2e-plan-1", "2026-07-19", "2026-08-17", 120, 120, 1.2, 1.2, 1.2, "excellent", "evaluated", null, timestamp, timestamp);
  insertEvaluation.run("phase2e-eval-2", "phase2e-connection-2", "phase2e-plan-2", "2026-07-19", "2026-08-17", 70, 70, 0.7, 0.7, 0.7, "underperforming", "evaluated", null, timestamp, timestamp);
  insertEvaluation.run("phase2e-eval-3", "phase2e-connection-3", "phase2e-plan-3", "2026-07-18", "2026-08-16", null, null, null, null, null, null, "pending", "销售事实尚未更新到最新应到日期。", timestamp, timestamp);

  const factsBefore = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;
  const admin = readConnectionGoalCockpitSummary({ database, userId: owner.id, isAdmin: true });
  assert.deepEqual({
    totalLinks: admin.totalLinks,
    positionedLinks: admin.positionedLinks,
    unpositionedLinks: admin.unpositionedLinks,
    activeGoalLinks: admin.activeGoalLinks,
    pendingGoalLinks: admin.pendingGoalLinks,
    evaluatedLinks: admin.evaluatedLinks,
    pendingEvaluationLinks: admin.pendingEvaluationLinks,
  }, { totalLinks: 5, positionedLinks: 4, unpositionedLinks: 1, activeGoalLinks: 3, pendingGoalLinks: 2, evaluatedLinks: 2, pendingEvaluationLinks: 3 });
  assert.deepEqual(admin.gradeSummary, { excellent: 1, good: 0, on_target: 0, underperforming: 1 });
  assert.equal(admin.evaluationPeriod.periodEnd, "2026-08-17");
  assert.equal(admin.evaluationPeriod.periodCount, 1);
  assert.equal(admin.positioningSummary.find((item) => item.positioningType === "sales_growth").excellent, 1);
  assert.equal(admin.positioningSummary.find((item) => item.positioningType === "balanced_sales").underperforming, 1);
  assert.equal(admin.positioningSummary.find((item) => item.positioningType === "long_tail").pendingEvaluationLinks, 1);
  assert.equal(admin.positioningSummary.find((item) => item.positioningType === "profit_contribution").pendingEvaluationLinks, 1);

  const scoped = readConnectionGoalCockpitSummary({ database, userId: owner.id, isAdmin: false });
  assert.equal(scoped.totalLinks, 3);
  assert.equal(scoped.positionedLinks, 3);
  assert.equal(scoped.activeGoalLinks, 3);
  assert.equal(scoped.evaluatedLinks, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factsBefore);
  const serviceSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server/connectionGoalCockpitService.js"), "utf8");
  assert.equal(serviceSource.includes("connection_sku_sales"), false);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    coverage: { total: admin.totalLinks, positioned: admin.positionedLinks, goals: admin.activeGoalLinks, evaluated: admin.evaluatedLinks, pending: admin.pendingEvaluationLinks },
    grades: admin.gradeSummary,
    positioningGroups: admin.positioningSummary.length,
    evaluationPeriodEnd: admin.evaluationPeriod.periodEnd,
    permissionScope: { admin: admin.totalLinks, owner: scoped.totalLinks },
    salesFactsReadByGoalHealthQuery: false,
    salesFactsChanged: false,
    integrity: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
