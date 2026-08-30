import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { closeDatabase, getDatabase, initializeDatabase } from "../server/db.js";
import { updateConnectionAction } from "../server/connectionService.js";
import { parseConnectionCenterRoute } from "../src/utils/connectionCenterRoute.js";
import {
  completeConnectionInspection,
  createInspectionAction,
  ensureConnectionInspectionTemplate,
  readConnectionInspection,
  readConnectionInspectionOverview,
  readConnectionInspectionTaskContext,
  runDueConnectionInspectionSchedules,
  saveConnectionInspectionDraft,
  saveConnectionInspectionSchedule,
  startConnectionInspection,
  syncInspectionIssuesForActionStatus,
} from "../server/connectionInspectionService.js";

function fixture() {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  const timestamp = "2026-08-30T00:00:00.000Z";
  const person = database.prepare("SELECT id,departmentId FROM persons WHERE status='active' AND departmentId IS NOT NULL ORDER BY id LIMIT 1").get();
  assert.ok(person, "隔离数据库需要一名在职人员");
  let goal = database.prepare("SELECT id FROM goals WHERE status='active' AND (departmentId=? OR departmentId IS NULL) ORDER BY id LIMIT 1").get(person.departmentId);
  if (!goal) {
    goal = { id: "goal-connection-inspection-test" };
    database.prepare(`INSERT INTO goals
      (id,name,level,type,departmentId,ownerId,status,createdAt,updatedAt)
      VALUES (?,?, 'company','period',?,?, 'active',?,?)`)
      .run(goal.id, "链接体检测试目标", person.departmentId, person.id, timestamp, timestamp);
  }
  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('shop-inspection-test','tmall','体检测试店铺','体检测试店铺','天猫 · 体检测试店铺','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,displayName,ownerId,identityStrength,currentState,createdAt,updatedAt)
    VALUES ('sales-link-inspection-test','shop-inspection-test','goods-inspection-test','体检测试商品','体检测试商品',?,'strong','active',?,?)`)
    .run(person.id, timestamp, timestamp);
  return { database, person };
}

test("链接体检完成草稿、快照、行动、任务和周期闭环", () => {
  const { database, person } = fixture();
  const linkId = "sales-link-inspection-test";
  const template = ensureConnectionInspectionTemplate(database, person.id);
  assert.equal(template.assetType, "inspection");
  assert.equal(template.content.items.length, 10);
  assert.equal(template.content.items.flatMap((item) => item.criteria).length, 30);

  const draft = startConnectionInspection(linkId, {}, { database, userId: person.id });
  assert.equal(draft.status, "draft");
  assert.equal(draft.results.length, 30);
  saveConnectionInspectionDraft(draft.id, {
    results: [{ id: draft.results[0].id, grade: "B", note: "草稿备注需要保留" }],
  }, { database, userId: person.id });
  const restoredDraft = readConnectionInspection(draft.id, { database });
  assert.equal(restoredDraft.results[0].grade, "B");
  assert.equal(restoredDraft.results[0].note, "草稿备注需要保留");
  assert.throws(
    () => completeConnectionInspection(draft.id, { results: [] }, { database, userId: person.id }),
    /必须为30个核心标准全部评分/u,
  );

  const answers = restoredDraft.results.map((row, index) => ({
    id: row.id,
    grade: index === 0 ? "B" : index === 1 ? "C" : index === 2 ? "D" : "A",
    note: index < 3 ? `问题备注${index + 1}` : "",
  }));
  const completed = completeConnectionInspection(draft.id, { results: answers }, { database, userId: person.id });
  assert.deepEqual([completed.gradeACount, completed.gradeBCount, completed.gradeCCount, completed.gradeDCount], [27, 1, 1, 1]);
  assert.equal(completed.issues.length, 3);
  assert.throws(() => saveConnectionInspectionDraft(draft.id, { results: [] }, { database }), /已完成体检不可修改/u);
  assert.throws(() => completeConnectionInspection(draft.id, { results: answers }, { database }), /已完成体检不可修改/u);

  const sourceGrade = completed.results[0].grade;
  const actionResult = createInspectionAction(linkId, {
    issueIds: completed.issues.map((issue) => issue.id),
    title: "链接基础建设改善",
    ownerId: person.id,
    dueDate: "2026-09-15",
    createTask: true,
  }, { database, userId: person.id });
  assert.ok(actionResult.action.id.startsWith("connection-action-"));
  assert.ok(actionResult.task.id.startsWith("task-"));
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_inspection_issue_actions WHERE actionId=?").get(actionResult.action.id).count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_action_tasks WHERE actionId=?").get(actionResult.action.id).count, 1);
  assert.throws(() => createInspectionAction(linkId, {
    issueIds: completed.issues.map((issue) => issue.id), ownerId: person.id, createTask: true,
  }, { database, userId: person.id }), /请勿重复提交/u);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_actions WHERE connectionProfileId=?").get(linkId).count, 1);

  updateConnectionAction(linkId, actionResult.action.id, { status: "completed" });
  syncInspectionIssuesForActionStatus(actionResult.action.id, "completed", { database });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_inspection_issues WHERE inspectionId=? AND status='awaiting_reinspection'").get(draft.id).count, 3);
  assert.equal(readConnectionInspection(draft.id, { database }).results[0].grade, sourceGrade, "行动完成不得更改历史评分");

  const second = startConnectionInspection(linkId, {}, { database, userId: person.id });
  assert.notEqual(second.id, draft.id);
  assert.equal(readConnectionInspectionOverview(linkId, { database, userId: person.id }).history.length, 1);

  for (const [cadenceType, intervalDays] of [["manual", null], ["days_60", 60], ["days_90", 90], ["custom", 45]]) {
    const candidate = saveConnectionInspectionSchedule(linkId, {
      cadenceType, intervalDays: cadenceType === "custom" ? intervalDays : undefined,
      assigneeId: person.id, enabled: cadenceType !== "manual",
    }, { database, userId: person.id });
    assert.equal(candidate.intervalDays, intervalDays);
    assert.equal(candidate.enabled, cadenceType === "manual" ? 0 : 1);
  }

  const schedule = saveConnectionInspectionSchedule(linkId, {
    cadenceType: "days_30", assigneeId: person.id, enabled: true,
  }, { database, userId: person.id });
  assert.equal(schedule.intervalDays, 30);
  database.prepare("UPDATE connection_inspection_schedules SET nextInspectionAt='2026-09-01' WHERE id=?").run(schedule.id);
  const firstRun = runDueConnectionInspectionSchedules({ database, referenceDate: "2026-09-01" });
  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].created, true);
  const secondRun = runDueConnectionInspectionSchedules({ database, referenceDate: "2026-09-01" });
  assert.equal(secondRun.length, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_inspection_schedule_tasks WHERE scheduleId=? AND dueDate='2026-09-01'").get(schedule.id).count, 1);
  const taskContext = readConnectionInspectionTaskContext(firstRun[0].taskId, { database });
  assert.equal(taskContext.salesLinkId, linkId);
  assert.equal(taskContext.inspectionScheduleId, schedule.id);
  const taskDraft = startConnectionInspection(linkId, { taskId: firstRun[0].taskId }, { database, userId: person.id });
  assert.equal(taskDraft.id, second.id);
  assert.equal(database.prepare("SELECT inspectionId FROM connection_inspection_schedule_tasks WHERE taskId=?").get(firstRun[0].taskId).inspectionId, second.id);
  assert.deepEqual(
    parseConnectionCenterRoute(`#connectionCenter/${linkId}?inspectionTaskId=${firstRun[0].taskId}`),
    { section: "", detailId: linkId, inspectionTaskId: firstRun[0].taskId },
  );

  database.prepare("UPDATE sales_links SET currentState='archived' WHERE id=?").run(linkId);
  assert.throws(() => startConnectionInspection(linkId, {}, { database, userId: person.id }), /当前Link已失效/u);
  assert.throws(() => saveConnectionInspectionSchedule(linkId, {
    cadenceType: "days_30", assigneeId: person.id, enabled: true,
  }, { database, userId: person.id }), /当前Link已失效/u);
  database.prepare("UPDATE sales_links SET currentState='active' WHERE id=?").run(linkId);

  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(database.pragma("foreign_key_check").length, 0);
  const source = fs.readFileSync(new URL("../server/connectionInspectionService.js", import.meta.url), "utf8");
  for (const legacy of ["connection_health_records", "connection_improvements", "healthScore", "diagnosis"]) {
    assert.equal(source.includes(legacy), false, `体检服务不得引用Legacy健康模型: ${legacy}`);
  }
});

test.after(() => closeDatabase());
