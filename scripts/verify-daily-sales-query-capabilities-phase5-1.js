import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-phase4-2e7AZQ/isolated.db";
assert.ok(fs.existsSync(source), "Phase 4隔离数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daily-sales-query-phase5-1-")); const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target); process.env.WUFAN_DB_PATH = target;
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { queryDailySalesSummary, queryDailySalesTrend, queryDailySalesBySku, explainDailySalesQuery } = await import("../server/capabilities/queryDailySales.js");
initializeDatabase(); const database = getDatabase();
const digest = (sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const protectedBefore = {
  dailyFacts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"), dailyFactCount: database.prepare("SELECT COUNT(*) n FROM connection_sku_sales_daily_facts").get().n,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"), combo: digest("SELECT * FROM sales_link_sku_combo_groups ORDER BY id"),
};
assert.equal(protectedBefore.dailyFactCount, 171, "应使用Phase 4写入的171条事实");
const range = database.prepare("SELECT MIN(saleDate) startDate,MAX(saleDate) endDate FROM connection_sku_sales_daily_facts").get();
const link = database.prepare("SELECT salesLinkId,COUNT(*) count FROM connection_sku_sales_daily_facts GROUP BY salesLinkId ORDER BY count DESC,salesLinkId LIMIT 1").get();
const erpSku = database.prepare("SELECT erpSkuId,COUNT(*) count FROM connection_sku_sales_daily_facts GROUP BY erpSkuId ORDER BY count DESC,erpSkuId LIMIT 1").get();
const platformSku = database.prepare("SELECT salesLinkSkuId FROM connection_sku_sales_daily_facts ORDER BY id LIMIT 1").get();
const product = database.prepare(`SELECT pem.productId,COUNT(*) count FROM connection_sku_sales_daily_facts f
  JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active'
  GROUP BY pem.productId ORDER BY count DESC,pem.productId LIMIT 1`).get();
assert.ok(link && erpSku && platformSku && product);

function directSummary(predicate, params = [], joins = "") {
  return database.prepare(`SELECT COUNT(*) dataCount,SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f ${joins} WHERE ${predicate} AND f.saleDate BETWEEN ? AND ?`).get(...params, range.startDate, range.endDate);
}
function compareMetrics(actual, expected) {
  assert.equal(actual.dataCount, expected.dataCount);
  for (const field of ["quantity", "salesAmount", "costAmount", "profitAmount"]) assert.ok(Math.abs(Number(actual[field]) - Number(expected[field])) < 1e-8, `${field}聚合不一致`);
}

const linkSummary = queryDailySalesSummary({ dimension: "salesLink", targetId: link.salesLinkId, ...range }, { database });
compareMetrics(linkSummary, directSummary("f.salesLinkId=?", [link.salesLinkId])); assert.equal(linkSummary.dataSource, "daily_fact_v1"); assert.equal(linkSummary.hasData, true);
const erpSummary = queryDailySalesSummary({ dimension: "erpSku", targetId: erpSku.erpSkuId, ...range }, { database });
compareMetrics(erpSummary, directSummary("f.erpSkuId=?", [erpSku.erpSkuId]));
const skuSummary = queryDailySalesSummary({ dimension: "salesLinkSku", targetId: platformSku.salesLinkSkuId, ...range }, { database });
compareMetrics(skuSummary, directSummary("f.salesLinkSkuId=?", [platformSku.salesLinkSkuId]));
const productSummary = queryDailySalesSummary({ dimension: "product", targetId: product.productId, ...range }, { database });
compareMetrics(productSummary, directSummary("pem.productId=?", [product.productId], "JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active'"));

const trend = queryDailySalesTrend({ dimension: "salesLink", targetId: link.salesLinkId, ...range }, { database });
const expectedDays = Math.round((new Date(`${range.endDate}T00:00:00Z`) - new Date(`${range.startDate}T00:00:00Z`)) / 86400000) + 1;
assert.equal(trend.items.length, expectedDays); assert.equal(trend.hasData, true);
assert.ok(trend.items.every((item) => item.noData ? item.quantity === null && item.salesAmount === null : item.dataCount > 0), "无数据日期必须返回null而不是0");
const trendTotal = trend.items.filter((item) => !item.noData).reduce((sum, item) => sum + item.salesAmount, 0);
assert.ok(Math.abs(trendTotal - linkSummary.salesAmount) < 1e-8);
assert.deepEqual(queryDailySalesTrend({ dimension: "salesLink", targetId: link.salesLinkId, ...range }, { database }), trend, "重复查询必须稳定");

const bySku = queryDailySalesBySku({ salesLinkId: link.salesLinkId, ...range }, { database });
assert.ok(bySku.items.length > 0); assert.equal(bySku.source, "daily_fact_v1");
const bySkuSales = bySku.items.reduce((sum, item) => sum + item.salesAmount, 0); assert.ok(Math.abs(bySkuSales - linkSummary.salesAmount) < 1e-8);
assert.ok(bySku.items.every((item) => Array.isArray(item.erpSkuIds) && item.erpSkuIds.length > 0));

const noData = queryDailySalesSummary({ dimension: "erpSku", targetId: "missing-erp-sku", ...range }, { database });
assert.equal(noData.hasData, false); assert.equal(noData.quantity, null); assert.equal(noData.salesAmount, null); assert.equal(noData.dataCount, 0);
const noDataTrend = queryDailySalesTrend({ dimension: "erpSku", targetId: "missing-erp-sku", ...range }, { database });
assert.equal(noDataTrend.hasData, false); assert.ok(noDataTrend.items.every((item) => item.noData && item.salesAmount === null));

const plans = {
  salesLink: explainDailySalesQuery({ dimension: "salesLink", targetId: link.salesLinkId, ...range }, { database }),
  erpSku: explainDailySalesQuery({ dimension: "erpSku", targetId: erpSku.erpSkuId, ...range }, { database }),
  product: explainDailySalesQuery({ dimension: "product", targetId: product.productId, ...range }, { database }),
};
for (const [name, plan] of Object.entries(plans)) assert.ok(plan.some((row) => /SEARCH .*INDEX/i.test(row.detail)), `${name}查询没有使用索引`);
const sourceCode = fs.readFileSync(new URL("../server/capabilities/queryDailySales.js", import.meta.url), "utf8");
assert.equal(sourceCode.includes("connection_sku_sales_facts"), false, "查询能力禁止读取旧周期事实");

const protectedAfter = {
  dailyFacts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"), dailyFactCount: database.prepare("SELECT COUNT(*) n FROM connection_sku_sales_daily_facts").get().n,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"), combo: digest("SELECT * FROM sales_link_sku_combo_groups ORDER BY id"),
};
assert.deepEqual(protectedAfter, protectedBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, isolatedDatabase: target, facts: protectedBefore.dailyFactCount, range, targets: { salesLinkId: link.salesLinkId, salesLinkSkuId: platformSku.salesLinkSkuId, erpSkuId: erpSku.erpSkuId, productId: product.productId }, summaries: { link: linkSummary, erpSku: erpSummary, salesLinkSku: skuSummary, product: productSummary }, trend: { days: trend.items.length, dataDays: trend.coverage.dataDays, noDataDays: trend.items.filter((item) => item.noData).length }, bySku: { groups: bySku.items.length, salesAmount: bySkuSales }, noData: { hasData: noData.hasData, salesAmount: noData.salesAmount }, plans: Object.fromEntries(Object.entries(plans).map(([key, value]) => [key, value.map((row) => row.detail)])), protectedBefore, protectedAfter, integrity: "ok", foreignKeyErrors: 0 }, null, 2));
closeDatabase();
