import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { resolveConnectionCockpitDateWindow } from "../server/connectionCockpitDateRange.js";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE connection_import_batches(id TEXT PRIMARY KEY,sourceType TEXT,status TEXT,periodEnd TEXT,completedAt TEXT,updatedAt TEXT,createdAt TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,sourceBatchId TEXT,saleDate TEXT);
    INSERT INTO connection_import_batches VALUES('batch-a','erp_sales_daily_preview','completed','2026-08-20','2026-08-20T01:00:00Z','2026-08-20T01:00:00Z','2026-08-20T01:00:00Z');
  `);
  const insert = database.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES(?,?,?)");
  for (let offset = 0; offset < 120; offset += 1) {
    const date = new Date("2026-08-20T00:00:00Z"); date.setUTCDate(date.getUTCDate() - offset);
    insert.run(`fact-${offset}`, "batch-a", date.toISOString().slice(0, 10));
  }
  return database;
}

test("驾驶舱7天、30天、90天均锚定同一最新完整销售日期", () => {
  const database = fixture();
  assert.deepEqual(resolveConnectionCockpitDateWindow(database, { preset: "7d" }), {
    preset: "7d", periodStart: "2026-08-14", periodEnd: "2026-08-20", previousStart: "2026-08-07", previousEnd: "2026-08-13",
    windowDays: 7, currentDateCount: 7, previousDateCount: 7, currentPeriodComplete: true, previousPeriodComplete: true,
  });
  assert.equal(resolveConnectionCockpitDateWindow(database, { preset: "30d" }).periodStart, "2026-07-22");
  assert.equal(resolveConnectionCockpitDateWindow(database, { preset: "90d" }).periodStart, "2026-05-23");
  database.close();
});

test("手动日期使用前一个相同长度周期", () => {
  const database = fixture();
  const range = resolveConnectionCockpitDateWindow(database, { preset: "custom", startDate: "2026-08-01", endDate: "2026-08-20" });
  assert.deepEqual({ startDate: range.periodStart, endDate: range.periodEnd, previousStart: range.previousStart, previousEnd: range.previousEnd, windowDays: range.windowDays }, {
    startDate: "2026-08-01", endDate: "2026-08-20", previousStart: "2026-07-12", previousEnd: "2026-07-31", windowDays: 20,
  });
  database.close();
});
