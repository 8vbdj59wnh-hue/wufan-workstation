import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-phase4-2e7AZQ/isolated.db";
assert.ok(fs.existsSync(source));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-daily-sales-phase5-3-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target); process.env.WUFAN_DB_PATH = target;
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { getProductDailySalesPerformance } = await import("../server/productDailySalesService.js");
const { queryDailySalesSummary } = await import("../server/capabilities/queryDailySales.js");
initializeDatabase(); const database = getDatabase();
const digest = (sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const before = {
  facts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"),
  factCount: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  productMappings: digest("SELECT * FROM product_erp_mappings ORDER BY id"),
};
assert.equal(before.factCount, 171);
const range = database.prepare("SELECT MIN(saleDate) startDate,MAX(saleDate) endDate FROM connection_sku_sales_daily_facts").get();
const product = database.prepare(`SELECT pem.productId,COUNT(*) count FROM connection_sku_sales_daily_facts f
  JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active'
  GROUP BY pem.productId ORDER BY count DESC,pem.productId LIMIT 1`).get();
const emptyProduct = database.prepare(`SELECT p.id productId FROM products p WHERE NOT EXISTS (
  SELECT 1 FROM product_erp_mappings pem JOIN connection_sku_sales_daily_facts f ON f.erpSkuId=pem.erpSkuId
  WHERE pem.productId=p.id AND pem.currentState='active') ORDER BY p.id LIMIT 1`).get();
assert.ok(product && emptyProduct);
let queryCount = 0;
const counted = new Proxy(database, { get(targetDatabase, property) { if (property === "prepare") return (...args) => { queryCount += 1; return targetDatabase.prepare(...args); }; const current = targetDatabase[property]; return typeof current === "function" ? current.bind(targetDatabase) : current; } });
const actual = getProductDailySalesPerformance({ productId: product.productId, ...range }, { database: counted });
const repeated = getProductDailySalesPerformance({ productId: product.productId, ...range }, { database });
assert.deepEqual(repeated, actual);
const direct = database.prepare(`SELECT COUNT(*) dataCount,SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount
  FROM connection_sku_sales_daily_facts f JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active'
  WHERE pem.productId=? AND f.saleDate BETWEEN ? AND ?`).get(product.productId, range.startDate, range.endDate);
for (const field of ["dataCount", "quantity", "salesAmount", "costAmount", "profitAmount"]) assert.ok(Math.abs(Number(actual.summary[field]) - Number(direct[field])) < 1e-8, `${field}不一致`);
assert.ok(Math.abs(actual.contributions.reduce((sum, item) => sum + item.salesAmount, 0) - actual.summary.salesAmount) < 1e-8);
assert.ok(Math.abs(actual.contributions.reduce((sum, item) => sum + item.profitAmount, 0) - actual.summary.profitAmount) < 1e-8);
assert.equal(actual.trend.items.length, 32);
assert.ok(actual.trend.items.every((item) => item.noData ? item.salesAmount === null && item.quantity === null : true));
assert.ok(queryCount <= 6, `产品详情出现异常查询数量：${queryCount}`);

const empty = getProductDailySalesPerformance({ productId: emptyProduct.productId, ...range }, { database });
assert.equal(empty.summary.hasData, false); assert.equal(empty.summary.salesAmount, null); assert.equal(empty.contributions.length, 0);

const unmapped = database.prepare(`SELECT f.erpSkuId,COUNT(*) count FROM connection_sku_sales_daily_facts f
  WHERE NOT EXISTS (SELECT 1 FROM product_erp_mappings pem WHERE pem.erpSkuId=f.erpSkuId AND pem.currentState='active')
  GROUP BY f.erpSkuId ORDER BY count DESC LIMIT 1`).get();
let unmappedCheck = { available: false };
if (unmapped) {
  const summary = queryDailySalesSummary({ dimension: "erpSku", targetId: unmapped.erpSkuId, ...range }, { database });
  assert.equal(summary.hasData, true);
  unmappedCheck = { available: true, erpSkuId: unmapped.erpSkuId, dataCount: summary.dataCount, salesAmount: summary.salesAmount };
}

const serviceSource = fs.readFileSync(new URL("../server/productDailySalesService.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../src/productCenterPage.js", import.meta.url), "utf8");
assert.equal(serviceSource.includes("connection_sku_sales_daily_facts"), false);
assert.equal(serviceSource.includes("connection_sku_sales_facts"), false);
assert.equal(pageSource.includes("connection_sku_sales_daily_facts"), false);
const after = {
  facts: digest("SELECT * FROM connection_sku_sales_daily_facts ORDER BY id"),
  factCount: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  erpSkus: digest("SELECT * FROM erp_skus ORDER BY id"),
  productMappings: digest("SELECT * FROM product_erp_mappings ORDER BY id"),
};
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, isolatedDatabase: target, productId: product.productId, range, summary: actual.summary, trendDays: actual.trend.items.length, contributionCount: actual.contributions.length, contributionSales: actual.contributions.reduce((sum, item) => sum + item.salesAmount, 0), emptyProductId: emptyProduct.productId, queryCount, unmappedCheck, before, after, integrity: "ok", foreignKeyErrors: 0 }, null, 2));
closeDatabase();
