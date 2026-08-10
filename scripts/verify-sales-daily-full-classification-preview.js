import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDatabase = process.env.WUFAN_SOURCE_DB
  || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-relation-resolver-migration-lQmbDv/isolated.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
if (!fs.existsSync(sourceDatabase)) throw new Error(`隔离数据库不存在：${sourceDatabase}`);
if (!fs.existsSync(sourceFile)) throw new Error(`真实销售日报不存在：${sourceFile}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sales-daily-full-classification-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDatabase, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const {
  previewSalesDailyFacts,
  evaluateSalesDailyFactCoverage,
  classifySalesDailyPreviewRows,
} = await import("../server/salesDailyFactPreviewService.js");
const {
  proposeErpSkuBusinessUsage,
  confirmErpSkuBusinessUsage,
} = await import("../server/capabilities/resolveErpSkuBusinessUsage.js");
const { classifySalesDetailLine } = await import("../server/capabilities/classifySalesDetailLine.js");
const { normalizeSalesDetailLine } = await import("../server/capabilities/salesDetailNormalizer.js");
const { classifyResolvedRelationForSalesDaily } = await import("../server/salesDailyFactPreviewService.js");

initializeDatabase();
const database = getDatabase();
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedCounts = () => ({
  dailyFacts: count("connection_sku_sales_daily_facts"),
  periodFacts: count("connection_sku_sales_facts"),
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  erpSkus: count("erp_skus"),
  products: count("products"),
});
const before = protectedCounts();
assert.equal(count("erp_sku_business_usages"), 0);

const oldBatch = database.prepare(`SELECT * FROM connection_import_batches
  WHERE importType='erp_sales_daily_preview' AND json_extract(previewSummaryJson,'$.parserVersion')='sales-daily-preview-v1'
  ORDER BY createdAt DESC LIMIT 1`).get();
assert.ok(oldBatch);
const oldRows = database.prepare("SELECT rowNumber,status,errorType FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(oldBatch.id);
assert.equal(oldRows.length, 11826);

const buffer = fs.readFileSync(sourceFile);
const preview = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
assert.equal(preview.idempotent, false);
assert.equal(preview.summary.parserVersion, "sales-daily-preview-v2-classification");
assert.equal(preview.summary.totalRows, 11826);
const newRows = database.prepare("SELECT rowNumber,status,errorType,normalizedDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(preview.batch.id);
assert.equal(newRows.length, oldRows.length);

const oldByRow = new Map(oldRows.map((row) => [row.rowNumber, row]));
const transitions = new Map();
let sameRows = 0;
for (const row of newRows) {
  const previous = oldByRow.get(row.rowNumber);
  if (previous.status === row.status) sameRows += 1;
  else {
    const key = `${previous.status}->${row.status}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
}
assert.equal(sameRows + [...transitions.values()].reduce((sum, value) => sum + value, 0), 11826);
assert.equal(preview.summary.readyRows, 9058);
assert.equal(preview.summary.unknownRows, 2767);
assert.equal(preview.summary.excludedRows, 1);
assert.equal(preview.summary.accountingAuxiliaryRows, 0);
assert.equal(preview.summary.shippingAdjustmentRows, 0);
assert.equal(preview.summary.pendingRelationRows, 0);
assert.equal(preview.summary.relationConflictRows, 0);
assert.equal(preview.summary.classificationSalesAmountDifference, 0);
assert.equal(preview.summary.classificationProfitAmountDifference, 0);
assert.equal(transitions.get("missing_relation->unknown"), 2625);
assert.equal(transitions.get("relation_conflict->unknown"), 86);
assert.equal(transitions.get("error->unknown"), 56);
assert.equal(transitions.get("error->excluded"), 1);

const storedRawRows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(preview.batch.id)
  .map((row) => ({ rowNumber: row.rowNumber, raw: JSON.parse(row.rawDataJson) }));
const cache = {
  shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(),
  dailyFactKeys: new Set(database.prepare("SELECT salesLinkSkuId,erpSkuId,saleDate FROM connection_sku_sales_daily_facts").all().map((row) => `${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`)),
};
let usageSqlCount = 0;
let relationSqlCount = 0;
const repeated = classifySalesDailyPreviewRows(database, storedRawRows, {
  cache,
  onUsageQuery: () => { usageSqlCount += 1; },
  onRelationQuery: () => { relationSqlCount += 1; },
});
assert.equal(repeated.length, 11826);
assert.equal(usageSqlCount, 2);
assert.ok(relationSqlCount <= 6);

const erp0016 = database.prepare("SELECT id FROM erp_skus WHERE merchantSkuCode='0016'").get();
const erp0013 = database.prepare("SELECT id FROM erp_skus WHERE merchantSkuCode='0013'").get();
const reviewer = database.prepare("SELECT id FROM persons ORDER BY createdAt,id LIMIT 1").get();
assert.ok(erp0016 && erp0013 && reviewer);
proposeErpSkuBusinessUsage({ erpSkuId: erp0016.id, usageType: "accounting_auxiliary", sourceType: "system_suggestion", decisionNote: "隔离验证建议，不自动确认。" }, { database });
proposeErpSkuBusinessUsage({ erpSkuId: erp0013.id, usageType: "shipping_adjustment", sourceType: "system_suggestion", decisionNote: "隔离验证建议，不自动确认。" }, { database });
let evaluated = evaluateSalesDailyFactCoverage(preview.batch.id);
assert.equal(evaluated.rows.filter((row) => row.normalized.merchantSkuCode === "0016" && row.category === "unknown").length, 57);
assert.equal(evaluated.rows.filter((row) => row.normalized.merchantSkuCode === "0013" && row.category === "unknown").length, 41);

confirmErpSkuBusinessUsage({ erpSkuId: erp0016.id, usageType: "accounting_auxiliary", reviewedBy: reviewer.id, decisionNote: "隔离流程验证。" }, { database });
confirmErpSkuBusinessUsage({ erpSkuId: erp0013.id, usageType: "shipping_adjustment", reviewedBy: reviewer.id, decisionNote: "隔离流程验证。" }, { database });
evaluated = evaluateSalesDailyFactCoverage(preview.batch.id);
assert.equal(evaluated.rows.filter((row) => row.category === "accounting_auxiliary").length, 57);
assert.equal(evaluated.rows.filter((row) => row.category === "shipping_adjustment").length, 41);
const confirmedNonProduct = {
  accountingAuxiliary: {
    rows: evaluated.rows.filter((row) => row.category === "accounting_auxiliary").length,
    salesAmount: evaluated.rows.filter((row) => row.category === "accounting_auxiliary").reduce((sum, row) => sum + Number(row.normalized.salesAmount || 0), 0),
    profitAmount: evaluated.rows.filter((row) => row.category === "accounting_auxiliary").reduce((sum, row) => sum + Number(row.normalized.profitAmount || 0), 0),
  },
  shippingAdjustment: {
    rows: evaluated.rows.filter((row) => row.category === "shipping_adjustment").length,
    salesAmount: evaluated.rows.filter((row) => row.category === "shipping_adjustment").reduce((sum, row) => sum + Number(row.normalized.salesAmount || 0), 0),
    profitAmount: evaluated.rows.filter((row) => row.category === "shipping_adjustment").reduce((sum, row) => sum + Number(row.normalized.profitAmount || 0), 0),
  },
};

const oldMissing = oldRows.find((row) => row.status === "missing_relation");
const oldConflict = oldRows.find((row) => row.status === "relation_conflict" && !["0016", "0013"].includes(JSON.parse(database.prepare("SELECT normalizedDataJson FROM connection_import_rows WHERE batchId=? AND rowNumber=?").get(oldBatch.id, row.rowNumber).normalizedDataJson).merchantSkuCode));
assert.ok(oldMissing && oldConflict);
const missingIdentity = JSON.parse(database.prepare("SELECT normalizedDataJson FROM connection_import_rows WHERE batchId=? AND rowNumber=?").get(preview.batch.id, oldMissing.rowNumber).normalizedDataJson);
const conflictIdentity = JSON.parse(database.prepare("SELECT normalizedDataJson FROM connection_import_rows WHERE batchId=? AND rowNumber=?").get(preview.batch.id, oldConflict.rowNumber).normalizedDataJson);
for (const erpSkuId of [missingIdentity.erpSkuId, conflictIdentity.erpSkuId]) {
  if (!erpSkuId || [erp0016.id, erp0013.id].includes(erpSkuId)) continue;
  confirmErpSkuBusinessUsage({ erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: "隔离关系分类验证。" }, { database });
}
evaluated = evaluateSalesDailyFactCoverage(preview.batch.id);
// The historical preview already created a pending governance candidate for this
// row, so once usage is confirmed it correctly becomes pending_relation rather
// than missing_relation.
assert.equal(evaluated.rows.find((row) => row.rowNumber === oldMissing.rowNumber).category, "pending_relation");
assert.equal(evaluated.rows.find((row) => row.rowNumber === oldConflict.rowNumber).category, "relation_conflict");

const syntheticLine = normalizeSalesDetailLine({
  店铺: "测试", 平台货品ID: "g", 平台规格ID: "s", 商家编码: "e", 日期: "2026-08-09",
  销量: 1, 销售额: 1, 成本: 1, 利润: 0,
}, { sourceRowNumber: 1, salesLinkSkuId: "sku", erpSkuId: "erp-a" });
const completeCombo = { relationStatus: "active_complete", isUsable: true, relationshipShape: "multi_component", mappings: [{ mappingId: "m1", erpSkuId: "erp-a" }, { mappingId: "m2", erpSkuId: "erp-b" }] };
const productClass = classifySalesDetailLine(syntheticLine, { relation: completeCombo });
assert.equal(productClass.classification, "product_sale");
const completeResult = classifyResolvedRelationForSalesDaily({ result: { category: "identity_ready", erpSku: { id: "erp-a" } } }, completeCombo);
assert.equal(completeResult.result.category, "ready");
const incompleteResult = classifyResolvedRelationForSalesDaily({ result: { category: "identity_ready", erpSku: { id: "erp-a" } } }, { relationStatus: "conflict", isUsable: false, conflicts: [{ code: "combo_group_incomplete", message: "Combo关系不完整" }] });
assert.equal(incompleteResult.result.category, "relation_conflict");
const missingResult = classifyResolvedRelationForSalesDaily({ result: { category: "identity_ready", erpSku: { id: "erp-a" } } }, { relationStatus: "missing", isUsable: false, mappings: [] });
assert.equal(missingResult.result.category, "missing_relation");

const after = protectedCounts();
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  success: true,
  isolatedDatabase: databasePath,
  newSummary: {
    totalRows: preview.summary.totalRows,
    ready: preview.summary.readyRows,
    unknown: preview.summary.unknownRows,
    excluded: preview.summary.excludedRows,
    accountingAuxiliary: preview.summary.accountingAuxiliaryRows,
    shippingAdjustment: preview.summary.shippingAdjustmentRows,
  },
  oldVsNew: { sameRows, differenceRows: 11826 - sameRows, transitions: Object.fromEntries([...transitions].sort()) },
  amountConservation: {
    salesDifference: preview.summary.classificationSalesAmountDifference,
    profitDifference: preview.summary.classificationProfitAmountDifference,
  },
  performance: { usageSqlCount, relationSqlCount },
  confirmedUsageFlow: confirmedNonProduct,
  scenarios: { ready: true, missingRelation: true, pendingRelation: true, relationConflict: true, comboReady: true, comboIncomplete: true, excluded: true },
  protectedBefore: before,
  protectedAfter: after,
  integrityCheck: "ok",
  foreignKeyCheckErrors: 0,
}, null, 2));
closeDatabase();
