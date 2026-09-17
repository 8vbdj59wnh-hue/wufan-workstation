import { getDatabase } from "./db.js";
import { classifySalesDailyPreviewRows } from "./salesDailyFactPreviewService.js";

const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const number = (value) => Number(value || 0);
const qualityCacheByDatabase = new WeakMap();

export function readSalesDailyQualityCacheRevision(database) {
  const dataVersion = Number(database.pragma("data_version", { simple: true }) || 0);
  const totalChanges = Number(database.prepare("SELECT total_changes() value").get().value || 0);
  return `${dataVersion}:${totalChanges}`;
}

function metric() { return { rows: 0, salesAmount: 0, profitAmount: 0 }; }
function add(target, data = {}) {
  target.rows += 1;
  target.salesAmount += number(data.salesAmount);
  target.profitAmount += number(data.profitAmount);
}

function commitAudit(summary) {
  return [summary.factCommit, summary.phase710bFactCommit]
    .filter((item) => item?.confirmedAt)
    .sort((left, right) => String(right.confirmedAt).localeCompare(String(left.confirmedAt)))[0] || null;
}

function latestCommittedBatch(database) {
  const rows = database.prepare(`SELECT * FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC`).all();
  return rows.find((row) => commitAudit(parseJson(row.previewSummaryJson))) || null;
}

function qualityCategory(item) {
  const category = item.result?.category;
  if (category === "unknown" || category === "error") return "identity_error";
  if (category === "relation_conflict" && ["product_structure_incomplete", "combo_group_incomplete"].includes(item.result?.errorType)) return "incomplete_structure";
  return category;
}

export function querySalesDailyDataQuality(options = {}) {
  const database = options.database || getDatabase();
  const batch = latestCommittedBatch(database);
  if (!batch) return { capability: "QuerySalesDailyDataQuality", contractVersion: "1.0", hasData: false, health: { status: "error", reasons: ["NO_COMMITTED_BATCH"] } };
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs || 0));
  // data_version catches writes from other connections; total_changes catches
  // writes made through this long-lived connection. Together they prevent a
  // relation correction in the same batch from waiting for the TTL to expire.
  const cacheRevision = readSalesDailyQualityCacheRevision(database);
  const cached = qualityCacheByDatabase.get(database);
  if (cacheTtlMs > 0 && cached?.batchId === batch.id && cached.cacheRevision === cacheRevision && Date.now() - cached.createdAt < cacheTtlMs) return cached.value;
  const summary = parseJson(batch.previewSummaryJson);
  const factCommit = commitAudit(summary) || {};
  const storedRows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id)
    .map((row) => ({ rowNumber: row.rowNumber, raw: parseJson(row.rawDataJson) }));
  const facts = database.prepare(`SELECT salesLinkId,salesLinkSkuId,erpSkuId,saleDate,salesAmount,profitAmount,createdAt
    FROM connection_sku_sales_daily_facts WHERE sourceBatchId=?`).all(batch.id);
  const classified = classifySalesDailyPreviewRows(database, storedRows, {
    cache: { shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(), dailyFactKeys: new Set() },
    ignoreExistingDailyFacts: true,
  });
  const categories = {
    ready: metric(), missing_relation: metric(), pending_relation: metric(), relation_conflict: metric(), incomplete_structure: metric(), identity_error: metric(),
    excluded: metric(), accounting_auxiliary: metric(), shipping_adjustment: metric(), other_adjustment: metric(),
  };
  for (const item of classified) add(categories[qualityCategory(item)] || categories.identity_error, item.normalized);

  const productCategories = [categories.ready, categories.missing_relation, categories.pending_relation, categories.relation_conflict, categories.incomplete_structure];
  const productSourceSalesAmount = productCategories.reduce((sum, item) => sum + item.salesAmount, 0);
  const productSourceProfitAmount = productCategories.reduce((sum, item) => sum + item.profitAmount, 0);
  const writtenSalesAmount = facts.reduce((sum, row) => sum + number(row.salesAmount), 0);
  const writtenProfitAmount = facts.reduce((sum, row) => sum + number(row.profitAmount), 0);
  const productRowTotal = productCategories.reduce((sum, item) => sum + item.rows, 0);
  const salesCoverage = productSourceSalesAmount ? writtenSalesAmount / productSourceSalesAmount : null;
  const profitCoverage = productSourceProfitAmount ? writtenProfitAmount / productSourceProfitAmount : null;
  const rowCoverage = productRowTotal ? facts.length / productRowTotal : null;
  const atomicCategories = Object.entries(categories).filter(([key]) => key !== "excluded").map(([, value]) => value);
  const atomicSalesAmount = atomicCategories.reduce((sum, item) => sum + item.salesAmount, 0);
  const atomicProfitAmount = atomicCategories.reduce((sum, item) => sum + item.profitAmount, 0);
  const exceptionCount = categories.missing_relation.rows + categories.pending_relation.rows + categories.relation_conflict.rows + categories.incomplete_structure.rows + categories.identity_error.rows;
  const healthStatus = categories.relation_conflict.rows > 0 || categories.incomplete_structure.rows > 0 ? "error" : exceptionCount > 0 || (salesCoverage ?? 0) < 0.95 ? "warning" : "healthy";
  const reasons = [];
  if (categories.relation_conflict.rows) reasons.push("RELATION_CONFLICT");
  if (categories.incomplete_structure.rows) reasons.push("INCOMPLETE_STRUCTURE");
  if (categories.missing_relation.rows || categories.pending_relation.rows) reasons.push("RELATION_PENDING");
  if (categories.identity_error.rows) reasons.push("IDENTITY_ERROR");
  if ((salesCoverage ?? 0) < 0.95) reasons.push("LOW_AMOUNT_COVERAGE");
  const result = {
    capability: "QuerySalesDailyDataQuality", contractVersion: "1.1", hasData: true,
    batch: { id: batch.id, fileName: batch.fileName, dateStart: batch.periodStart, dateEnd: batch.periodEnd, status: batch.status, importedAt: batch.createdAt, confirmedAt: factCommit.confirmedAt || batch.completedAt, factCount: facts.length },
    coverage: { totalRows: Number(batch.totalRows || storedRows.length), atomicRows: storedRows.length - categories.excluded.rows, productRows: productRowTotal, factRows: facts.length, rowCoverage, categories },
    amounts: {
      productSourceSalesAmount, writtenSalesAmount, unwrittenSalesAmount: productSourceSalesAmount - writtenSalesAmount, salesCoverage,
      productSourceProfitAmount, writtenProfitAmount, unwrittenProfitAmount: productSourceProfitAmount - writtenProfitAmount, profitCoverage,
      atomicSalesAmount, atomicProfitAmount,
      reconciliation: { salesAmountDifference: atomicSalesAmount - atomicCategories.reduce((sum, item) => sum + item.salesAmount, 0), profitAmountDifference: atomicProfitAmount - atomicCategories.reduce((sum, item) => sum + item.profitAmount, 0) },
    },
    governance: {
      identityErrors: { rowCount: categories.identity_error.rows, salesAmount: categories.identity_error.salesAmount, profitAmount: categories.identity_error.profitAmount },
      relationPending: { rowCount: categories.missing_relation.rows + categories.pending_relation.rows, salesAmount: categories.missing_relation.salesAmount + categories.pending_relation.salesAmount, profitAmount: categories.missing_relation.profitAmount + categories.pending_relation.profitAmount },
      conflicts: { rowCount: categories.relation_conflict.rows, salesAmount: categories.relation_conflict.salesAmount, profitAmount: categories.relation_conflict.profitAmount },
      incompleteStructures: { rowCount: categories.incomplete_structure.rows, salesAmount: categories.incomplete_structure.salesAmount, profitAmount: categories.incomplete_structure.profitAmount },
    },
    health: { status: healthStatus, reasons, exceptionCount, lastUpdatedAt: factCommit.confirmedAt || batch.completedAt || batch.updatedAt },
    source: "sales_daily_batch_and_facts_v2",
  };
  if (cacheTtlMs > 0) qualityCacheByDatabase.set(database, { batchId: batch.id, cacheRevision, createdAt: Date.now(), value: result });
  return result;
}

export default querySalesDailyDataQuality;
