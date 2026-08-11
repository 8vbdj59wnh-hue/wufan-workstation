import { getDatabase } from "./db.js";
import { resolveLinkSkuErpRelations } from "./capabilities/resolveLinkSkuErpRelation.js";

const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const number = (value) => Number(value || 0);
const factKey = (row) => `${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`;

function metric() { return { rows: 0, salesAmount: 0, profitAmount: 0 }; }
function add(target, data) {
  target.rows += 1;
  target.salesAmount += number(data.salesAmount);
  target.profitAmount += number(data.profitAmount);
}

function latestCommittedBatch(database) {
  const rows = database.prepare(`SELECT * FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC`).all();
  return rows.find((row) => parseJson(row.previewSummaryJson).factCommit?.confirmedAt) || null;
}

export function querySalesDailyDataQuality(options = {}) {
  const database = options.database || getDatabase();
  const batch = latestCommittedBatch(database);
  if (!batch) return { capability: "QuerySalesDailyDataQuality", contractVersion: "1.0", hasData: false, health: { status: "error", reasons: ["NO_COMMITTED_BATCH"] } };
  const summary = parseJson(batch.previewSummaryJson);
  const factCommit = summary.factCommit || {};
  const storedRows = database.prepare(`SELECT rowNumber,status,errorType,normalizedDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber`).all(batch.id)
    .map((row) => ({ ...row, data: parseJson(row.normalizedDataJson) }));
  const facts = database.prepare(`SELECT salesLinkId,salesLinkSkuId,erpSkuId,saleDate,salesAmount,profitAmount,createdAt FROM connection_sku_sales_daily_facts WHERE sourceBatchId=?`).all(batch.id);
  const factKeys = new Set(facts.map(factKey));
  const usageRows = database.prepare("SELECT erpSkuId,usageType FROM erp_sku_business_usages WHERE status='active'").all();
  const usageByErpSku = new Map(usageRows.map((row) => [row.erpSkuId, row.usageType]));
  const productRows = storedRows.filter((row) => usageByErpSku.get(row.data.erpSkuId) === "product" && row.status !== "excluded");
  const salesLinkSkuIds = [...new Set(productRows.map((row) => row.data.salesLinkSkuId).filter(Boolean))];
  const relations = resolveLinkSkuErpRelations({ salesLinkSkuIds }, { database }).results;
  const categories = {
    ready: metric(), unknown: metric(), missing_relation: metric(), pending_relation: metric(), relation_conflict: metric(),
    excluded: metric(), accounting_auxiliary: metric(), shipping_adjustment: metric(), other_adjustment: metric(),
  };
  const unknownErpSkuIds = new Set();
  for (const row of storedRows) {
    const data = row.data;
    if (row.status === "excluded" || row.errorType === "SUMMARY_ROW") { add(categories.excluded, data); continue; }
    const usage = usageByErpSku.get(data.erpSkuId);
    if (["accounting_auxiliary", "shipping_adjustment", "other_adjustment"].includes(usage)) { add(categories[usage], data); continue; }
    if (usage !== "product") {
      add(categories.unknown, data);
      if (data.erpSkuId) unknownErpSkuIds.add(data.erpSkuId);
      continue;
    }
    if (factKeys.has(factKey(data))) { add(categories.ready, data); continue; }
    const relation = relations[data.salesLinkSkuId];
    if (!relation || relation.relationStatus === "missing" || relation.relationStatus === "not_found") add(categories.missing_relation, data);
    else if (relation.relationStatus === "pending") add(categories.pending_relation, data);
    else if (relation.relationStatus === "conflict" || !relation.isUsable || !relation.mappings.some((mapping) => mapping.erpSkuId === data.erpSkuId)) add(categories.relation_conflict, data);
    else add(categories.ready, data);
  }

  const productCategories = [categories.ready, categories.missing_relation, categories.pending_relation, categories.relation_conflict];
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
  const exceptionCount = categories.missing_relation.rows + categories.pending_relation.rows + categories.relation_conflict.rows + categories.unknown.rows;
  const healthStatus = categories.relation_conflict.rows > 0 ? "error" : exceptionCount > 0 || (salesCoverage ?? 0) < 0.95 ? "warning" : "healthy";
  const reasons = [];
  if (categories.relation_conflict.rows) reasons.push("RELATION_CONFLICT");
  if (categories.missing_relation.rows || categories.pending_relation.rows) reasons.push("RELATION_PENDING");
  if (categories.unknown.rows) reasons.push("ERP_USAGE_PENDING");
  if ((salesCoverage ?? 0) < 0.95) reasons.push("LOW_AMOUNT_COVERAGE");
  return {
    capability: "QuerySalesDailyDataQuality", contractVersion: "1.0", hasData: true,
    batch: { id: batch.id, fileName: batch.fileName, dateStart: batch.periodStart, dateEnd: batch.periodEnd, status: batch.status, importedAt: batch.createdAt, confirmedAt: factCommit.confirmedAt || batch.completedAt, factCount: facts.length },
    coverage: { totalRows: Number(batch.totalRows || storedRows.length), atomicRows: storedRows.length - categories.excluded.rows, productRows: productRowTotal, factRows: facts.length, rowCoverage, categories },
    amounts: {
      productSourceSalesAmount, writtenSalesAmount, unwrittenSalesAmount: productSourceSalesAmount - writtenSalesAmount, salesCoverage,
      productSourceProfitAmount, writtenProfitAmount, unwrittenProfitAmount: productSourceProfitAmount - writtenProfitAmount, profitCoverage,
      atomicSalesAmount, atomicProfitAmount,
      reconciliation: { salesAmountDifference: atomicSalesAmount - atomicCategories.reduce((sum, item) => sum + item.salesAmount, 0), profitAmountDifference: atomicProfitAmount - atomicCategories.reduce((sum, item) => sum + item.profitAmount, 0) },
    },
    governance: {
      erpUsagePending: { erpSkuCount: unknownErpSkuIds.size, rowCount: categories.unknown.rows, salesAmount: categories.unknown.salesAmount, profitAmount: categories.unknown.profitAmount },
      relationPending: { rowCount: categories.missing_relation.rows + categories.pending_relation.rows, salesAmount: categories.missing_relation.salesAmount + categories.pending_relation.salesAmount, profitAmount: categories.missing_relation.profitAmount + categories.pending_relation.profitAmount },
      conflicts: { rowCount: categories.relation_conflict.rows, salesAmount: categories.relation_conflict.salesAmount, profitAmount: categories.relation_conflict.profitAmount },
    },
    health: { status: healthStatus, reasons, exceptionCount, lastUpdatedAt: factCommit.confirmedAt || batch.completedAt || batch.updatedAt },
    source: "sales_daily_batch_and_facts_v1",
  };
}

export default querySalesDailyDataQuality;
