import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-goal-phase2d-"));
process.env.WUFAN_DB_PATH = path.join(temporaryDirectory, "verification.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { evaluateConnectionGoal } = await import("../server/connectionGoalEvaluationService.js");
const {
  batchConfirmConnectionGoals,
  batchGenerateConnectionGoalSuggestions,
  batchSetConnectionPositioning,
  readConnectionGoalWorkbench,
} = await import("../server/connectionGoalWorkbenchService.js");

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
  const people = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 2").all();
  const owner = people[0]; const otherOwner = people[1];
  assert.ok(owner?.id && otherOwner?.id);

  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('phase2d-shop','taobao','Phase 2D店铺','phase 2d店铺','Phase 2D店铺','active',?,?)`).run(timestamp, timestamp);
  const insertLink = database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES (?,'phase2d-shop',?,?, 'strong','manual','complete','active',?,?)`);
  const insertProfile = database.prepare(`INSERT INTO connection_profiles
    (id,salesLinkId,name,ownerId,status,level,originSource,createdAt,updatedAt)
    VALUES (?,?,?,?, 'active','new','manual',?,?)`);
  for (const [index, ownerId] of [owner.id, owner.id, otherOwner.id].entries()) {
    const number = index + 1;
    insertLink.run(`phase2d-link-${number}`, `phase2d-goods-${number}`, `Phase 2D链接${number}`, timestamp, timestamp);
    insertProfile.run(`phase2d-connection-${number}`, `phase2d-link-${number}`, `Phase 2D链接${number}`, ownerId, timestamp, timestamp);
  }

  const adminContext = { database, userId: owner.id, isAdmin: true };
  const ownerContext = { database, userId: owner.id, isAdmin: false };
  const otherOwnerContext = { database, userId: otherOwner.id, isAdmin: false };
  const adminPage1 = readConnectionGoalWorkbench({ page: 1, pageSize: 2 }, adminContext);
  const adminPage2 = readConnectionGoalWorkbench({ page: 2, pageSize: 2 }, adminContext);
  assert.equal(adminPage1.pagination.total, 3);
  assert.equal(adminPage1.items.length, 2);
  assert.equal(adminPage2.items.length, 1);
  assert.equal(readConnectionGoalWorkbench({}, ownerContext).pagination.total, 2);
  assert.equal(readConnectionGoalWorkbench({}, otherOwnerContext).pagination.total, 1);
  assert.throws(() => batchSetConnectionPositioning({ connectionIds: ["phase2d-connection-3"], positioningType: "sales_growth", decisionReason: "越权验证" }, ownerContext), /只能管理自己负责/);
  assert.throws(() => batchSetConnectionPositioning({ connectionIds: Array.from({ length: 101 }, (_, index) => `id-${index}`), positioningType: "sales_growth", decisionReason: "数量限制" }, adminContext), /最多处理100个/);

  const positioned = batchSetConnectionPositioning({ connectionIds: ["phase2d-connection-1", "phase2d-connection-2"],
    positioningType: "sales_growth", decisionReason: "批量确认两条链接经营定位" }, ownerContext);
  assert.equal(positioned.changedCount, 2);
  const repeated = batchSetConnectionPositioning({ connectionIds: ["phase2d-connection-1", "phase2d-connection-2"],
    positioningType: "sales_growth", decisionReason: "幂等验证" }, ownerContext);
  assert.equal(repeated.skippedCount, 2);

  database.prepare(`INSERT INTO erp_goods
    (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt)
    VALUES ('phase2d-erp-goods','PHASE2D-GOODS','Phase 2D ERP货品','{}','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO erp_skus
    (id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('phase2d-erp-sku','PHASE2D-SKU','phase2d-erp-goods','{}','phase2d-import','phase2d-import','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2d-link-sku','phase2d-link-1','phase2d-platform-sku','PHASE2D-SKU','phase2d-sku','默认','默认','matched','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType)
    VALUES ('phase2d-import','sales_daily','phase2d.xlsx','phase2d-hash','2026-08-17','committed',30,30,0,0,?,?,?,'sales_daily')`).run(owner.id, timestamp, timestamp);
  const insertFact = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
    (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
    VALUES (?,'phase2d-link-1','phase2d-link-sku','phase2d-erp-sku',?,1,100,90,10,'normal','phase2d-import',?,'{}',?,?)`);
  for (let index = 0; index < 30; index += 1) insertFact.run(`phase2d-fact-${index}`, dateAtOffset("2026-07-19", index), index + 1, timestamp, timestamp);
  const factCountBefore = database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count;

  const generated = batchGenerateConnectionGoalSuggestions({ connectionIds: ["phase2d-connection-1", "phase2d-connection-2", "phase2d-connection-3"] }, adminContext);
  assert.equal(generated.generatedCount, 2);
  assert.equal(generated.skippedCount, 1);
  assert.equal(generated.results.find((item) => item.connectionId === "phase2d-connection-3").reason, "missing_positioning");
  const confirmed = batchConfirmConnectionGoals({ connectionIds: ["phase2d-connection-1", "phase2d-connection-2"], approvalReason: "批量确认验证" }, ownerContext);
  assert.equal(confirmed.confirmedCount, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_plans WHERE status='active'").get().count, 2);

  const firstEvaluation = evaluateConnectionGoal("phase2d-connection-1", { database, today: "2026-08-18" });
  const secondEvaluation = evaluateConnectionGoal("phase2d-connection-2", { database, today: "2026-08-18" });
  assert.equal(firstEvaluation.grade, "good");
  assert.equal(secondEvaluation.evaluationStatus, "pending");
  assert.equal(secondEvaluation.reasonCode, "link_data_missing");

  const workbench = readConnectionGoalWorkbench({ page: 1, pageSize: 50 }, adminContext);
  assert.deepEqual(workbench.summary, { total: 3, positioned: 2, unpositioned: 1, goalSet: 2, goalPending: 1, evaluated: 1, evaluationPending: 2 });
  assert.equal(readConnectionGoalWorkbench({ positioning: "sales_growth" }, adminContext).pagination.total, 2);
  assert.equal(readConnectionGoalWorkbench({ positioning: "unset" }, adminContext).pagination.total, 1);
  assert.equal(readConnectionGoalWorkbench({ goalStatus: "set" }, adminContext).pagination.total, 2);
  assert.equal(readConnectionGoalWorkbench({ evaluationStatus: "good" }, adminContext).pagination.total, 1);
  assert.equal(readConnectionGoalWorkbench({ evaluationStatus: "pending" }, adminContext).pagination.total, 2);
  const firstRow = workbench.items.find((item) => item.id === "phase2d-connection-1");
  assert.equal(firstRow.salesAmount, 3000);
  assert.equal(firstRow.profitAmount, 300);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, factCountBefore);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    serverPagination: { total: 3, pageSize: 2, page1: 2, page2: 1 },
    coverage: workbench.summary,
    batchPositioned: positioned.changedCount,
    suggestionsGenerated: generated.generatedCount,
    goalsConfirmed: confirmed.confirmedCount,
    permissionIsolation: true,
    salesFactsUnchangedByWorkbench: true,
    integrity: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
