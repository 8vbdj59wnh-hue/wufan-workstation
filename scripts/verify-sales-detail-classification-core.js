import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import XLSX from "xlsx";
import { normalizeSalesDetailLine } from "../server/capabilities/salesDetailNormalizer.js";
import { classifySalesDetailLine } from "../server/capabilities/classifySalesDetailLine.js";
import { resolveErpSkuBusinessUsage } from "../server/capabilities/resolveErpSkuBusinessUsage.js";
import { resolveLinkSkuErpRelation } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const databasePath = process.env.WUFAN_SOURCE_DB
  || "/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-relation-resolver-migration-lQmbDv/isolated.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
if (!fs.existsSync(databasePath)) throw new Error(`隔离数据库不存在：${databasePath}`);
if (!fs.existsSync(sourceFile)) throw new Error(`真实销售日报不存在：${sourceFile}`);

const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedBefore = {
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  dailyFacts: count("connection_sku_sales_daily_facts"),
  erpSkus: count("erp_skus"),
  products: count("products"),
};

const workbook = XLSX.read(fs.readFileSync(sourceFile), { type: "buffer", raw: true, cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
const headers = matrix[0].map((value) => String(value ?? "").trim());
const rawRows = matrix.slice(1)
  .map((values, index) => ({
    sourceRowNumber: index + 2,
    raw: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])),
  }))
  .filter((item) => Object.values(item.raw).some((value) => String(value ?? "").trim()));
assert.equal(rawRows.length, 11826);

const normalizedRows = rawRows.map((item) => normalizeSalesDetailLine(item.raw, { sourceRowNumber: item.sourceRowNumber }));
const summaryRows = normalizedRows.filter((line) => line.exclusionReasonCode === "SUMMARY_ROW");
assert.equal(summaryRows.length, 1);
assert.equal(summaryRows[0].sourceRowNumber, 11827);
assert.equal(classifySalesDetailLine(summaryRows[0]).classification, "excluded");
assert.deepEqual(classifySalesDetailLine(summaryRows[0]).reasonCodes, ["SUMMARY_ROW"]);

const auxiliarySource = normalizedRows.find((line) => line.merchantSkuCode === "0016");
const shippingSource = normalizedRows.find((line) => line.merchantSkuCode === "0013");
assert.ok(auxiliarySource && shippingSource);
assert.equal(classifySalesDetailLine(auxiliarySource).classification, "unknown");
assert.equal(classifySalesDetailLine(shippingSource).classification, "unknown");
assert.ok(classifySalesDetailLine(auxiliarySource).warnings[0].includes("禁止根据编码"));

const usageCases = [
  ["product", "product_sale"],
  ["accounting_auxiliary", "accounting_auxiliary"],
  ["shipping_adjustment", "shipping_adjustment"],
  ["other_adjustment", "other_adjustment"],
];
for (const [usageType, classification] of usageCases) {
  const usage = resolveErpSkuBusinessUsage({ erpSkuId: "erp-test" }, {
    lookup: () => ({ usageType, source: "manual_confirmation", reviewedBy: "reviewer" }),
  });
  const result = classifySalesDetailLine({ ...auxiliarySource, erpSkuId: "erp-test" }, { erpSkuBusinessUsage: usage });
  assert.equal(result.classification, classification);
  assert.equal(result.relationRequired, classification === "product_sale");
  assert.equal(result.isFactEligible, false);
}

const incomplete = normalizeSalesDetailLine({
  店铺: "测试店铺", 平台货品ID: "goods-1", 平台规格ID: "", 商家编码: "HP-X", 日期: "2026-08-09",
  销量: 1, 销售额: 100, 成本: 60, 利润: 40,
}, { sourceRowNumber: 99 });
const incompleteClassification = classifySalesDetailLine(incomplete);
assert.equal(incomplete.normalizationStatus, "incomplete");
assert.equal(incompleteClassification.classification, "unknown");
assert.ok(incompleteClassification.reasonCodes.includes("SOURCE_FIELDS_INCOMPLETE"));

const batch = database.prepare("SELECT id FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC LIMIT 1").get();
assert.ok(batch?.id);
const readyStored = database.prepare(`SELECT rowNumber,rawDataJson,normalizedDataJson
  FROM connection_import_rows WHERE batchId=? AND status='ready' ORDER BY rowNumber LIMIT 1`).get(batch.id);
assert.ok(readyStored);
const readyRaw = JSON.parse(readyStored.rawDataJson);
const readyIdentity = JSON.parse(readyStored.normalizedDataJson);
const readyLine = normalizeSalesDetailLine(readyRaw, {
  sourceRowNumber: readyStored.rowNumber,
  sourceBatchId: batch.id,
  salesLinkSkuId: readyIdentity.salesLinkSkuId,
  erpSkuId: readyIdentity.erpSkuId,
});
const relation = resolveLinkSkuErpRelation({ salesLinkSkuId: readyLine.salesLinkSkuId }, { database });
const readyClassification = classifySalesDetailLine(readyLine, { relation });
assert.equal(readyClassification.classification, "product_sale");
assert.equal(readyClassification.relationRequired, true);
assert.equal(readyClassification.isFactEligible, true);
assert.deepEqual(readyClassification.warnings, ["ERP_USAGE_NOT_EXPLICITLY_CONFIRMED"]);

const protectedAfter = {
  mappings: count("sales_link_sku_erp_mappings"),
  comboGroups: count("sales_link_sku_combo_groups"),
  comboComponents: count("sales_link_sku_combo_group_components"),
  dailyFacts: count("connection_sku_sales_daily_facts"),
  erpSkus: count("erp_skus"),
  products: count("products"),
};
assert.deepEqual(protectedAfter, protectedBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  success: true,
  sourceFile: path.basename(sourceFile),
  totalSourceRows: rawRows.length,
  summaryRows: summaryRows.length,
  codeOnlyClassification: { "0016": "unknown", "0013": "unknown" },
  manualUsageCases: Object.fromEntries(usageCases),
  formalRelationEvidence: {
    sourceRowNumber: readyStored.rowNumber,
    classification: readyClassification.classification,
    warning: readyClassification.warnings[0],
  },
  protectedBefore,
  protectedAfter,
  integrityCheck: "ok",
  foreignKeyCheckErrors: 0,
}, null, 2));
database.close();
