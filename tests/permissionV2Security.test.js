import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authorizePersonWrite, getTaskWorkflowPermission } from "../server/modules/auth/index.js";
import { createEmptyPermissions } from "../shared/permissions.js";

function userWith(...permissionKeys) {
  const permissions = createEmptyPermissions("all");
  for (const permissionKey of permissionKeys) {
    const [group, key] = permissionKey.split(".");
    permissions[group][key] = true;
  }
  return { role: "user", permissions };
}

test("人员基础编辑不能修改账号或权限", () => {
  const peopleManager = userWith("people.view", "people.manage");
  assert.equal(authorizePersonWrite(peopleManager, { id: "person-1", name: "新姓名" }), true);
  assert.equal(authorizePersonWrite(peopleManager, { id: "person-1", username: "new-account" }), false);
  assert.equal(authorizePersonWrite(peopleManager, { id: "person-1", authRole: "admin" }), false);
  assert.equal(authorizePersonWrite(peopleManager, { id: "person-1", permissions: createEmptyPermissions() }), false);

  const accountManager = userWith("people.view", "people.manageAccounts");
  assert.equal(authorizePersonWrite(accountManager, { id: "person-1", username: "new-account" }), true);
  assert.equal(authorizePersonWrite(accountManager, { id: "person-1", name: "不能改业务信息" }), false);
  assert.equal(authorizePersonWrite(accountManager, { id: "person-1", permissions: createEmptyPermissions() }), false);

  const permissionManager = userWith("permissions.manage");
  assert.equal(authorizePersonWrite(permissionManager, { id: "person-1", permissions: createEmptyPermissions() }), true);
  assert.equal(authorizePersonWrite(permissionManager, { id: "person-1", username: "forbidden" }), false);
});

test("任务流程动作按执行、管理、验收和取消权限分别控制", () => {
  for (const action of ["start", "submit"]) assert.equal(getTaskWorkflowPermission(action), "tasks.execute");
  for (const action of ["approve", "reject", "review_approve", "review_reject"]) assert.equal(getTaskWorkflowPermission(action), "tasks.accept");
  assert.equal(getTaskWorkflowPermission("cancel"), "tasks.cancel");
  for (const action of ["return", "activate", "edit", "restore"]) assert.equal(getTaskWorkflowPermission(action), "tasks.manage");
  assert.equal(getTaskWorkflowPermission("unknown"), undefined);
});

test("模板查看、链接评级读取和刷新使用不同后端门禁", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /templates:\s*\{\s*read: permissionRule\("templates\.view"\),\s*write: permissionRule\("templates\.manage"\)/);
  assert.match(source, /app\.get\("\/api\/connections\/:id\/business-goal-evaluation", requireLinkView/);
  assert.match(source, /app\.post\("\/api\/connections\/:id\/business-goal-evaluation\/refresh", requireLinkRating/);
  const readRoute = source.match(/app\.get\("\/api\/connections\/:id\/business-goal-evaluation"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.match(readRoute, /readConnectionGoalEvaluation\(request\.params\.id\)/);
  assert.doesNotMatch(readRoute, /evaluateConnectionGoal/);
});

test("健康记录写接口停止生成新记录", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const route = source.match(/app\.post\("\/api\/connections\/:id\/health-records"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.equal(route, "", "生产基线已彻底退役健康记录写接口，不应重新注册兼容路由");
  assert.doesNotMatch(route, /createConnectionHealthRecord/);
});
