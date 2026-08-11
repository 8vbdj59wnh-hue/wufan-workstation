import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/tmp/phase710b-production.db";
assert.ok(fs.existsSync(source), "隔离验证源数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-daily-quality-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target);
process.env.WUFAN_DB_PATH = target;

const { getDatabase, closeDatabase } = await import("../server/db.js");
const { querySalesDailyDataQuality } = await import("../server/salesDailyDataQualityService.js");
const { queryBusinessAnomalies } = await import("../server/capabilities/queryBusinessAnomalies.js");
const database = getDatabase();
const digest = (table) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).digest("hex");
const protectedBefore = {
  dailyFacts: digest("connection_sku_sales_daily_facts"),
  mappings: digest("sales_link_sku_erp_mappings"),
  structures: digest("sales_link_sku_product_structures"),
  erpSkus: digest("erp_skus"),
};

const first = querySalesDailyDataQuality({ database });
const second = querySalesDailyDataQuality({ database });
assert.deepEqual(second, first, "刷新查询结果必须稳定");
assert.equal(first.contractVersion, "1.1");
const factCount = database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total;
const factAmounts = database.prepare("SELECT SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount FROM connection_sku_sales_daily_facts").get();
assert.equal(first.batch.factCount, factCount);
assert.ok(first.coverage.categories.ready.rows >= factCount, "ready不得少于已写入事实");
assert.ok(first.coverage.categories.missing_relation.rows >= 0);
assert.ok(first.coverage.categories.relation_conflict.rows >= 0);
assert.ok(first.coverage.categories.identity_error.rows >= 0);
assert.ok(first.coverage.categories.incomplete_structure.rows >= 0);
assert.equal(Object.hasOwn(first.coverage.categories, "unknown"), false);
assert.equal(Object.hasOwn(first.governance, "erpUsagePending"), false);
assert.ok(Math.abs(first.amounts.writtenSalesAmount - Number(factAmounts.salesAmount)) < 1e-6);
assert.ok(Math.abs(first.amounts.writtenProfitAmount - Number(factAmounts.profitAmount)) < 1e-6);
assert.ok(Math.abs(first.amounts.productSourceSalesAmount - first.amounts.writtenSalesAmount - first.amounts.unwrittenSalesAmount) < 1e-6);
assert.ok(Math.abs(first.amounts.productSourceProfitAmount - first.amounts.writtenProfitAmount - first.amounts.unwrittenProfitAmount) < 1e-6);
assert.equal(first.health.reasons.includes("ERP_USAGE_PENDING"), false);
const anomalies = queryBusinessAnomalies({}, { database });
const qualityAnomaly = anomalies.items.find((item) => item.anomalyType === "data_quality_issue");
assert(qualityAnomaly, "当前真实关系和身份异常仍应产生数据质量异常。");
const expectedExceptions = ["missing_relation", "pending_relation", "relation_conflict", "incomplete_structure", "identity_error"]
  .reduce((sum, key) => sum + first.coverage.categories[key].rows, 0);
assert.equal(qualityAnomaly.currentValue, expectedExceptions);

const protectedAfter = {
  dailyFacts: digest("connection_sku_sales_daily_facts"),
  mappings: digest("sales_link_sku_erp_mappings"),
  structures: digest("sales_link_sku_product_structures"),
  erpSkus: digest("erp_skus"),
};
assert.deepEqual(protectedAfter, protectedBefore, "质量查询不得修改事实、关系、结构或ERP SKU。");
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, quality: first, dataQualityAnomaly: qualityAnomaly, protectedBefore, protectedAfter, integrityCheck: "ok", foreignKeyErrors: 0 }, null, 2));
closeDatabase();
