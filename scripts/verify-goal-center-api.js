import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-center-api-"));
const databasePath = path.join(directory, "workstation.db");
process.env.WUFAN_DB_PATH = databasePath;
process.env.WUFAN_ENV = "test";
process.env.WUFAN_ALLOW_DB_RESET = "1";
process.env.WUFAN_TEST_DATABASE_ROOT = directory;

const { closeDatabase, initializeDatabase, readAllData, readResource } = await import("../server/db.js");
const {
  goalCenterBootstrapResources,
  goalCenterInitialResources,
  pickGoalCenterBootstrapResources,
  readGoalCenterBootstrap,
} = await import("../server/goalCenterBootstrapService.js");

try {
  initializeDatabase({ reset: true });
  const bootstrap = pickGoalCenterBootstrapResources(readGoalCenterBootstrap(readResource));
  const legacy = readAllData({ exclude: ["salesLinks", "salesLinkSkus"] });
  assert.deepEqual(Object.keys(bootstrap), goalCenterBootstrapResources);
  for (const resource of goalCenterInitialResources) {
    assert.deepEqual(bootstrap[resource], legacy[resource], `${resource}初始定义必须与正式资源一致`);
  }
  for (const resource of ["tasks", "processInstances", "workPlans", "products", "actionProducts", "productErpMappings"]) {
    assert.deepEqual(bootstrap[resource], [], `${resource}必须由当前目标详情按需读取`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(bootstrap));
  const legacyBytes = Buffer.byteLength(JSON.stringify(legacy));
  assert.ok(bytes < 1_000_000, `目标中心首屏必须小于1MB，实际${bytes}B`);
  assert.ok(bytes < legacyBytes, "目标中心首屏必须小于全局快照");

  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(serverSource, /app\.get\("\/api\/goal-center\/bootstrap",\s*requirePermission\("goals\.view"\)/u);
  assert.match(serverSource, /app\.get\("\/api\/goal-center\/goals\/:id\/detail",\s*requirePermission\("goals\.view"\)/u);

  console.log(JSON.stringify({
    success: true,
    database: "isolated temporary database",
    verification: "service contract without loopback-network dependency",
    endpoint: "/api/goal-center/bootstrap",
    detailEndpoint: "/api/goal-center/goals/:id/detail",
    initialBytes: bytes,
    legacyBytes,
    declaredResources: goalCenterBootstrapResources.length,
    initialResources: goalCenterInitialResources.length,
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
}
