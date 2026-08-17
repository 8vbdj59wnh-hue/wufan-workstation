import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourcePath = process.env.WUFAN_VERIFY_SOURCE_DB || "/private/tmp/v2-development-workstation.phase2g-before-20260818.db";
const testPath = path.join(os.tmpdir(), `connection-goal-pilot-${crypto.randomUUID()}.db`);
fs.copyFileSync(sourcePath, testPath);
process.env.WUFAN_DB_PATH = testPath;

const dbModule = await import("../server/db.js");
const service = await import("../server/connectionGoalPilotService.js");
dbModule.initializeDatabase();
const database = dbModule.getDatabase();

const adminId = database.prepare("SELECT id FROM persons WHERE status='active' AND authRole IN ('admin','system_admin') LIMIT 1").get()?.id || "person-001";
const admin = { userId: adminId, isAdmin: true, database };
const factsBefore = database.prepare("SELECT COUNT(*) count,SUM(salesAmount) sales,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get();
const assetsBefore = database.prepare("SELECT COUNT(*) profiles,(SELECT COUNT(*) FROM sales_links) links FROM connection_profiles").get();

try {
  const empty = service.readConnectionGoalPilotBatches({}, admin);
  assert.equal(empty.items.length, 0);
  const candidates = service.readConnectionGoalPilotCandidates({ page: 1, pageSize: 5 }, admin);
  assert.equal(candidates.pagination.total, 106);
  assert.equal(candidates.pagination.pageSize, 5);
  assert.ok(candidates.items.every((item) => item.ownerId && item.factRows > 0));
  const candidate = candidates.items[0];
  const owner = { userId: candidate.ownerId, isAdmin: false, database };
  const ordinaryId = database.prepare("SELECT id FROM persons WHERE status='active' AND id NOT IN (?,?) LIMIT 1").get(adminId, candidate.ownerId)?.id;

  const first = service.createConnectionGoalPilotBatch({ name: "Phase 2G 隔离验证批次", description: "仅用于临时数据库验证" }, admin).item;
  assert.equal(first.status, "draft");
  assert.throws(() => service.createConnectionGoalPilotBatch({ name: "无权限" }, owner), /仅管理员/);
  assert.equal(service.addConnectionGoalPilotLinks(first.id, { connectionIds: [candidate.id] }, admin).addedCount, 1);
  assert.equal(service.addConnectionGoalPilotLinks(first.id, { connectionIds: [candidate.id] }, admin).addedCount, 0);
  let members = service.readConnectionGoalPilotMembers(first.id, { page: 1, pageSize: 20 }, admin);
  assert.equal(members.pagination.total, 1);
  const member = members.items[0];
  assert.equal(service.readConnectionGoalPilotBatches({}, owner).items.length, 1);
  if (ordinaryId) assert.equal(service.readConnectionGoalPilotBatches({}, { userId: ordinaryId, isAdmin: false, database }).items.length, 0);

  service.updateConnectionGoalPilotBatch(first.id, { status: "positioning" }, admin);
  service.confirmConnectionGoalPilotPositioning(first.id, member.id, {
    positioningType: "balanced_sales", decisionReason: "Phase 2G 隔离验证人工确认",
  }, owner);
  members = service.readConnectionGoalPilotMembers(first.id, {}, admin);
  assert.equal(members.batch.progress.positionedLinks, 1);
  service.updateConnectionGoalPilotBatch(first.id, { status: "target_confirm" }, admin);
  const suggestion = service.createConnectionGoalPilotSuggestion(first.id, member.id, owner);
  assert.equal(suggestion.suggestion.available, true);
  assert.equal(suggestion.suggestion.windows.filter((window) => window.complete).length, 1);
  assert.ok(suggestion.plan);
  const sales = suggestion.plan.metrics.find((metric) => metric.metricCode === "sales_amount").suggestedTargetValue;
  const profit = suggestion.plan.metrics.find((metric) => metric.metricCode === "profit_amount").suggestedTargetValue;
  service.confirmConnectionGoalPilotTarget(first.id, member.id, {
    planId: suggestion.plan.id, salesAmount: sales, profitAmount: profit, approvalReason: "按隔离验证建议确认",
  }, owner);
  members = service.readConnectionGoalPilotMembers(first.id, {}, admin);
  assert.equal(members.batch.progress.confirmedGoalLinks, 1);
  assert.equal(members.items[0].targetConfidence, "low");
  service.updateConnectionGoalPilotBatch(first.id, { status: "evaluation" }, admin);

  const second = service.createConnectionGoalPilotBatch({ name: "Phase 2G 历史复用验证" }, admin).item;
  assert.equal(service.addConnectionGoalPilotLinks(second.id, { connectionIds: [candidate.id] }, admin).addedCount, 1);
  const secondMember = service.readConnectionGoalPilotMembers(second.id, {}, admin).items[0];
  service.updateConnectionGoalPilotMember(second.id, secondMember.id, { status: "excluded" }, admin);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_init_batch_links WHERE connectionId=?").get(candidate.id).count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_init_batch_links WHERE connectionId=? AND status='excluded'").get(candidate.id).count, 1);

  const factsAfter = database.prepare("SELECT COUNT(*) count,SUM(salesAmount) sales,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get();
  const assetsAfter = database.prepare("SELECT COUNT(*) profiles,(SELECT COUNT(*) FROM sales_links) links FROM connection_profiles").get();
  assert.deepEqual(factsAfter, factsBefore);
  assert.deepEqual(assetsAfter, assetsBefore);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    candidatePool: candidates.pagination.total,
    serverPagination: { pageSize: candidates.pagination.pageSize, returned: candidates.items.length },
    permissions: { adminCreatedBatch: true, ownerManagedOwnLink: true, ordinaryScopedReadOnly: true },
    progress: members.batch.progress,
    targetConfidence: members.items[0].targetConfidence,
    historicalBatchLinksForSameConnection: 2,
    excludedHistoryRetained: true,
    salesAndProfitFactsChanged: false,
    linkAssetsChanged: false,
    integrity: "ok",
  }, null, 2));
} finally {
  dbModule.closeDatabase();
  fs.rmSync(testPath, { force: true });
}
