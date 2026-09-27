import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createSystemMonitor } from "../server/systemMonitorService.js";

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-system-monitor-"));
  const businessPath = path.join(directory, "business.db");
  const business = new Database(businessPath);
  business.exec(`
    CREATE TABLE data_sync_batches (id TEXT PRIMARY KEY,status TEXT,completedAt TEXT,startedAt TEXT,createdAt TEXT);
    CREATE TABLE data_sync_exceptions (id TEXT PRIMARY KEY,status TEXT);
  `);
  business.prepare("INSERT INTO data_sync_batches VALUES (?,?,?,?,?)").run("batch-1", "succeeded", "2026-09-27T01:00:00.000Z", null, "2026-09-27T00:59:00.000Z");
  business.prepare("INSERT INTO data_sync_exceptions VALUES (?,?)").run("exception-1", "open");
  let current = new Date("2026-09-27T02:00:00.000Z");
  const monitor = createSystemMonitor({
    monitoringPath: path.join(directory, "monitoring.db"),
    databasePath: businessPath,
    getBusinessDatabase: () => business,
    applicationVersion: "test",
    databaseHealth: { technicalHealth: { status: "ok" } },
    now: () => current,
    autoStart: false,
  });
  return { directory, business, monitor, advance(milliseconds) { current = new Date(current.getTime() + milliseconds); } };
}

test("system monitor stores resource history outside the business database", (context) => {
  const fixture = createFixture();
  context.after(() => {
    fixture.monitor.close();
    fixture.business.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.monitor.collect();
  fixture.advance(15_000);
  fixture.monitor.collect();
  const overview = fixture.monitor.readOverview({ hours: 1 });
  assert.equal(overview.trends.length, 2);
  assert.equal(overview.database.status, "ok");
  assert.equal(overview.database.pathHidden, true);
  assert.equal(overview.data.latestSync.status, "succeeded");
  assert.equal(overview.data.openExceptions, 1);
  assert.ok(fs.existsSync(path.join(fixture.directory, "monitoring.db")));
  assert.equal(fixture.business.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'system_monitor_%'").all().length, 0);
});

test("system monitor aggregates API latency and excludes its own endpoint", (context) => {
  const fixture = createFixture();
  context.after(() => {
    fixture.monitor.close();
    fixture.business.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.monitor.recordApiRequest({ method: "GET", path: "/products" }, { statusCode: 200 }, 120);
  fixture.monitor.recordApiRequest({ method: "GET", path: "/products" }, { statusCode: 503 }, 240);
  fixture.monitor.recordApiRequest({ method: "GET", path: "/system-monitor/overview" }, { statusCode: 200 }, 10);
  fixture.monitor.collect();
  const overview = fixture.monitor.readOverview({ hours: 1 });
  assert.equal(overview.api.requestCount, 2);
  assert.equal(overview.api.errorCount, 1);
  assert.equal(overview.api.p50Ms, 120);
  assert.equal(overview.api.p95Ms, 240);
  assert.equal(overview.api.slowRoutes[0].route, "GET /products");
});

test("system monitor overview never exposes the database path", (context) => {
  const fixture = createFixture();
  context.after(() => {
    fixture.monitor.close();
    fixture.business.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.monitor.collect();
  const serialized = JSON.stringify(fixture.monitor.readOverview({ hours: 24 }));
  assert.equal(serialized.includes(fixture.directory), false);
  assert.equal(serialized.includes("business.db"), false);
});

test("system monitor route is protected by the administrator guard", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/api\/system-monitor\/overview", requireSystemAdministrator,/u);
});
