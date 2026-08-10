import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-phase4-2e7AZQ/isolated.db";
assert.ok(fs.existsSync(source), "Phase 4隔离数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-daily-sales-phase5-2-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target);
process.env.WUFAN_DB_PATH = target;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { getConnectionDailySalesPerformance } = await import("../server/connectionDailySalesService.js");
initializeDatabase();
const database = getDatabase();
const digest = (sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const protectedBefore = {
  facts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"),
  factCount: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"),
};
assert.equal(protectedBefore.factCount, 171);
const range = database.prepare("SELECT MIN(saleDate) startDate,MAX(saleDate) endDate FROM connection_sku_sales_daily_facts").get();
const withData = database.prepare(`SELECT c.id,c.salesLinkId FROM connection_profiles c
  WHERE EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.salesLinkId=c.salesLinkId)
  ORDER BY c.id LIMIT 1`).get();
const withoutData = database.prepare(`SELECT c.id,c.salesLinkId FROM connection_profiles c
  WHERE NOT EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.salesLinkId=c.salesLinkId)
  ORDER BY c.id LIMIT 1`).get();
assert.ok(withData && withoutData);

let queryCount = 0;
const countedDatabase = new Proxy(database, {
  get(targetDatabase, property) {
    if (property === "prepare") return (...args) => { queryCount += 1; return targetDatabase.prepare(...args); };
    const current = targetDatabase[property];
    return typeof current === "function" ? current.bind(targetDatabase) : current;
  },
});
const actual = getConnectionDailySalesPerformance({ connectionId: withData.id, ...range }, { database: countedDatabase });
const repeated = getConnectionDailySalesPerformance({ connectionId: withData.id, ...range }, { database });
assert.deepEqual(repeated, actual, "重复刷新结果必须稳定");
assert.equal(actual.summary.source, "daily_fact_v1");
const direct = database.prepare(`SELECT COUNT(*) dataCount,SUM(quantity) quantity,SUM(salesAmount) salesAmount,
  SUM(costAmount) costAmount,SUM(profitAmount) profitAmount FROM connection_sku_sales_daily_facts
  WHERE salesLinkId=? AND saleDate BETWEEN ? AND ?`).get(withData.salesLinkId, range.startDate, range.endDate);
for (const field of ["dataCount", "quantity", "salesAmount", "costAmount", "profitAmount"]) {
  assert.ok(Math.abs(Number(actual.summary[field]) - Number(direct[field])) < 1e-8, `${field}与Capability结果不一致`);
}
assert.ok(Math.abs(actual.bySku.items.reduce((sum, item) => sum + item.salesAmount, 0) - actual.summary.salesAmount) < 1e-8);
assert.ok(Math.abs(actual.bySku.items.reduce((sum, item) => sum + item.profitAmount, 0) - actual.summary.profitAmount) < 1e-8);
assert.ok(actual.bySku.items.every((item) => item.relation && Array.isArray(item.relation.erpSkus)), "SKU组成必须来自Resolver结构");
assert.equal(actual.trend.items.length, 32);
assert.ok(actual.trend.items.every((item) => item.noData ? item.salesAmount === null && item.profitAmount === null : true));
assert.ok(queryCount <= 15, `详情查询SQL数量异常：${queryCount}`);

const empty = getConnectionDailySalesPerformance({ connectionId: withoutData.id, ...range }, { database });
assert.equal(empty.summary.hasData, false);
assert.equal(empty.summary.salesAmount, null);
assert.equal(empty.summary.profitMargin, null);
assert.equal(empty.bySku.items.length, 0);
assert.ok(empty.trend.items.every((item) => item.noData && item.salesAmount === null));

const serviceSource = fs.readFileSync(new URL("../server/connectionDailySalesService.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../src/connectionCenterPage.js", import.meta.url), "utf8");
assert.equal(serviceSource.includes("connection_sku_sales_daily_facts"), false, "展示服务不能直接查询日报事实");
assert.equal(serviceSource.includes("connection_sku_sales_facts"), false, "展示服务不能读取旧周期事实");
assert.equal(pageSource.includes("connection_sku_sales_daily_facts"), false, "页面不能直接读取日报事实");

const protectedAfter = {
  facts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"),
  factCount: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"),
};
assert.deepEqual(protectedAfter, protectedBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({
  success: true,
  isolatedDatabase: target,
  range,
  withData: { connectionId: withData.id, salesLinkId: withData.salesLinkId, summary: actual.summary, skuCount: actual.bySku.items.length, trendDays: actual.trend.items.length },
  withoutData: { connectionId: withoutData.id, hasData: empty.summary.hasData, salesAmount: empty.summary.salesAmount },
  queryCount,
  protectedBefore,
  protectedAfter,
  integrity: "ok",
  foreignKeyErrors: 0,
}, null, 2));
closeDatabase();
