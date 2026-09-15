import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API进程提前退出：${child.exitCode}\n${child.capturedError || ""}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("API启动超时。");
}

async function request(baseUrl, pathname, { token = "", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("助手设备可长期续期、逐台撤销，且仅能受控发起行动与新增下周需求", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-device-session-"));
  const databasePath = path.join(directory, "workstation.db");
  const contentDatabasePath = path.join(directory, "content-center.sqlite");
  process.env.WUFAN_DB_PATH = databasePath;
  process.env.WUFAN_CONTENT_DB_PATH = contentDatabasePath;
  process.env.WUFAN_AUTH_SECRET_PATH = path.join(directory, "auth.secret");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { hashPassword } = await import("../server/security.js");
  const { createEmptyPermissions } = await import("../shared/permissions.js");
  let child;
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const people = database.prepare("SELECT id,departmentId FROM persons WHERE lower(COALESCE(username,''))<>'admin' ORDER BY id LIMIT 2").all();
    assert.equal(people.length, 2);
    const readPermissions = createEmptyPermissions("all");
    for (const permission of ["goals", "keyActions", "tasks", "products", "skus", "links", "dataCenter", "cockpit", "actionStandards", "contentCenter"]) {
      readPermissions[permission].view = true;
    }
    readPermissions.keyActions.launch = true;
    readPermissions.keyActions.launchTemplateScope = "all";
    readPermissions.contentCenter.manage = true;
    const writePermissions = structuredClone(readPermissions);
    writePermissions.tasks.execute = true;
    const update = database.prepare(`UPDATE persons SET username=?,passwordHash=?,canLogin=1,authRole='user',role='member',
      permissionTemplateId=NULL,permissionOverrides=NULL,permissions=?,status='active' WHERE id=?`);
    update.run("assistant-read-test", hashPassword("read-password"), JSON.stringify(readPermissions), people[0].id);
    update.run("assistant-write-test", hashPassword("write-password"), JSON.stringify(writePermissions), people[1].id);
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO goals(id,name,level,type,departmentId,ownerId,status,createdAt,updatedAt)
      VALUES('assistant-goal','助手测试目标','company','period',?,?, 'active',?,?)`).run(people[0].departmentId, people[0].id, now, now);
    database.prepare(`INSERT INTO process_templates(id,name,applicableDepartmentIds,ownerId,status,version,createdAt,updatedAt)
      VALUES('assistant-process','助手测试流程','[]',?,'active',1,?,?)`).run(people[0].id, now, now);
    database.prepare(`INSERT INTO task_templates(id,name,defaultProcessTemplateId,departmentId,ownerId,description,completionStandard,needAcceptance,status,formFields,createdAt,updatedAt)
      VALUES('assistant-standard','助手测试行动标准','assistant-process',?,?, '完成行动内容','按标准步骤完成',0,'active','[]',?,?)`).run(people[0].departmentId, people[0].id, now, now);
    database.prepare(`INSERT INTO process_template_nodes(id,templateId,stepType,stepOrder,stageName,stageOrder,nodeOrder,name,ownerRule,durationDays,durationMinutes,defaultImportance,defaultUrgency,accepterRule,status,createdAt,updatedAt)
      VALUES('assistant-node','assistant-process','execution',1,'执行',1,1,'执行测试行动','initiator',1,60,'medium','medium','none','active',?,?)`).run(now, now);
    database.prepare(`INSERT INTO standard_work_forms(id,standardWorkId,formSchema,createdAt,updatedAt)
      VALUES('assistant-form','assistant-standard',?,?,?)`).run(JSON.stringify({ fields: [{ id: "acceptance", key: "acceptanceStandard", label: "验收标准", type: "textarea", required: true, sortOrder: 1 }] }), now, now);
    closeDatabase();
    const { createStore } = await import("../server/contentCenter/store.mjs");
    const contentStore = createStore(contentDatabasePath);
    const contentBrand = contentStore.getCatalog().units.find((unit) => unit.kind === "品牌");
    const contentAccount = contentStore.getCatalog().accounts.find((account) => account.unitId === contentBrand.id && account.status !== "inactive");
    contentStore.close();

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server/index.js"], {
      cwd: projectRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), V3_AUTO_PROJECTION: "off", V3_SHADOW_ENABLED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.capturedError = "";
    child.stderr.on("data", (chunk) => { child.capturedError += chunk.toString(); });
    await waitForServer(baseUrl, child);

    const loginA = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-A" },
    });
    const loginB = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-B" },
    });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    assert.match(loginA.body.refreshToken, /^wfr1\./u);
    assert.notEqual(loginA.body.refreshToken, loginB.body.refreshToken);
    const tokenPayload = JSON.parse(Buffer.from(loginA.body.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(tokenPayload.mode, "assistant_read_only");
    assert.equal(tokenPayload.sid, loginA.body.deviceSession.id);
    const assetPayload = JSON.parse(Buffer.from(loginA.body.assetToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(assetPayload.mode, "assistant_read_only");
    assert.equal(assetPayload.sid, loginA.body.deviceSession.id);

    const launcherLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-launcher", assistantAccessProfile: "key_action_launcher" },
    });
    assert.equal(launcherLogin.status, 200);
    assert.equal(launcherLogin.body.deviceSession.accessProfile, "key_action_launcher");
    const launcherPayload = JSON.parse(Buffer.from(launcherLogin.body.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(launcherPayload.mode, "assistant_scoped");
    assert.equal(launcherPayload.assistantAccessProfile, "key_action_launcher");

    const plannerLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-read-test", password: "read-password", assistantDeviceName: "Windows-planner", assistantAccessProfile: "content_planner" },
    });
    assert.equal(plannerLogin.status, 200);
    assert.equal(plannerLogin.body.deviceSession.accessProfile, "content_planner");
    const plannerPayload = JSON.parse(Buffer.from(plannerLogin.body.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(plannerPayload.mode, "assistant_scoped");
    assert.equal(plannerPayload.assistantAccessProfile, "content_planner");
    const selection = await request(baseUrl, `/api/content-center/planning/product-selection?brand=${encodeURIComponent(contentBrand.name)}`, { token: plannerLogin.body.token });
    assert.equal(selection.status, 200, JSON.stringify(selection.body));
    assert.equal(selection.body.brand.id, contentBrand.id);
    const planningInput = {
      idempotencyKey: "assistant-device-2026-w39-v1",
      items: [{ accountId: contentAccount.id, column: contentAccount.columns[0].name, workstationProductIds: [], noteFormat: "图文", preferredDate: "2026-09-22", notes: "助手受控保存的下周内容需求。" }],
    };
    assert.equal((await request(baseUrl, "/api/content-center/planning/requests", { method: "POST", token: loginA.body.token, body: planningInput })).status, 403);
    assert.equal((await request(baseUrl, "/api/content-center/planning/requests", { method: "POST", token: launcherLogin.body.token, body: planningInput })).status, 403);
    const savedPlanning = await request(baseUrl, "/api/content-center/planning/requests", { method: "POST", token: plannerLogin.body.token, body: planningInput });
    assert.equal(savedPlanning.status, 201, JSON.stringify(savedPlanning.body));
    assert.equal(savedPlanning.body.duplicate, false);
    const repeatedPlanning = await request(baseUrl, "/api/content-center/planning/requests", { method: "POST", token: plannerLogin.body.token, body: planningInput });
    assert.equal(repeatedPlanning.status, 201);
    assert.equal(repeatedPlanning.body.duplicate, true);
    for(const token of [loginA.body.token,launcherLogin.body.token]) assert.equal((await request(baseUrl,"/api/content-center/planning/requests/fill",{method:"POST",token,body:{}})).status,403);
    const rejectedFill=await request(baseUrl,"/api/content-center/planning/requests/fill",{method:"POST",token:plannerLogin.body.token,body:{idempotencyKey:"fill-existing-1",items:[{id:savedPlanning.body.items[0].id,revision:1,notes:"不应覆盖"}]}});
    assert.equal(rejectedFill.status,409,JSON.stringify(rejectedFill.body));
    const plannedSchedule = await request(baseUrl, "/api/content-center/planning/schedule?startDate=2026-09-21&endDate=2026-09-27", { token: plannerLogin.body.token });
    assert.equal(plannedSchedule.status, 200);
    assert.equal(plannedSchedule.body.total, 1);
    for (const pathname of ["/api/content-center/notes", "/api/content-center/configuration/units", "/api/content-center/images", "/api/content-center/batch", "/api/content-center/requests/missing/schedule"]) {
      const blocked = await request(baseUrl, pathname, { method: "POST", token: plannerLogin.body.token, body: {} });
      assert.equal(blocked.status, 403, pathname);
      assert.equal(blocked.body.code, "assistant_write_boundary", pathname);
    }
    for (const [method, pathname] of [["PATCH", "/api/content-center/notes/missing"], ["DELETE", "/api/content-center/notes/missing"]]) {
      const blocked = await request(baseUrl, pathname, { method, token: plannerLogin.body.token, body: {} });
      assert.equal(blocked.status, 403, `${method} ${pathname}`);
      assert.equal(blocked.body.code, "assistant_write_boundary", `${method} ${pathname}`);
    }

    const launchInput = {
      goalId: "assistant-goal",
      taskTemplateId: "assistant-standard",
      title: "助手受控发起测试",
      description: "验证预览、确认和服务端任务生成。",
      dueDate: "2030-09-30",
      responsiblePersonId: people[0].id,
      customFields: { acceptanceStandard: "结果可复核并符合行动标准。" },
      productIds: [],
    };
    const beforeLaunch = new Database(databasePath, { readonly: true });
    const countsBefore = beforeLaunch.prepare("SELECT (SELECT COUNT(*) FROM work_plans) workPlans,(SELECT COUNT(*) FROM process_instances) instances,(SELECT COUNT(*) FROM tasks) tasks").get();
    beforeLaunch.close();
    assert.equal((await request(baseUrl, "/api/key-actions/launch-options", { token: launcherLogin.body.token })).status, 200);
    assert.equal((await request(baseUrl, "/api/key-actions/launch-preview", { method: "POST", token: loginA.body.token, body: launchInput })).status, 403);
    const missingRequired = await request(baseUrl, "/api/key-actions/launch-preview", { method: "POST", token: launcherLogin.body.token, body: { ...launchInput, customFields: {} } });
    assert.equal(missingRequired.status, 400);
    assert.equal(missingRequired.body.code, "key_action_required_field_missing");
    const preview = await request(baseUrl, "/api/key-actions/launch-preview", { method: "POST", token: launcherLogin.body.token, body: launchInput });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.preview.canLaunch, true);
    assert.equal(preview.body.preview.steps.length, 1);
    assert.ok(preview.body.confirmationToken);
    const afterPreview = new Database(databasePath, { readonly: true });
    assert.deepEqual(afterPreview.prepare("SELECT (SELECT COUNT(*) FROM work_plans) workPlans,(SELECT COUNT(*) FROM process_instances) instances,(SELECT COUNT(*) FROM tasks) tasks").get(), countsBefore);
    afterPreview.close();
    assert.equal((await request(baseUrl, "/api/key-actions/launch", { method: "POST", token: launcherLogin.body.token, body: launchInput })).status, 409);
    assert.equal((await request(baseUrl, "/api/key-actions/launch", { method: "POST", token: launcherLogin.body.token, body: { ...launchInput, title: "内容被修改", confirmationToken: preview.body.confirmationToken } })).status, 409);
    const launched = await request(baseUrl, "/api/key-actions/launch", { method: "POST", token: launcherLogin.body.token, body: { ...launchInput, confirmationToken: preview.body.confirmationToken } });
    assert.equal(launched.status, 201);
    assert.equal(launched.body.action.taskCount, 1);
    const duplicatePreview = await request(baseUrl, "/api/key-actions/launch-preview", { method: "POST", token: launcherLogin.body.token, body: launchInput });
    assert.equal(duplicatePreview.status, 200);
    assert.equal(duplicatePreview.body.preview.canLaunch, false);
    assert.equal(duplicatePreview.body.confirmationToken, null);
    for (const path of [
      "/api/work-plans",
      "/api/tasks",
      "/api/products",
      "/api/connections",
      "/api/finance/entries",
      "/api/data-sync-center/run",
      "/api/notifications/read-all",
      "/api/persons",
    ]) {
      const blocked = await request(baseUrl, path, { method: "POST", token: launcherLogin.body.token, body: {} });
      assert.equal(blocked.status, 403, path);
      assert.equal(blocked.body.code, "assistant_write_boundary", path);
    }

    const businessWrite = await request(baseUrl, "/api/notifications/read-all", { method: "POST", token: loginA.body.token });
    assert.equal(businessWrite.status, 403);
    const sessions = await request(baseUrl, "/api/auth/device-sessions", { token: loginB.body.token });
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions.length, 4);
    assert.equal(Object.hasOwn(sessions.body.sessions[0], "tokenHash"), false);
    const credentialAudit = new Database(databasePath, { readonly: true });
    try {
      const stored = credentialAudit.prepare("SELECT tokenHash FROM assistant_device_sessions WHERE id=?").get(loginA.body.deviceSession.id);
      assert.notEqual(stored.tokenHash, loginA.body.refreshToken);
      assert.match(stored.tokenHash, /^[0-9a-f]{64}$/u);
    } finally { credentialAudit.close(); }

    const refreshedB = await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginB.body.refreshToken },
    });
    assert.equal(refreshedB.status, 200);
    const revokeA = await request(baseUrl, `/api/auth/device-sessions/${loginA.body.deviceSession.id}`, {
      method: "DELETE",
      token: refreshedB.body.token,
    });
    assert.equal(revokeA.status, 200);
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: loginA.body.token })).status, 401);
    assert.equal((await fetch(`${baseUrl}/uploads/does-not-exist.png?access_token=${encodeURIComponent(loginA.body.assetToken)}`)).status, 401);
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 200);
    assert.equal((await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginA.body.refreshToken },
    })).status, 401);

    const writeAccountDeviceLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { username: "assistant-write-test", password: "write-password", assistantDeviceName: "Unsafe-device" },
    });
    assert.equal(writeAccountDeviceLogin.status, 403);

    const passwordChange = new Database(databasePath);
    try {
      passwordChange.prepare("UPDATE persons SET passwordHash=? WHERE id=?").run(hashPassword("new-read-password"), people[0].id);
    } finally { passwordChange.close(); }
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 200);
    assert.equal((await request(baseUrl, "/api/auth/device-sessions/refresh", {
      method: "POST",
      body: { refreshToken: loginB.body.refreshToken },
    })).status, 200);

    const direct = new Database(databasePath);
    try {
      direct.prepare("UPDATE persons SET permissions=? WHERE id=?").run(JSON.stringify(writePermissions), people[0].id);
    } finally { direct.close(); }
    assert.equal((await request(baseUrl, "/api/notifications/summary?limit=1", { token: refreshedB.body.token })).status, 403);

    const integrity = new Database(databasePath, { readonly: true });
    try {
      assert.equal(integrity.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(integrity.pragma("foreign_key_check"), []);
    } finally { integrity.close(); }
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    closeDatabase();
  }
});
