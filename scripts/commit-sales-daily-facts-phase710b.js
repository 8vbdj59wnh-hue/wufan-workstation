import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || true];
}));
const databasePath = path.resolve(String(args.database || ""));
const projectPath = path.resolve(String(args.project || path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
const batchId = String(args.batch || "").trim();
const execute = args.execute === "true";
assert(databasePath && fs.existsSync(databasePath), "必须提供存在的 --database 绝对路径。");
assert(batchId, "必须提供 --batch。");
process.env.WUFAN_DB_PATH = databasePath;

const moduleUrl = (relativePath) => pathToFileURL(path.join(projectPath, relativePath)).href;
const { closeDatabase, getDatabase } = await import(moduleUrl("server/db.js"));
const { evaluateSalesDailyFactCoverage } = await import(moduleUrl("server/salesDailyFactPreviewService.js"));
const { resolveLinkSkuErpRelations } = await import(moduleUrl("server/capabilities/resolveLinkSkuErpRelation.js"));

const EXPECTED = Object.freeze({
  existing: 3668,
  inserts: 7880,
  insertedSalesAmount: 781304.3627,
  insertedProfitAmount: 370650.1454,
  ready: 11548,
  readySalesAmount: 1327063.9502,
  readyProfitAmount: 624038.6962,
  auxiliary: 57,
  shipping: 41,
});
const money = (value) => Number(Number(value || 0).toFixed(4));
const sum = (rows, field) => money(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
const keyOf = (row) => `${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`;
const FACT_FIELDS = [
  "salesLinkId", "salesLinkSkuId", "erpSkuId", "saleDate", "quantity", "salesAmount", "costAmount", "profitAmount",
  "incomeAmount", "refundAmount", "returnAmount", "postageIncomeAmount", "goodsCostAmount", "returnCostAmount",
  "postageCostAmount", "otherAdjustmentAmount", "feeAmount", "receivedAmount", "factType",
];
const sameValue = (left, right) => FACT_FIELDS.every((field) => {
  const a = left[field] === undefined ? null : left[field];
  const b = right[field] === undefined ? null : right[field];
  if (a === null || b === null) return a === b;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9;
  return String(a) === String(b);
});

const database = getDatabase();
try {
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType='erp_sales_daily_preview'").get(batchId);
  assert(batch, "指定销售日报预览批次不存在。");
  const protectedBefore = {
    structures: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures").get().total,
    structureComponents: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structure_components").get().total,
    activeMappings: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total,
    erpSkus: database.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
    products: database.prepare("SELECT COUNT(*) total FROM products").get().total,
    productMappings: database.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
  };
  const evaluation = evaluateSalesDailyFactCoverage(batchId, { ignoreExistingDailyFacts: true });
  const readyRows = evaluation.rows.filter((row) => row.category === "ready");
  const categoryCounts = Object.fromEntries(["ready", "accounting_auxiliary", "shipping_adjustment", "missing_relation", "relation_conflict", "unknown", "excluded"].map((category) => [category, evaluation.rows.filter((row) => row.category === category).length]));
  const relationIds = [...new Set(readyRows.map((row) => row.identity.salesLinkSkuId))];
  const relations = resolveLinkSkuErpRelations({ salesLinkSkuIds: relationIds }, { database }).results;
  const rawByRow = new Map(database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=?").all(batchId).map((row) => [row.rowNumber, row.rawDataJson]));
  const now = new Date().toISOString();
  const candidates = readyRows.map((row) => {
    const relation = relations[row.identity.salesLinkSkuId];
    assert.equal(relation?.relationStatus, "active_complete", `第${row.rowNumber}行关系不是active_complete。`);
    assert.equal(relation?.isUsable, true, `第${row.rowNumber}行关系不可用。`);
    const mapping = relation.mappings.find((item) => item.erpSkuId === row.identity.erpSkuId);
    assert(mapping, `第${row.rowNumber}行目标ERP SKU不在active mapping集合。`);
    const data = row.normalized;
    return {
      id: `sales-daily-fact-${crypto.randomUUID()}`,
      salesLinkId: row.identity.salesLinkId,
      salesLinkSkuId: row.identity.salesLinkSkuId,
      erpSkuId: row.identity.erpSkuId,
      saleDate: data.saleDate,
      quantity: data.quantity,
      salesAmount: data.salesAmount,
      costAmount: data.costAmount,
      profitAmount: data.profitAmount,
      incomeAmount: data.incomeAmount,
      refundAmount: data.refundAmount,
      returnAmount: data.returnAmount,
      postageIncomeAmount: data.postageIncomeAmount,
      goodsCostAmount: data.goodsCostAmount,
      returnCostAmount: data.returnCostAmount,
      postageCostAmount: data.postageCostAmount,
      otherAdjustmentAmount: data.otherAdjustmentAmount,
      feeAmount: data.feeAmount,
      receivedAmount: data.receivedAmount,
      factType: relation.relationshipShape === "multi_component" ? "combo_component" : "normal",
      sourceBatchId: batchId,
      sourceRowNumber: row.rowNumber,
      rawDataJson: rawByRow.get(row.rowNumber) || "{}",
      createdAt: now,
      updatedAt: now,
    };
  });
  const candidateKeys = candidates.map(keyOf);
  assert.equal(new Set(candidateKeys).size, candidateKeys.length, "候选中存在重复事实唯一键。");
  const existing = database.prepare("SELECT * FROM connection_sku_sales_daily_facts").all();
  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const existingBatchFacts = existing.filter((row) => row.sourceBatchId === batchId);
  const inserts = []; const skips = []; const updatePending = [];
  for (const candidate of candidates) {
    const current = existingByKey.get(keyOf(candidate));
    if (!current) inserts.push(candidate);
    else if (sameValue(current, candidate)) skips.push(candidate);
    else updatePending.push(candidate);
  }
  // Production Phase 7-7E filters already persisted facts during preview,
  // while the newer isolated implementation can return the complete ready
  // set. Normalize both versions to the same commit response semantics.
  const previewFilteredExisting = skips.length === 0 && existingBatchFacts.length > 0;
  const accountedSkips = previewFilteredExisting ? existingBatchFacts : skips;
  const completeReadyCount = candidates.length + (previewFilteredExisting ? existingBatchFacts.length : 0);
  const completeReadySales = money(sum(candidates, "salesAmount") + (previewFilteredExisting ? sum(existingBatchFacts, "salesAmount") : 0));
  const completeReadyProfit = money(sum(candidates, "profitAmount") + (previewFilteredExisting ? sum(existingBatchFacts, "profitAmount") : 0));
  const firstRun = existing.length === EXPECTED.existing;
  if (firstRun) {
    assert.equal(completeReadyCount, EXPECTED.ready);
    assert.equal(completeReadySales, EXPECTED.readySalesAmount);
    assert.equal(completeReadyProfit, EXPECTED.readyProfitAmount);
    assert.equal(inserts.length, EXPECTED.inserts);
    assert.equal(accountedSkips.length, EXPECTED.existing);
    assert.equal(updatePending.length, 0);
    assert.equal(sum(inserts, "salesAmount"), EXPECTED.insertedSalesAmount);
    assert.equal(sum(inserts, "profitAmount"), EXPECTED.insertedProfitAmount);
    assert.equal(categoryCounts.accounting_auxiliary, EXPECTED.auxiliary);
    assert.equal(categoryCounts.shipping_adjustment, EXPECTED.shipping);
  } else {
    assert.equal(existing.length, EXPECTED.existing + EXPECTED.inserts);
    assert.equal(inserts.length, 0);
    assert.equal(accountedSkips.length, EXPECTED.ready);
    assert.equal(updatePending.length, 0);
  }

  const result = {
    executed: execute,
    firstRun,
    batchId,
    beforeFactCount: existing.length,
    candidateCount: completeReadyCount,
    insertedCount: execute ? inserts.length : 0,
    wouldInsertCount: inserts.length,
    skippedCount: accountedSkips.length,
    updatePendingCount: updatePending.length,
    idempotent: inserts.length === 0 && updatePending.length === 0,
    insertedSalesAmount: execute ? sum(inserts, "salesAmount") : 0,
    insertedProfitAmount: execute ? sum(inserts, "profitAmount") : 0,
    wouldInsertSalesAmount: sum(inserts, "salesAmount"),
    wouldInsertProfitAmount: sum(inserts, "profitAmount"),
    readySalesAmount: completeReadySales,
    readyProfitAmount: completeReadyProfit,
    dateRange: {
      start: candidates.map((row) => row.saleDate).sort()[0] || null,
      end: candidates.map((row) => row.saleDate).sort().at(-1) || null,
    },
    nonProductIsolation: {
      accountingAuxiliary: categoryCounts.accounting_auxiliary,
      shippingAdjustment: categoryCounts.shipping_adjustment,
    },
    relationshipShapes: Object.fromEntries(["single_unit", "single_multi_quantity", "multi_component"].map((shape) => [shape, readyRows.filter((row) => relations[row.identity.salesLinkSkuId]?.relationshipShape === shape).length])),
    protectedBefore,
  };
  if (execute && inserts.length) database.transaction(() => {
    const insert = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
      (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,incomeAmount,refundAmount,returnAmount,postageIncomeAmount,goodsCostAmount,returnCostAmount,postageCostAmount,otherAdjustmentAmount,feeAmount,receivedAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
      VALUES (@id,@salesLinkId,@salesLinkSkuId,@erpSkuId,@saleDate,@quantity,@salesAmount,@costAmount,@profitAmount,@incomeAmount,@refundAmount,@returnAmount,@postageIncomeAmount,@goodsCostAmount,@returnCostAmount,@postageCostAmount,@otherAdjustmentAmount,@feeAmount,@receivedAmount,@factType,@sourceBatchId,@sourceRowNumber,@rawDataJson,@createdAt,@updatedAt)`);
    for (const fact of inserts) insert.run(fact);
    const summary = JSON.parse(batch.previewSummaryJson || "{}");
    summary.phase710bFactCommit = { ...result, confirmedAt: now };
    database.prepare("UPDATE connection_import_batches SET previewSummaryJson=?,updatedAt=? WHERE id=?").run(JSON.stringify(summary), now, batchId);
  })();
  result.afterFactCount = database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total;
  result.protectedAfter = {
    structures: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures").get().total,
    structureComponents: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structure_components").get().total,
    activeMappings: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total,
    erpSkus: database.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
    products: database.prepare("SELECT COUNT(*) total FROM products").get().total,
    productMappings: database.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
  };
  assert.deepEqual(result.protectedAfter, protectedBefore, "受保护数据计数发生变化。");
  result.integrityCheck = database.pragma("integrity_check", { simple: true });
  result.foreignKeyErrors = database.pragma("foreign_key_check").length;
  assert.equal(result.integrityCheck, "ok");
  assert.equal(result.foreignKeyErrors, 0);
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
