import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-center-api-"));
const databasePath = path.join(directory, "workstation.db");
const port = 3400 + (process.pid % 200);
process.env.WUFAN_DB_PATH = databasePath;
process.env.WUFAN_ENV = "test";
process.env.WUFAN_ALLOW_DB_RESET = "1";
process.env.WUFAN_TEST_DATABASE_ROOT = directory;

// Database safety variables must exist before any application module is loaded.
const { createEmptyPermissions } = await import("../shared/permissions.js");
const { createToken } = await import("../server/security.js");
const { goalCenterBootstrapResources } = await import("../server/goalCenterBootstrapService.js");
const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase({ reset: true });
const database = databaseModule.getDatabase();
const restrictedPermissions = createEmptyPermissions("department");
restrictedPermissions.modules.goals = true;
restrictedPermissions.goals.view = true;
restrictedPermissions.goals.viewRelatedData = true;
database.prepare(`UPDATE persons
  SET username = 'goal-reviewer', canLogin = 1, authRole = 'user', permissions = @permissions
  WHERE id = 'person-004'`).run({ permissions: JSON.stringify(restrictedPermissions) });
const deniedPermissions = createEmptyPermissions("self");
database.prepare(`UPDATE persons
  SET username = 'goal-denied', canLogin = 1, authRole = 'user', permissions = @permissions
  WHERE id = 'person-005'`).run({ permissions: JSON.stringify(deniedPermissions) });
databaseModule.closeDatabase();

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    WUFAN_DB_PATH: databasePath,
    PORT: String(port),
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const childExit = new Promise((resolve) => child.once("exit", resolve));
let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`目标管理隔离验证服务提前退出。\n${childOutput}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("目标管理隔离验证服务启动超时。");
}

async function readJson(pathname, token = "") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  return { response, data: text === "" ? null : JSON.parse(text), bytes: Buffer.byteLength(text) };
}

async function verifyRole(user) {
  const token = createToken(user);
  const goalCenter = await readJson("/api/goal-center/bootstrap", token);
  const legacy = await readJson("/api/data", token);
  assert.equal(goalCenter.response.status, 200);
  assert.equal(legacy.response.status, 200);
  assert.deepEqual(Object.keys(goalCenter.data), goalCenterBootstrapResources);
  goalCenterBootstrapResources.forEach((resource) => {
    assert.deepEqual(goalCenter.data[resource], legacy.data[resource], `${user.id}: ${resource}`);
  });
  assert.ok(goalCenter.bytes < legacy.bytes, `${user.id}: 目标模块响应应小于旧全局快照。`);
  return { bytes: goalCenter.bytes, legacyBytes: legacy.bytes, data: goalCenter.data };
}

try {
  await waitForServer();
  const anonymous = await readJson("/api/goal-center/bootstrap");
  assert.equal(anonymous.response.status, 401);
  const denied = await readJson(
    "/api/goal-center/bootstrap",
    createToken({ id: "person-005", username: "goal-denied", authRole: "user" }),
  );
  assert.equal(denied.response.status, 403);

  const admin = await verifyRole({ id: "person-001", username: "admin", authRole: "admin" });
  const restricted = await verifyRole({ id: "person-004", username: "goal-reviewer", authRole: "user" });
  assert.ok(restricted.data.people.length < admin.data.people.length, "部门角色的人员范围应小于管理员。");
  assert.deepEqual(restricted.data.permissionTemplates, []);
  assert.deepEqual(restricted.data.products, []);

  console.log(JSON.stringify({
    success: true,
    database: "isolated temporary database",
    endpoint: "/api/goal-center/bootstrap",
    legacyComparison: "all 24 declared resources are identical",
    anonymousStatus: anonymous.response.status,
    deniedRoleStatus: denied.response.status,
    adminBytes: admin.bytes,
    adminLegacyBytes: admin.legacyBytes,
    restrictedBytes: restricted.bytes,
    restrictedLegacyBytes: restricted.legacyBytes,
    adminPeople: admin.data.people.length,
    restrictedPeople: restricted.data.people.length,
    restrictedProducts: restricted.data.products.length,
  }, null, 2));
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await childExit;
  fs.rmSync(directory, { recursive: true, force: true });
}
