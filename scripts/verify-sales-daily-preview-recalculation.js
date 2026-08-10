import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-sales-daily-preview-source.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sales-daily-recalculation-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath); process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { previewSalesDailyFacts, readSalesDailyFactPreview, recalculateSalesDailyFactPreview } = await import("../server/salesDailyFactPreviewService.js");
const { confirmSalesRelationCandidate } = await import("../server/salesRelationCandidateService.js");
const count = (database, table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
const closeEnough = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.0001;
const verifyAmounts = (summary) => {
  assert.ok(closeEnough(summary.sourceSalesAmount, Number(summary.readySalesAmount || 0) + Number(summary.pendingSalesAmount || 0) + Number(summary.errorSalesAmount || 0)));
  assert.ok(closeEnough(summary.sourceProfitAmount, Number(summary.readyProfitAmount || 0) + Number(summary.pendingProfitAmount || 0) + Number(summary.errorProfitAmount || 0)));
  assert.ok(closeEnough(summary.salesAmountReconciliationDifference, 0)); assert.ok(closeEnough(summary.profitAmountReconciliationDifference, 0));
};

try {
  initializeDatabase();
  const database = getDatabase(); const buffer = fs.readFileSync(sourceFile);
  const original = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
  assert.equal(original.summary.previewRevision, 1); verifyAmounts(original.summary);
  const reviewer = database.prepare("SELECT id FROM persons ORDER BY createdAt LIMIT 1").get(); assert.ok(reviewer?.id);
  const candidate = database.prepare(`SELECT c.* FROM sales_link_sku_erp_mapping_candidates c WHERE c.sourceBatchId=? AND c.candidateType='single' AND c.status='pending'
    AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=c.salesLinkSkuId AND m.currentState='active') ORDER BY c.affectedRowCount DESC LIMIT 1`).get(original.batch.id);
  assert.ok(candidate?.id);
  const protectedSku = database.prepare("SELECT id,erpSkuId,productId FROM sales_link_skus WHERE id=?").get(candidate.salesLinkSkuId);
  const before = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"), periodFacts: count(database, "connection_sku_sales_facts"), mappings: count(database, "sales_link_sku_erp_mappings"),
    links: count(database, "sales_links"), linkSkus: count(database, "sales_link_skus"), erpSkus: count(database, "erp_skus"), products: count(database, "products"),
    inventoryFacts: count(database, "erp_sku_warehouse_inventory_facts"), inventorySummaries: count(database, "erp_sku_inventory_daily_summaries"),
  };
  const confirmation = confirmSalesRelationCandidate(candidate.id, { reviewedBy: reviewer.id }); assert.equal(confirmation.summary.created, 1);
  const originalAfterConfirmation = readSalesDailyFactPreview(original.batch.id, { pageSize: 1 });
  assert.equal(originalAfterConfirmation.summary.relationRecalculationRequired, true);
  const preservedOriginalSummary = JSON.stringify(originalAfterConfirmation.summary);

  const revision2 = recalculateSalesDailyFactPreview(original.batch.id, { createdBy: reviewer.id });
  assert.equal(revision2.summary.previewRevision, 2); assert.equal(revision2.summary.parentBatchId, original.batch.id); assert.equal(revision2.summary.rootBatchId, original.batch.id);
  assert.equal(revision2.summary.readyRows, original.summary.readyRows + candidate.affectedRowCount);
  assert.equal(revision2.summary.pendingRelationRows, original.summary.pendingRelationRows - candidate.affectedRowCount);
  assert.equal(revision2.summary.changes.readyRows, candidate.affectedRowCount); assert.equal(revision2.summary.changes.pendingRelationRows, -candidate.affectedRowCount);
  assert.equal(revision2.summary.comboCandidateCount > 0, true); verifyAmounts(revision2.summary);
  assert.equal(JSON.stringify(readSalesDailyFactPreview(original.batch.id, { pageSize: 1 }).summary), preservedOriginalSummary, "重算不得覆盖旧预览统计");

  const revision3 = recalculateSalesDailyFactPreview(revision2.batch.id, { createdBy: reviewer.id });
  assert.equal(revision3.summary.previewRevision, 3); assert.equal(revision3.summary.readyRows, revision2.summary.readyRows); assert.equal(revision3.summary.pendingRelationRows, revision2.summary.pendingRelationRows); assert.equal(revision3.summary.errorRows, revision2.summary.errorRows);
  assert.equal(revision3.summary.changes.readyRows, 0); assert.equal(revision3.summary.changes.pendingRelationRows, 0); verifyAmounts(revision3.summary);

  database.prepare("UPDATE sales_link_sku_erp_mappings SET currentState='inactive',updatedAt=? WHERE id=?").run(new Date().toISOString(), confirmation.result.mappingId);
  const revision4 = recalculateSalesDailyFactPreview(revision3.batch.id, { createdBy: reviewer.id });
  assert.equal(revision4.summary.previewRevision, 4); assert.equal(revision4.summary.readyRows, revision3.summary.readyRows - candidate.affectedRowCount);
  assert.equal(revision4.summary.pendingRelationRows, revision3.summary.pendingRelationRows + candidate.affectedRowCount);
  assert.equal(revision4.summary.missingRelationRows, revision3.summary.missingRelationRows + candidate.affectedRowCount);
  assert.equal(revision4.summary.errorRows, revision3.summary.errorRows); verifyAmounts(revision4.summary);
  const repeatedUpload = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
  assert.equal(repeatedUpload.idempotent, true); assert.equal(repeatedUpload.batch.id, revision4.batch.id, "相同文件应恢复最新revision，而不是退回旧预览");
  const routeSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(routeSource, /sales-daily\/:id\/recalculate", requireLinkImport/);

  const after = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"), periodFacts: count(database, "connection_sku_sales_facts"), mappings: count(database, "sales_link_sku_erp_mappings"),
    links: count(database, "sales_links"), linkSkus: count(database, "sales_link_skus"), erpSkus: count(database, "erp_skus"), products: count(database, "products"),
    inventoryFacts: count(database, "erp_sku_warehouse_inventory_facts"), inventorySummaries: count(database, "erp_sku_inventory_daily_summaries"),
  };
  assert.equal(after.dailyFacts, 0); assert.equal(after.dailyFacts, before.dailyFacts); assert.equal(after.periodFacts, 505); assert.equal(after.periodFacts, before.periodFacts);
  assert.equal(after.mappings, before.mappings + 1); for (const field of ["links", "linkSkus", "erpSkus", "products", "inventoryFacts", "inventorySummaries"]) assert.equal(after[field], before[field]);
  assert.deepEqual(database.prepare("SELECT id,erpSkuId,productId FROM sales_link_skus WHERE id=?").get(candidate.salesLinkSkuId), protectedSku);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.equal(database.pragma("foreign_key_check").length, 0);
  process.stdout.write(`${JSON.stringify({ success: true, isolatedDatabase: databasePath, sourceSha256: crypto.createHash("sha256").update(buffer).digest("hex"), confirmedCandidate: { id: candidate.id, affectedRows: candidate.affectedRowCount }, revisions: [original.summary, revision2.summary, revision3.summary, revision4.summary].map((summary) => ({ revision: summary.previewRevision, ready: summary.readyRows, pending: summary.pendingRelationRows, error: summary.errorRows, salesCoverage: summary.salesAmountCoverage, profitCoverage: summary.profitAmountCoverage, changes: summary.changes || null, relationConflict: summary.errorBreakdown?.relation_conflict || 0 })), protectedCounts: { before, after }, integrityCheck: "ok", foreignKeyErrors: 0 }, null, 2)}\n`);
} finally { closeDatabase(); }
