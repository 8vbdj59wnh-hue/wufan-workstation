import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [sourceDatabasePath, salesFilePath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : value);
if (!sourceDatabasePath || !salesFilePath || !outputPath) throw new Error("参数不足：生产后快照、销售文件、输出结果均为必填。");
const workingDatabasePath = "/tmp/business001-phase78-preview-working.db";
fs.copyFileSync(sourceDatabasePath, workingDatabasePath);
process.env.WUFAN_DB_PATH = workingDatabasePath;

const { closeDatabase, getDatabase } = await import("../server/db.js");
const { previewSalesDailyFacts, evaluateSalesDailyFactCoverage } = await import("../server/salesDailyFactPreviewService.js");
const { resolveLinkSkuErpRelations } = await import("../server/capabilities/resolveLinkSkuErpRelation.js");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const money = (value) => Number(Number(value || 0).toFixed(4));
const count = (db, table, where = "") => Number(db.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total || 0);
const factFields = ["salesLinkId", "salesLinkSkuId", "erpSkuId", "saleDate", "quantity", "salesAmount", "costAmount", "profitAmount", "incomeAmount", "refundAmount", "returnAmount", "postageIncomeAmount", "goodsCostAmount", "returnCostAmount", "postageCostAmount", "otherAdjustmentAmount", "feeAmount", "receivedAmount", "factType"];
const sameValue = (left, right) => factFields.every((field) => {
  const a = left[field] === undefined ? null : left[field]; const b = right[field] === undefined ? null : right[field];
  if (a === null || b === null) return a === b;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9;
  return String(a) === String(b);
});
const aggregate = (rows) => ({
  rows: rows.length,
  salesAmount: money(rows.reduce((sum, row) => sum + Number(row.normalized?.salesAmount ?? row.salesAmount ?? 0), 0)),
  profitAmount: money(rows.reduce((sum, row) => sum + Number(row.normalized?.profitAmount ?? row.profitAmount ?? 0), 0)),
});
const baseline = (db) => ({
  activeMappings: count(db, "sales_link_sku_erp_mappings", "WHERE currentState='active'"),
  structures: count(db, "sales_link_sku_product_structures"),
  activeStructures: count(db, "sales_link_sku_product_structures", "WHERE status='active'"),
  structureComponents: count(db, "sales_link_sku_product_structure_components"),
  erpUsages: count(db, "erp_sku_business_usages"),
  dailyFacts: count(db, "connection_sku_sales_daily_facts"),
});

try {
  const sourceSha = sha256(sourceDatabasePath);
  const db = getDatabase();
  const before = baseline(db);
  const preview = previewSalesDailyFacts({ buffer: fs.readFileSync(salesFilePath), fileName: path.basename(salesFilePath) });
  const evaluation = evaluateSalesDailyFactCoverage(preview.batch.id, { ignoreExistingDailyFacts: true });
  const categories = {};
  for (const name of ["ready", "pending_relation", "missing_relation", "relation_conflict", "unknown", "accounting_auxiliary", "shipping_adjustment", "other_adjustment", "excluded"]) {
    categories[name] = aggregate(evaluation.rows.filter((row) => row.category === name));
  }

  const readyRows = evaluation.rows.filter((row) => row.category === "ready");
  const skuIds = [...new Set(readyRows.map((row) => row.identity.salesLinkSkuId))];
  const resolved = resolveLinkSkuErpRelations({ salesLinkSkuIds: skuIds }, { database: db }).results;
  const candidates = readyRows.map((row) => {
    const relation = resolved[row.identity.salesLinkSkuId];
    return {
      sourceRowNumber: row.rowNumber,
      salesLinkId: row.identity.salesLinkId,
      salesLinkSkuId: row.identity.salesLinkSkuId,
      erpSkuId: row.identity.erpSkuId,
      saleDate: row.normalized.saleDate,
      quantity: row.normalized.quantity,
      salesAmount: row.normalized.salesAmount,
      costAmount: row.normalized.costAmount,
      profitAmount: row.normalized.profitAmount,
      incomeAmount: row.normalized.incomeAmount,
      refundAmount: row.normalized.refundAmount,
      returnAmount: row.normalized.returnAmount,
      postageIncomeAmount: row.normalized.postageIncomeAmount,
      goodsCostAmount: row.normalized.goodsCostAmount,
      returnCostAmount: row.normalized.returnCostAmount,
      postageCostAmount: row.normalized.postageCostAmount,
      otherAdjustmentAmount: row.normalized.otherAdjustmentAmount,
      feeAmount: row.normalized.feeAmount,
      receivedAmount: row.normalized.receivedAmount,
      factType: relation.relationshipShape === "multi_component" ? "combo_component" : "normal",
      relationshipShape: relation.relationshipShape,
      mappingQuantity: relation.mappings.find((mapping) => mapping.erpSkuId === row.identity.erpSkuId)?.quantity ?? null,
    };
  });
  const existing = db.prepare("SELECT * FROM connection_sku_sales_daily_facts").all();
  const existingByKey = new Map(existing.map((row) => [`${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`, row]));
  const inserts = []; const skips = []; const updatePending = [];
  for (const candidate of candidates) {
    const current = existingByKey.get(`${candidate.salesLinkSkuId}|${candidate.erpSkuId}|${candidate.saleDate}`);
    if (!current) inserts.push(candidate);
    else if (sameValue(current, candidate)) skips.push(candidate);
    else updatePending.push({ ...candidate, existingFactId: current.id, changedFields: factFields.filter((field) => !sameValue({ [field]: current[field] }, { [field]: candidate[field] })) });
  }
  const byShape = Object.fromEntries(["single_unit", "single_multi_quantity", "multi_component"].map((shape) => [shape, aggregate(candidates.filter((row) => row.relationshipShape === shape))]));
  const singleQuantityRows = candidates.filter((row) => row.relationshipShape === "single_multi_quantity");
  const singleQuantityDistribution = Object.entries(singleQuantityRows.reduce((result, row) => { const key = String(row.mappingQuantity); result[key] = (result[key] || 0) + 1; return result; }, {})).sort((a, b) => Number(a[0]) - Number(b[0]));
  const comboCandidates = candidates.filter((row) => row.relationshipShape === "multi_component");
  const result = {
    success: true,
    sourceDatabasePath,
    sourceDatabaseSha256: sourceSha,
    salesFilePath,
    salesFileSha256: sha256(salesFilePath),
    previewBatchId: preview.batch.id,
    parserMode: "fresh_excel_reparse",
    beforeReady: { rows: 9058, salesAmount: 1125674.9599, profitAmount: 530657.3316 },
    categories,
    readyChange: { rows: categories.ready.rows - 9058, salesAmount: money(categories.ready.salesAmount - 1125674.9599), profitAmount: money(categories.ready.profitAmount - 530657.3316) },
    relationshipShapes: byShape,
    singleMultiQuantity: { ...aggregate(singleQuantityRows), salesLinkSkus: new Set(singleQuantityRows.map((row) => row.salesLinkSkuId)).size, mappingQuantityDistribution: singleQuantityDistribution },
    comboComponents: { ...aggregate(comboCandidates), salesLinkSkus: new Set(comboCandidates.map((row) => row.salesLinkSkuId)).size, erpSkus: new Set(comboCandidates.map((row) => row.erpSkuId)).size },
    commitCandidate: {
      eligible: aggregate(candidates),
      newFacts: aggregate(inserts),
      skippedExisting: aggregate(skips),
      updatePending: aggregate(updatePending),
      involvedSalesLinkSkus: new Set(inserts.map((row) => row.salesLinkSkuId)).size,
      involvedErpSkus: new Set(inserts.map((row) => row.erpSkuId)).size,
    },
    baseline: before,
    after: baseline(db),
    integrityCheck: db.pragma("integrity_check", { simple: true }),
    foreignKeyErrors: db.pragma("foreign_key_check").length,
  };
  result.protection = {
    sourceDatabaseUnchanged: sha256(sourceDatabasePath) === sourceSha,
    mappingsUnchanged: result.after.activeMappings === before.activeMappings,
    structuresUnchanged: result.after.structures === before.structures && result.after.activeStructures === before.activeStructures && result.after.structureComponents === before.structureComponents,
    erpUsagesUnchanged: result.after.erpUsages === before.erpUsages,
    dailyFactsUnchanged: result.after.dailyFacts === before.dailyFacts,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
