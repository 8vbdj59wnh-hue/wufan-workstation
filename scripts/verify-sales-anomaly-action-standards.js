import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const databasePath = path.join(os.tmpdir(), `sales-anomaly-action-standards-${process.pid}.db`);
process.env.WUFAN_DB_PATH = databasePath;
const { initializeDatabase, getDatabase, createResource, launchWorkPlanWithProcess, closeDatabase } = await import("../server/db.js");
const { listSalesAnomalyActionStandardDefinitions } = await import("../server/capabilities/salesAnomalyActionStandards.js");
initializeDatabase({ reset: true }); initializeDatabase();
const db = getDatabase();
const definitions = listSalesAnomalyActionStandardDefinitions();
assert.equal(definitions.length, 4);
const expected = { sales_drop: "链接销售恢复分析标准", profit_drop: "链接利润改善标准", sales_gap: "链接销售恢复排查标准", data_quality_issue: "经营数据治理标准" };
const goal = db.prepare("SELECT id FROM goals WHERE status<>'inactive' ORDER BY id LIMIT 1").get();
const initiator = db.prepare("SELECT id FROM persons WHERE status<>'inactive' ORDER BY id LIMIT 1").get();
assert.ok(goal && initiator);
const protectedBefore = {
  facts: db.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: db.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count,
  usages: db.prepare("SELECT COUNT(*) count FROM erp_sku_business_usages").get().count,
};
const results = [];
for (const definition of definitions) {
  assert.equal(definition.name, expected[definition.anomalyType]);
  const standard = db.prepare("SELECT * FROM task_templates WHERE id=? AND status='active'").get(definition.id);
  const process = db.prepare("SELECT * FROM process_templates WHERE id=? AND status='active'").get(definition.processId);
  const nodes = db.prepare("SELECT * FROM process_template_nodes WHERE templateId=? AND status='active' ORDER BY stepOrder").all(definition.processId);
  assert.equal(standard.defaultProcessTemplateId, process.id); assert.equal(nodes.length, 2);
  const workPlanId = `work-plan-${crypto.randomUUID()}`;
  const customFields = { source: "sales_anomaly", sourceType: "sales_anomaly", actionStandardId: standard.id, salesLinkId: definition.anomalyType === "data_quality_issue" ? null : "sales-link-test", productId: null, anomalySnapshot: { anomalyType: definition.anomalyType }, recommendedActionStandard: { actionStandardId: standard.id, name: standard.name, target: standard.completionStandard, processTemplateId: process.id, processName: process.name, processDescription: process.purpose } };
  createResource("work-plans", { id: workPlanId, goalId: goal.id, departmentId: standard.departmentId, taskTemplateId: standard.id, title: standard.name, customFields, coverImageUrl: null, workType: "normal", status: "future", plannedWeek: null, dueDate: null, description: "人工确认后启动。", processInstanceId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), launchedAt: null, canceledAt: null });
  const taskCountBefore = db.prepare("SELECT COUNT(*) count FROM tasks").get().count;
  const processCountBefore = db.prepare("SELECT COUNT(*) count FROM process_instances").get().count;
  assert.equal(db.prepare("SELECT status FROM work_plans WHERE id=?").get(workPlanId).status, "future");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, taskCountBefore);
  const instanceId = `process-instance-${crypto.randomUUID()}`;
  const instance = { id: instanceId, templateId: process.id, taskTemplateId: standard.id, templateVersion: process.version, name: standard.name, displayTitle: standard.name, goalId: goal.id, initiatorId: initiator.id, description: "销售异常人工行动", status: "running", startedAt: null, dueDate: null, completedAt: null, stoppedAt: null, canceledAt: null, cancelReason: null, customFields, coverImageUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const tasks = nodes.map((node, index) => ({ id: `task-${crypto.randomUUID()}`, taskType: "execution", name: node.name, goalId: goal.id, taskTemplateId: null, source: "process", processInstanceId: instanceId, processNodeId: node.id, categoryId: null, departmentId: node.departmentId, ownerId: initiator.id, executorId: initiator.id, initiatorId: initiator.id, description: node.description, completionStandard: node.completionStandard, reviewStandard: null, outputRequirement: node.outputRequirement, startDate: null, readyAt: index === 0 ? new Date().toISOString() : null, dueDate: null, plannedWeek: null, needAcceptance: false, accepterId: null, status: index === 0 ? "todo" : "waiting", resultText: null, resultAttachments: [], submitType: "text", submitDescription: node.submitDescription, submitFields: [], submitFormData: {}, submitFiles: [], submitLinks: [], submittedAt: null, submittedBy: null, cancelReason: null, customFields: {}, displayTitle: null, coverImageUrl: null, reviewTargetTaskId: null, reviewTargetSnapshot: null, returnToNodeId: null, reviewStatus: null, reviewComment: null, reviewedAt: null, reviewerId: null, requireRejectionReason: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null }));
  launchWorkPlanWithProcess(workPlanId, { processInstance: instance, tasks, workPlan: { ...db.prepare("SELECT * FROM work_plans WHERE id=?").get(workPlanId), customFields, status: "launched", processInstanceId: instanceId }, initiatorId: initiator.id });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM process_instances").get().count, processCountBefore + 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, taskCountBefore + 2);
  assert.equal(db.prepare("SELECT templateId,taskTemplateId FROM process_instances WHERE id=?").get(instanceId).templateId, process.id);
  results.push({ anomalyType: definition.anomalyType, actionStandardId: standard.id, processTemplateId: process.id, taskCount: 2 });
}
assert.deepEqual({ facts: db.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count, mappings: db.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count, usages: db.prepare("SELECT COUNT(*) count FROM erp_sku_business_usages").get().count }, protectedBefore);
assert.equal(db.pragma("integrity_check", { simple: true }), "ok"); assert.equal(db.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, databasePath, results, protectedBefore }, null, 2)); closeDatabase();
