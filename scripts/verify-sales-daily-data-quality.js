import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/tmp/phase6-3-production.db";
assert.ok(fs.existsSync(source), "隔离验证源数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-daily-quality-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target);
process.env.WUFAN_DB_PATH = target;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { confirmErpSkuBusinessUsage } = await import("../server/capabilities/resolveErpSkuBusinessUsage.js");
const { queryErpSkuUsageCandidates } = await import("../server/capabilities/queryErpSkuUsageCandidates.js");
const { commitSalesDailyFacts } = await import("../server/salesDailyFactPreviewService.js");
const { querySalesDailyDataQuality } = await import("../server/salesDailyDataQualityService.js");
initializeDatabase();
const database = getDatabase();
const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
const batch = database.prepare("SELECT id FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC LIMIT 1").get();
assert.ok(reviewer?.id && batch?.id);
for (const [code, usageType] of [["0016", "accounting_auxiliary"], ["0013", "shipping_adjustment"]]) {
  const sku = database.prepare("SELECT id FROM erp_skus WHERE merchantSkuCode=?").get(code);
  confirmErpSkuBusinessUsage({ erpSkuId: sku.id, usageType, reviewedBy: reviewer.id, decisionNote: "Phase 7-1A隔离质量看板验证。" }, { database });
}
const p0 = queryErpSkuUsageCandidates({ status: "unconfirmed", priority: "P0", page: 1, pageSize: 100 }, { database });
assert.equal(p0.items.length, 84);
for (const item of p0.items) confirmErpSkuBusinessUsage({ erpSkuId: item.erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: "Phase 7-1A隔离P0商品用途验证。" }, { database });
const protectedBefore = {
  mappings: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count,
  erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
  comboGroups: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_combo_groups").get().count,
};
const committed = commitSalesDailyFacts(batch.id, { confirmedBy: reviewer.id, database });
assert.equal(committed.result.insertedCount, 3668);
const queryProtectedBefore = {
  dailyFacts: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count,
  usages: database.prepare("SELECT COUNT(*) count FROM erp_sku_business_usages").get().count,
  erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
  comboGroups: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_combo_groups").get().count,
};
const first = querySalesDailyDataQuality({ database });
const second = querySalesDailyDataQuality({ database });
assert.deepEqual(second, first, "刷新查询结果必须稳定");
assert.equal(first.hasData, true);
assert.equal(first.batch.factCount, 3668);
assert.equal(first.coverage.categories.ready.rows, 3668);
assert.equal(first.coverage.categories.unknown.rows, 7102);
assert.equal(first.coverage.categories.missing_relation.rows, 955);
assert.equal(first.coverage.categories.relation_conflict.rows, 2);
assert.equal(first.coverage.categories.excluded.rows, 1);
assert.equal(first.coverage.categories.accounting_auxiliary.rows, 57);
assert.equal(first.coverage.categories.shipping_adjustment.rows, 41);
assert.ok(Math.abs(first.amounts.writtenSalesAmount - 545759.5875) < 1e-6);
assert.ok(Math.abs(first.amounts.writtenProfitAmount - 253388.5508) < 1e-6);
assert.equal(first.health.status, "error");
const queryProtectedAfter = {
  dailyFacts: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_daily_facts").get().count,
  mappings: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count,
  usages: database.prepare("SELECT COUNT(*) count FROM erp_sku_business_usages").get().count,
  erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
  comboGroups: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_combo_groups").get().count,
};
assert.deepEqual(queryProtectedAfter, queryProtectedBefore, "质量看板查询不得修改事实、关系、用途或主数据");
const protectedAfter = {
  mappings: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count,
  erpSkus: database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count,
  comboGroups: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_combo_groups").get().count,
};
assert.deepEqual(protectedAfter, protectedBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, isolatedDatabase: target, quality: first, protectedBefore, protectedAfter, queryProtectedBefore, queryProtectedAfter }, null, 2));
closeDatabase();
