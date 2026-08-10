import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/tmp/phase31-analysis.ba5sY0/isolated.db";
assert.ok(fs.existsSync(source), "隔离验证源数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "erp-product-usage-candidates-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target);
process.env.WUFAN_DB_PATH = target;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { queryErpSkuProductUsageCandidates, confirmErpSkuProductUsages, confirmErpSkuUsageGovernance } = await import("../server/erpSkuUsageGovernanceService.js");
initializeDatabase();
const database = getDatabase();
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedBefore = {
  mappings: count("sales_link_sku_erp_mappings"), comboGroups: count("sales_link_sku_combo_groups"),
  dailyFacts: count("connection_sku_sales_daily_facts"), erpSkus: count("erp_skus"),
};
const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
assert.ok(reviewer?.id, "缺少审核人");

const candidates = queryErpSkuProductUsageCandidates({ status: "unconfirmed", pageSize: 100 }, { database });
assert.equal(candidates.capability, "QueryErpSkuUsageCandidates");
assert.ok(candidates.pagination.total > 0, "应返回Ready商品用途候选");
assert.ok(candidates.items.every((item) => item.suggestedUsage === "product" && item.reasonCodes.includes("READY_PREVIEW_EVIDENCE")));
assert.ok(candidates.items.every((item) => item.impact.salesRowCount > 0));
const selected = candidates.items.slice(0, 2).map((item) => item.erpSkuId);
const previousUsage = confirmErpSkuUsageGovernance(selected[0], { usageType: "other_adjustment", decisionNote: "Phase 6-3隔离用途替换准备。" }, { database, reviewedBy: reviewer.id });
const batch = confirmErpSkuProductUsages({ erpSkuIds: [...selected, "missing-erp-sku"], decisionNote: "Phase 6-3隔离批量人工确认验证。" }, { database, reviewedBy: reviewer.id });
assert.equal(batch.successCount, 2);
assert.equal(batch.failedCount, 1);
assert.ok(selected.every((id) => database.prepare("SELECT 1 FROM erp_sku_business_usages WHERE erpSkuId=? AND usageType='product' AND status='active'").get(id)));
assert.equal(database.prepare("SELECT status FROM erp_sku_business_usages WHERE id=?").get(previousUsage.usage.id).status, "superseded");
const repeated = confirmErpSkuProductUsages({ erpSkuIds: selected, decisionNote: "Phase 6-3重复确认验证。" }, { database, reviewedBy: reviewer.id });
assert.ok(repeated.results.every((item) => item.success && item.idempotent));

const protectedAfter = {
  mappings: count("sales_link_sku_erp_mappings"), comboGroups: count("sales_link_sku_combo_groups"),
  dailyFacts: count("connection_sku_sales_daily_facts"), erpSkus: count("erp_skus"),
};
assert.deepEqual(protectedAfter, protectedBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, isolatedDatabase: target, summary: candidates.summary, total: candidates.pagination.total, batch, repeated, protectedBefore, protectedAfter }, null, 2));
closeDatabase();
