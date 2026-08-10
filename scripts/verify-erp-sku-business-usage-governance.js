import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const sourceDatabase = process.env.WUFAN_SOURCE_DB
  || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-relation-resolver-migration-lQmbDv/isolated.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
if (!fs.existsSync(sourceDatabase)) throw new Error(`隔离验证源数据库不存在：${sourceDatabase}`);
if (!fs.existsSync(sourceFile)) throw new Error(`真实销售日报不存在：${sourceFile}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "erp-sku-business-usage-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDatabase, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const {
  resolveErpSkuBusinessUsage,
  proposeErpSkuBusinessUsage,
  confirmErpSkuBusinessUsage,
} = await import("../server/capabilities/resolveErpSkuBusinessUsage.js");
const { classifySalesDetailLine } = await import("../server/capabilities/classifySalesDetailLine.js");
const { normalizeSalesDetailLine } = await import("../server/capabilities/salesDetailNormalizer.js");

initializeDatabase();
initializeDatabase();
const database = getDatabase();
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedCounts = () => ({
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  dailyFacts: count("connection_sku_sales_daily_facts"),
  periodFacts: count("connection_sku_sales_facts"),
  erpSkus: count("erp_skus"),
  products: count("products"),
});
const before = protectedCounts();
assert.equal(count("erp_sku_business_usages"), 0, "迁移不得自动生成用途");

const workbook = XLSX.read(fs.readFileSync(sourceFile), { type: "buffer", raw: true });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
const suggestionEvidence = {
  "0016": { usageType: "accounting_auxiliary", rowCount: rows.filter((row) => String(row.商家编码).trim() === "0016").length },
  "0013": { usageType: "shipping_adjustment", rowCount: rows.filter((row) => String(row.商家编码).trim() === "0013").length },
};
assert.deepEqual({ "0016": suggestionEvidence["0016"].rowCount, "0013": suggestionEvidence["0013"].rowCount }, { "0016": 57, "0013": 41 });

const erp0016 = database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE merchantSkuCode='0016'").get();
const erp0013 = database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE merchantSkuCode='0013'").get();
const reviewer = database.prepare("SELECT id FROM persons ORDER BY createdAt,id LIMIT 1").get();
assert.ok(erp0016 && erp0013 && reviewer);

const proposal0016 = proposeErpSkuBusinessUsage({
  erpSkuId: erp0016.id,
  usageType: suggestionEvidence["0016"].usageType,
  sourceType: "system_suggestion",
  decisionNote: `真实利润SKU明细中出现${suggestionEvidence["0016"].rowCount}行，仅作为人工治理建议。`,
}, { database });
const proposal0013 = proposeErpSkuBusinessUsage({
  erpSkuId: erp0013.id,
  usageType: suggestionEvidence["0013"].usageType,
  sourceType: "system_suggestion",
  decisionNote: `真实利润SKU明细中出现${suggestionEvidence["0013"].rowCount}行，仅作为人工治理建议。`,
}, { database });
assert.equal(proposal0016.usage.status, "proposed");
assert.equal(proposal0013.usage.status, "proposed");
assert.equal(resolveErpSkuBusinessUsage({ erpSkuId: erp0016.id }, { database }).usageType, "unknown");
assert.equal(resolveErpSkuBusinessUsage({ erpSkuId: erp0013.id }, { database }).isUsable, false);
assert.equal(proposeErpSkuBusinessUsage({
  erpSkuId: erp0016.id,
  usageType: "accounting_auxiliary",
  sourceType: "system_suggestion",
  decisionNote: "重复建议验证。",
}, { database }).idempotent, true);

const confirmed0016 = confirmErpSkuBusinessUsage({
  erpSkuId: erp0016.id,
  usageType: "accounting_auxiliary",
  reviewedBy: reviewer.id,
  decisionNote: "隔离验证人工确认。",
}, { database });
assert.equal(confirmed0016.usage.status, "active");
assert.equal(confirmed0016.usage.sourceType, "manual_confirmation");
const resolved0016 = resolveErpSkuBusinessUsage({ erpSkuId: erp0016.id }, { database });
assert.equal(resolved0016.usageType, "accounting_auxiliary");
assert.equal(resolved0016.isConfirmed, true);
assert.equal(resolved0016.isUsable, true);

const usageCountAfterConfirmation = count("erp_sku_business_usages");
const repeated = confirmErpSkuBusinessUsage({
  erpSkuId: erp0016.id,
  usageType: "accounting_auxiliary",
  reviewedBy: reviewer.id,
  decisionNote: "重复点击。",
}, { database });
assert.equal(repeated.idempotent, true);
assert.equal(count("erp_sku_business_usages"), usageCountAfterConfirmation);

const replaced = confirmErpSkuBusinessUsage({
  erpSkuId: erp0016.id,
  usageType: "product",
  reviewedBy: reviewer.id,
  decisionNote: "隔离验证用途替换。",
}, { database });
assert.equal(replaced.replacedUsageId, confirmed0016.usage.id);
assert.equal(database.prepare("SELECT status FROM erp_sku_business_usages WHERE id=?").get(confirmed0016.usage.id).status, "superseded");
assert.equal(resolveErpSkuBusinessUsage({ erpSkuId: erp0016.id }, { database }).usageType, "product");

const confirmed0013 = confirmErpSkuBusinessUsage({
  erpSkuId: erp0013.id,
  usageType: "shipping_adjustment",
  reviewedBy: reviewer.id,
  decisionNote: "隔离验证人工确认。",
}, { database });
assert.equal(confirmed0013.usage.status, "active");

const sample = normalizeSalesDetailLine(rows.find((row) => String(row.商家编码).trim() === "0013"), {
  sourceRowNumber: rows.findIndex((row) => String(row.商家编码).trim() === "0013") + 2,
  erpSkuId: erp0013.id,
});
const classified = classifySalesDetailLine(sample, { erpSkuBusinessUsage: resolveErpSkuBusinessUsage({ erpSkuId: erp0013.id }, { database }) });
assert.equal(classified.classification, "shipping_adjustment");
assert.equal(classified.relationRequired, false);
assert.equal(classified.isFactEligible, false);

const unknown = resolveErpSkuBusinessUsage({ erpSkuId: "erp-sku-does-not-exist" }, { database });
assert.equal(unknown.usageType, "unknown");
assert.equal(unknown.warnings[0].code, "ERP_SKU_NOT_FOUND");

assert.throws(() => database.prepare(`INSERT INTO erp_sku_business_usages
  (id,erpSkuId,usageType,status,sourceType,reviewedBy,reviewedAt,decisionNote,createdAt,updatedAt)
  VALUES ('duplicate-active',?,'other_adjustment','active','manual_confirmation',?,datetime('now'),'constraint test',datetime('now'),datetime('now'))`).run(erp0013.id, reviewer.id), /UNIQUE constraint failed/);
assert.throws(() => database.prepare(`INSERT INTO erp_sku_business_usages
  (id,erpSkuId,usageType,status,sourceType,reviewedBy,reviewedAt,decisionNote,supersedesUsageId,createdAt,updatedAt)
  VALUES ('cross-erp',?,'product','inactive','manual_confirmation',NULL,NULL,'constraint test',?,datetime('now'),datetime('now'))`).run(erp0013.id, replaced.usage.id), /same ERP SKU/);
assert.throws(() => database.prepare(`INSERT INTO erp_sku_business_usages
  (id,erpSkuId,usageType,status,sourceType,decisionNote,createdAt,updatedAt)
  VALUES ('missing-review',?,'product','active','manual_confirmation','constraint test',datetime('now'),datetime('now'))`).run(erp0013.id), /CHECK constraint failed/);

const after = protectedCounts();
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  success: true,
  isolatedDatabase: databasePath,
  migrationIdempotent: true,
  suggestions: {
    "0016": { status: proposal0016.usage.status, usageType: proposal0016.usage.usageType, evidenceRows: 57 },
    "0013": { status: proposal0013.usage.status, usageType: proposal0013.usage.usageType, evidenceRows: 41 },
  },
  resolver: {
    confirmed: { usageType: resolved0016.usageType, isConfirmed: resolved0016.isConfirmed, isUsable: resolved0016.isUsable },
    unknownErpSku: unknown.warnings[0].code,
  },
  confirmation: { repeatedIdempotent: repeated.idempotent, replacementSupersededOld: true },
  constraints: { oneActive: "blocked", sameErpSupersedes: "blocked", activeReviewRequired: "blocked" },
  classifyIntegration: classified.classification,
  protectedBefore: before,
  protectedAfter: after,
  integrityCheck: "ok",
  foreignKeyCheckErrors: 0,
}, null, 2));
closeDatabase();
