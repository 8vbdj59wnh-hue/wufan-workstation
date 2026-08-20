import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createEmptyPermissions } from "../shared/permissions.js";
import { createToken } from "../server/security.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api-usage-ledger-"));
const databasePath = path.join(directory, "workstation.db");
const port = 3600 + (process.pid % 200);
process.env.WUFAN_DB_PATH = databasePath;

const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase({ reset: true });
const database = databaseModule.getDatabase();
const deniedPermissions = createEmptyPermissions("self");
database.prepare(`UPDATE persons
  SET username = 'ledger-denied', canLogin = 1, authRole = 'user', permissions = @permissions
  WHERE id = 'person-005'`).run({ permissions: JSON.stringify(deniedPermissions) });
databaseModule.closeDatabase();

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, WUFAN_DB_PATH: databasePath, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const childExit = new Promise((resolve) => child.once("exit", resolve));
let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

async function request(pathname, { token = "", source = "", method = "GET" } = {}) {
  const headers = {};
  if (token !== "") headers.Authorization = `Bearer ${token}`;
  if (source !== "") headers["X-Wufan-API-Source"] = source;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers });
  const text = await response.text();
  return { response, data: text === "" ? null : JSON.parse(text) };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API 台账隔离验证服务提前退出。\n${childOutput}`);
    try {
      const health = await request("/api/health");
      if (health.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("API 台账隔离验证服务启动超时。");
}

try {
  await waitForServer();
  const adminToken = createToken({ id: "person-001", username: "admin", authRole: "admin" });
  const deniedToken = createToken({ id: "person-005", username: "ledger-denied", authRole: "user" });

  await request("/api/health", { source: "web:startup" });
  await request("/api/health", { source: "web:startup" });
  const anonymous = await request("/api/goal-center/bootstrap", { source: "web:goals" });
  assert.equal(anonymous.response.status, 401);
  const dynamic = await request("/api/products/product-does-not-exist/snapshots", {
    token: adminToken,
    source: "web:products",
  });
  assert.equal(dynamic.response.status, 200);

  const denied = await request("/api/admin/api-usage", { token: deniedToken, source: "web:admin-data-center" });
  assert.equal(denied.response.status, 403);
  const ledger = await request("/api/admin/api-usage?limit=500", {
    token: adminToken,
    source: "web:admin-data-center",
  });
  assert.equal(ledger.response.status, 200);
  assert.equal(ledger.data.success, true);

  const startup = ledger.data.items.find((item) =>
    item.method === "GET" && item.routePattern === "/api/health" && item.source === "web:startup");
  assert.equal(startup.callCount, 2);
  const unauthorized = ledger.data.items.find((item) =>
    item.routePattern === "/api/goal-center/bootstrap" && item.source === "web:goals");
  assert.equal(unauthorized.clientErrorCount, 1);
  const product = ledger.data.items.find((item) =>
    item.routePattern === "/api/products/:id/snapshots" && item.source === "web:products");
  assert.equal(product.callCount, 1);
  assert.equal(ledger.data.items.some((item) => item.routePattern.includes("product-does-not-exist")), false);
  assert.ok(ledger.data.summary.totalCalls >= 6);

  console.log(JSON.stringify({
    success: true,
    database: "isolated temporary database",
    protectedBusinessData: true,
    endpoint: "/api/admin/api-usage",
    deniedRoleStatus: denied.response.status,
    recordedSources: [...new Set(ledger.data.items.map((item) => item.source))].sort(),
    totalCalls: ledger.data.summary.totalCalls,
    dynamicRoutePattern: product.routePattern,
    startupCalls: startup.callCount,
  }, null, 2));
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await childExit;
  fs.rmSync(directory, { recursive: true, force: true });
}
