import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/tmp/phase710b-production.db";
assert.ok(fs.existsSync(source), "隔离验证源数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-anomaly-governance-"));
const target = path.join(directory, "isolated.db"); fs.copyFileSync(source, target); process.env.WUFAN_DB_PATH = target;

const { getDatabase, closeDatabase, migrateSalesDailyAnomalyGovernanceV1 } = await import("../server/db.js");
const { querySalesDataQualityAnomalies, submitSalesDataQualityAnomalyDecision } = await import("../server/salesDataQualityAnomalyGovernanceService.js");
const { querySalesDailyDataQuality } = await import("../server/salesDailyDataQualityService.js");
const database = getDatabase(); migrateSalesDailyAnomalyGovernanceV1(); migrateSalesDailyAnomalyGovernanceV1();
const digest = (table) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).digest("hex");
const before = { facts: digest("connection_sku_sales_daily_facts"), mappings: digest("sales_link_sku_erp_mappings"), structures: digest("sales_link_sku_product_structures"), erp: digest("erp_skus") };
const queue = querySalesDataQualityAnomalies({ database, page: 1, pageSize: 100 });
const quality = querySalesDailyDataQuality({ database });
assert.equal(quality.hasData, true, "缺少可用的销售日报质量批次");
const expectedByType = Object.fromEntries(["identity_error", "missing_relation", "relation_conflict", "incomplete_structure"]
  .map((type) => [type, Number(quality.coverage.categories[type].rows || 0)]));
const expectedTotal = Object.values(expectedByType).reduce((sum, value) => sum + value, 0);
assert.equal(queue.summary.total, expectedTotal, "异常队列总数必须等于最新预览的真实异常分类之和");
for (const type of ["identity_error", "missing_relation", "relation_conflict", "incomplete_structure"]) {
  assert.equal(queue.summary.byType[type].count, expectedByType[type] || 0, `${type}队列数量与预览不一致`);
}
const all = [];
for (let page = 1; page <= queue.pagination.totalPages; page += 1) all.push(...querySalesDataQualityAnomalies({ database, page, pageSize: 100 }).items);
assert.equal(all.length, expectedTotal);
assert.ok(all.filter((item) => item.anomalyType === "identity_error").every((item) => item.reason.stage));
assert.ok(all.filter((item) => item.anomalyType === "missing_relation").every((item) => ["missing_structure", "missing_component", "missing_platform_goods", "structure_not_active"].includes(item.reason.code)));
assert.ok(all.filter((item) => item.anomalyType === "relation_conflict").every((item) => Array.isArray(item.componentDiff.currentComponents)));
const reviewer = database.prepare("SELECT id FROM persons ORDER BY createdAt,id LIMIT 1").get()?.id;
assert.ok(reviewer, "隔离库缺少可用审核人");
const conflict = all.find((item) => item.anomalyType === "relation_conflict");
const first = submitSalesDataQualityAnomalyDecision(conflict.id, { action: "add", decisionNote: "隔离验证：进入正式货品结构审批。" }, { database, reviewedBy: reviewer });
assert.equal(first.status, "pending_formal_approval"); assert.equal(first.safeguards.mappingChanged, false);
const second = submitSalesDataQualityAnomalyDecision(conflict.id, { action: "add", decisionNote: "隔离验证：进入正式货品结构审批。" }, { database, reviewedBy: reviewer });
assert.equal(second.idempotent, true);
const identity = all.find((item) => item.anomalyType === "identity_error");
const ignored = submitSalesDataQualityAnomalyDecision(identity.id, { action: "ignore", decisionNote: "隔离验证：经人工核对后保留忽略快照。" }, { database, reviewedBy: reviewer });
assert.equal(ignored.status, "reviewed_ignore");
const after = { facts: digest("connection_sku_sales_daily_facts"), mappings: digest("sales_link_sku_erp_mappings"), structures: digest("sales_link_sku_product_structures"), erp: digest("erp_skus") };
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.equal(database.pragma("foreign_key_check").length, 0);
const reasonDistribution = all.reduce((result, item) => { result[item.reason.code] = (result[item.reason.code] || 0) + 1; return result; }, {});
console.log(JSON.stringify({ success: true, isolatedDatabase: target, summary: queue.summary, reasonDistribution, decisionCount: database.prepare("SELECT COUNT(*) total FROM sales_daily_anomaly_governance_decisions").get().total, protected: before, integrityCheck: "ok", foreignKeyErrors: 0 }, null, 2));
closeDatabase();
