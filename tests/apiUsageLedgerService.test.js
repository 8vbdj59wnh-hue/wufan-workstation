import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  getApiUsageLedger,
  normalizeApiRoutePattern,
  normalizeApiUsageSource,
  recordApiUsage,
} from "../server/apiUsageLedgerService.js";

function createLedgerDatabase() {
  const database = new Database(":memory:");
  const schema = fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8");
  database.exec(schema);
  return database;
}

test("生产结构可增量创建 API 使用台账且不依赖业务表变更", () => {
  const database = createLedgerDatabase();
  database.prepare("INSERT INTO companies (id, name, status) VALUES ('protected-company', '受保护业务数据', 'active')").run();
  const schema = fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8");
  database.exec(schema);
  const columns = database.prepare("PRAGMA table_info(api_usage_ledger)").all().map((column) => column.name);
  assert.deepEqual(columns, [
    "method", "routePattern", "source", "callCount", "successCount", "clientErrorCount",
    "serverErrorCount", "firstAccessAt", "lastAccessAt", "lastStatusCode",
  ]);
  assert.deepEqual(database.prepare("SELECT id, name, status FROM companies WHERE id = 'protected-company'").get(), {
    id: "protected-company",
    name: "受保护业务数据",
    status: "active",
  });
  database.close();
});

test("相同方法、路由模板和来源聚合调用次数并保留最后访问时间", () => {
  const database = createLedgerDatabase();
  recordApiUsage(database, {
    method: "get", routePattern: "/api/tasks/:id", source: "web:tasks", statusCode: 200,
    accessedAt: "2026-08-20T01:00:00.000Z",
  });
  recordApiUsage(database, {
    method: "GET", routePattern: "/api/tasks/:id", source: "web:tasks", statusCode: 404,
    accessedAt: "2026-08-20T02:00:00.000Z",
  });
  recordApiUsage(database, {
    method: "GET", routePattern: "/api/tasks/:id", source: "integration:sync", statusCode: 503,
    accessedAt: "2026-08-20T03:00:00.000Z",
  });

  const tasks = getApiUsageLedger(database, { route: "/api/tasks", method: "GET" });
  assert.equal(tasks.summary.totalCalls, 3);
  assert.equal(tasks.items.length, 2);
  assert.deepEqual(tasks.items.find((item) => item.source === "web:tasks"), {
    method: "GET",
    routePattern: "/api/tasks/:id",
    source: "web:tasks",
    callCount: 2,
    successCount: 1,
    clientErrorCount: 1,
    serverErrorCount: 0,
    firstAccessAt: "2026-08-20T01:00:00.000Z",
    lastAccessAt: "2026-08-20T02:00:00.000Z",
    lastStatusCode: 404,
  });
  assert.equal(getApiUsageLedger(database, { source: "integration:sync" }).summary.serverErrorCalls, 1);
  database.close();
});

test("来源与兜底路径会限长、清洗并消除动态业务 ID", () => {
  assert.equal(normalizeApiUsageSource(" Web:产品中心 / Detail "), "web:detail");
  assert.equal(normalizeApiRoutePattern("/api/tasks/task-20260820-001?full=true"), "/api/tasks/:id");
  assert.equal(normalizeApiRoutePattern("/api/products/12345/snapshots"), "/api/products/:id/snapshots");
});
