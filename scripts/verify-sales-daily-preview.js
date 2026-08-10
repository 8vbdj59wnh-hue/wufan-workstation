import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sales-daily-preview-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { previewSalesDailyFacts, readSalesDailyFactPreview, SALES_DAILY_PREVIEW_PARSER_VERSION } = await import("../server/salesDailyFactPreviewService.js");
const { querySalesRelationCandidates, readSalesRelationCandidate } = await import("../server/salesRelationCandidateService.js");

function count(database, table) { return Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0); }

try {
  initializeDatabase();
  const database = getDatabase();
  database.transaction(() => {
    database.prepare("DELETE FROM sales_link_sku_combo_group_components WHERE comboGroupId IN (SELECT id FROM sales_link_sku_combo_groups WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?))").run("erp_sales_daily_preview");
    database.prepare("DELETE FROM sales_link_sku_combo_groups WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run("erp_sales_daily_preview");
    database.prepare("DELETE FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run("erp_sales_daily_preview");
    database.prepare("DELETE FROM connection_import_rows WHERE batchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run("erp_sales_daily_preview");
    database.prepare("DELETE FROM connection_import_batches WHERE importType=?").run("erp_sales_daily_preview");
  })();
  const before = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
    mappings: count(database, "sales_link_sku_erp_mappings"),
    links: count(database, "sales_links"),
    linkSkus: count(database, "sales_link_skus"),
    erpSkus: count(database, "erp_skus"),
    batches: count(database, "connection_import_batches"),
    candidates: count(database, "sales_link_sku_erp_mapping_candidates"),
  };
  const buffer = fs.readFileSync(sourceFile);
  const preview = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
  assert.equal(preview.summary.parserVersion, SALES_DAILY_PREVIEW_PARSER_VERSION);
  assert.equal(preview.summary.totalRows, 11826);
  assert.equal(preview.summary.readyRows + preview.summary.pendingRelationRows + preview.summary.errorRows, preview.summary.totalRows);
  assert.equal(preview.summary.dateStart, "2026-07-09");
  assert.equal(preview.summary.dateEnd, "2026-08-09");
  assert.ok(preview.summary.salesAmountCoverage === null || (preview.summary.salesAmountCoverage >= 0 && preview.summary.salesAmountCoverage <= 1));
  assert.ok(preview.summary.profitAmountCoverage === null || (preview.summary.profitAmountCoverage >= 0 && preview.summary.profitAmountCoverage <= 1));

  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
  const sourceSales = rawRows.reduce((sum, row) => sum + Number(row.销售额 || 0), 0);
  const sourceProfit = rawRows.reduce((sum, row) => sum + Number(row.利润 || 0), 0);
  assert.ok(Math.abs(preview.summary.sourceSalesAmount - sourceSales) < 0.0001, "销售额源文件合计不一致");
  assert.ok(Math.abs(preview.summary.sourceProfitAmount - sourceProfit) < 0.0001, "利润源文件合计不一致");
  assert.equal(preview.summary.pendingRelationRows, 2625);
  assert.equal(preview.summary.missingRelationRows, 2625);
  assert.equal(preview.summary.relationConflictRows, 86);
  assert.equal(preview.summary.candidateCount, 1129);
  assert.equal(preview.summary.singleCandidateCount + preview.summary.comboCandidateCount, preview.summary.candidateCount);
  const storedCandidates = database.prepare("SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId=?").all(preview.batch.id);
  assert.equal(storedCandidates.length, preview.summary.candidateCount);
  assert.equal(storedCandidates.reduce((sum, item) => sum + item.affectedRowCount, 0), preview.summary.pendingRelationRows);
  const pendingAmounts = database.prepare(`SELECT SUM(CAST(json_extract(normalizedDataJson,'$.salesAmount') AS REAL)) salesAmount,SUM(CAST(json_extract(normalizedDataJson,'$.profitAmount') AS REAL)) profitAmount FROM connection_import_rows WHERE batchId=? AND status IN ('pending_relation','missing_relation')`).get(preview.batch.id);
  assert.ok(Math.abs(storedCandidates.reduce((sum, item) => sum + Number(item.salesAmount || 0), 0) - Number(pendingAmounts.salesAmount || 0)) < 0.0001);
  assert.ok(Math.abs(storedCandidates.reduce((sum, item) => sum + Number(item.profitAmount || 0), 0) - Number(pendingAmounts.profitAmount || 0)) < 0.0001);
  const pendingRows = database.prepare("SELECT normalizedDataJson FROM connection_import_rows WHERE batchId=? AND status IN ('pending_relation','missing_relation')").all(preview.batch.id).map((row) => JSON.parse(row.normalizedDataJson));
  const comboSkuDates = new Set(); const skuDateErps = new Map();
  for (const row of pendingRows) { const key = `${row.salesLinkSkuId}|${row.saleDate}`; const values = skuDateErps.get(key) || new Set(); values.add(row.erpSkuId); skuDateErps.set(key, values); }
  for (const [key, values] of skuDateErps) if (values.size > 1) comboSkuDates.add(key);
  for (const candidate of storedCandidates) {
    const candidateRows = pendingRows.filter((row) => row.salesLinkSkuId === candidate.salesLinkSkuId && row.erpSkuId === candidate.erpSkuId);
    const expectedType = candidateRows.some((row) => comboSkuDates.has(`${row.salesLinkSkuId}|${row.saleDate}`)) ? "combo" : "single";
    assert.equal(candidate.candidateType, expectedType, "single/combo分类不符合平台SKU+日期的多ERP规则");
    const evidence = JSON.parse(candidate.evidenceJson);
    assert.equal(evidence.shop.shopId.length > 0, true); assert.equal(evidence.link.salesLinkId.length > 0, true);
    assert.equal(evidence.platformSku.salesLinkSkuId, candidate.salesLinkSkuId); assert.equal(evidence.erpSku.erpSkuId, candidate.erpSkuId);
    assert.equal(evidence.source.batchId, preview.batch.id); assert.equal(evidence.source.fileHash, preview.summary.sourceFileHash);
  }
  const candidateQuery = querySalesRelationCandidates({ sourceBatchId: preview.batch.id, status: "pending", page: 1, pageSize: 50 });
  assert.equal(candidateQuery.summary.total, preview.summary.candidateCount);
  assert.equal(candidateQuery.summary.affectedRows, preview.summary.pendingRelationRows);
  assert.equal(candidateQuery.items.length, 50);
  const candidateDetail = readSalesRelationCandidate(candidateQuery.items[0].id);
  assert.equal(candidateDetail.sourceRows.length, candidateQuery.items[0].affectedRowCount);

  const categorySummaryFields = { ready: "readyRows", pending_relation: "pendingConfirmedRows", missing_relation: "missingRelationRows", relation_conflict: "relationConflictRows", error: "identityErrorRows" };
  for (const category of Object.keys(categorySummaryFields)) {
    const detail = readSalesDailyFactPreview(preview.batch.id, { category, page: 1, pageSize: 20 });
    assert.equal(detail.pagination.total, preview.summary[categorySummaryFields[category]]);
    assert.ok(detail.rows.every((row) => row.category === category));
  }

  const second = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
  assert.equal(second.idempotent, true);
  assert.equal(second.batch.id, preview.batch.id);
  const after = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
    mappings: count(database, "sales_link_sku_erp_mappings"),
    links: count(database, "sales_links"),
    linkSkus: count(database, "sales_link_skus"),
    erpSkus: count(database, "erp_skus"),
    batches: count(database, "connection_import_batches"),
    candidates: count(database, "sales_link_sku_erp_mapping_candidates"),
  };
  assert.equal(after.dailyFacts, before.dailyFacts, "预览禁止创建日报事实");
  assert.equal(after.periodFacts, before.periodFacts, "预览禁止修改旧销售事实");
  assert.equal(after.mappings, before.mappings, "预览禁止修改V2映射");
  assert.equal(after.links, before.links, "预览禁止修改链接");
  assert.equal(after.linkSkus, before.linkSkus, "预览禁止修改平台SKU");
  assert.equal(after.erpSkus, before.erpSkus, "预览禁止修改ERP SKU");
  assert.equal(after.batches, before.batches + 1, "相同文件重复预览不得重复创建批次");
  assert.equal(after.candidates, before.candidates + preview.summary.candidateCount, "相同文件重复预览不得重复创建候选");

  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert.equal(integrity, "ok");
  assert.equal(foreignKeyErrors.length, 0);
  const report = JSON.stringify({
    success: true,
    isolatedDatabase: databasePath,
    sourceFile: path.basename(sourceFile),
    sourceSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    summary: preview.summary,
    candidateSummary: candidateQuery.summary,
    idempotent: second.idempotent,
    protectedCounts: { before, after },
    integrityCheck: integrity,
    foreignKeyCheckErrors: foreignKeyErrors.length,
  }, null, 2);
  if (process.env.RESULT_PATH) fs.writeFileSync(process.env.RESULT_PATH, `${report}\n`);
  process.stdout.write(`${report}\n`);
} catch (error) {
  if (process.env.RESULT_PATH) fs.writeFileSync(process.env.RESULT_PATH, `${JSON.stringify({ success: false, message: error.message, stack: error.stack }, null, 2)}\n`);
  throw error;
} finally {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
}
