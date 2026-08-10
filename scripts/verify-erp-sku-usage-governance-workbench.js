import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-relation-resolver-migration-lQmbDv/isolated.db";
assert.ok(fs.existsSync(source), "隔离验证源数据库不存在");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "erp-usage-governance-workbench-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(source, target);
process.env.WUFAN_DB_PATH = target;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { queryErpSkuUsageGovernance, readErpSkuUsageGovernance, confirmErpSkuUsageGovernance } = await import("../server/erpSkuUsageGovernanceService.js");
initializeDatabase();
const database = getDatabase();
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedBefore = {
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  dailyFacts: count("connection_sku_sales_daily_facts"),
  periodFacts: count("connection_sku_sales_facts"),
  erpSkus: count("erp_skus"),
};

const reviewer = database.prepare("SELECT id,name FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
assert.ok(reviewer?.id, "缺少可用审核人");
const first = queryErpSkuUsageGovernance({ status: "unconfirmed", page: 1, pageSize: 100 }, { database });
assert.ok(first.items.length > 1, "应返回待确认ERP SKU治理对象");
assert.ok(first.summary.pendingCount > 0, "应返回待确认统计");
assert.equal(first.summary.pendingCount, 376, "只有精确匹配到erp_skus.id的对象可进入用途治理");
assert.equal(first.summary.identityIssueCount, 1, "无法落到ERP SKU身份的编码应单独保留为身份问题");
assert.ok(first.items.every((item) => item.impact && item.erpSkuId), "列表必须按ERP SKU聚合影响数据");
const searchable = first.items[0];
const searched = queryErpSkuUsageGovernance({ keyword: searchable.merchantSkuCode, page: 1 }, { database });
assert.ok(searched.items.some((item) => item.erpSkuId === searchable.erpSkuId), "编码搜索应命中ERP SKU");
const detailed = readErpSkuUsageGovernance(searchable.erpSkuId, { page: 1, pageSize: 5 }, { database });
assert.equal(detailed.item.erpSkuId, searchable.erpSkuId);
assert.ok(detailed.salesRows.length <= 5, "销售证据必须分页");

const auxiliary = confirmErpSkuUsageGovernance(searchable.erpSkuId, { usageType: "accounting_auxiliary", decisionNote: "Phase 3-2G隔离验证辅助核算用途。" }, { database, reviewedBy: reviewer.id });
assert.equal(auxiliary.usage.status, "active");
assert.equal(auxiliary.usage.sourceType, "manual_confirmation");
const repeated = confirmErpSkuUsageGovernance(searchable.erpSkuId, { usageType: "accounting_auxiliary", decisionNote: "重复确认验证。" }, { database, reviewedBy: reviewer.id });
assert.equal(repeated.idempotent, true, "重复确认同用途必须幂等");
const replacement = confirmErpSkuUsageGovernance(searchable.erpSkuId, { usageType: "shipping_adjustment", decisionNote: "Phase 3-2G隔离验证用途替换。" }, { database, reviewedBy: reviewer.id });
assert.equal(replacement.usage.status, "active");
assert.equal(database.prepare("SELECT status FROM erp_sku_business_usages WHERE id=?").get(auxiliary.usage.id).status, "superseded");

const productTarget = first.items.find((item) => item.erpSkuId !== searchable.erpSkuId);
const product = confirmErpSkuUsageGovernance(productTarget.erpSkuId, { usageType: "product", decisionNote: "Phase 3-2G隔离验证商品用途。" }, { database, reviewedBy: reviewer.id });
assert.equal(product.usage.usageType, "product");
assert.throws(() => confirmErpSkuUsageGovernance(productTarget.erpSkuId, { usageType: "invalid", decisionNote: "非法用途" }, { database, reviewedBy: reviewer.id }), /无效/);
assert.throws(() => confirmErpSkuUsageGovernance(productTarget.erpSkuId, { usageType: "product", decisionNote: "" }, { database, reviewedBy: reviewer.id }), /说明/);
assert.throws(() => confirmErpSkuUsageGovernance(productTarget.erpSkuId, { usageType: "product", decisionNote: "审核人校验" }, { database, reviewedBy: "missing-person" }), /审核人不存在/);

const protectedAfter = {
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  dailyFacts: count("connection_sku_sales_daily_facts"),
  periodFacts: count("connection_sku_sales_facts"),
  erpSkus: count("erp_skus"),
};
assert.deepEqual(protectedAfter, protectedBefore, "用途治理不得修改关系、Combo、事实或ERP SKU");
const integrity = database.pragma("integrity_check", { simple: true });
const foreignKeys = database.pragma("foreign_key_check");
assert.equal(integrity, "ok");
assert.equal(foreignKeys.length, 0);

console.log(JSON.stringify({
  success: true,
  isolatedDatabase: target,
  reviewer,
  list: { pendingCount: first.summary.pendingCount, identityIssueCount: first.summary.identityIssueCount, confirmedCount: first.summary.confirmedCount, total: first.pagination.total, sample: searchable.merchantSkuCode },
  detail: { evidenceRowsOnPage: detailed.salesRows.length, totalEvidenceRows: detailed.pagination.total },
  confirmations: { auxiliary: auxiliary.usage.id, repeatedIdempotent: repeated.idempotent, replacement: replacement.usage.id, product: product.usage.id },
  protectedBefore, protectedAfter, integrity, foreignKeyErrors: foreignKeys.length,
}, null, 2));
closeDatabase();
