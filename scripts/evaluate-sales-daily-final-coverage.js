import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
const sourceFile = process.env.SALES_DAILY_FILE;
if (!sourceFile) throw new Error("SALES_DAILY_FILE_required");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-final-coverage-")); const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath); process.env.WUFAN_DB_PATH = databasePath;
const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { evaluateSalesDailyFactCoverage } = await import("../server/salesDailyFactPreviewService.js");
const digest = (db, sql) => crypto.createHash("sha256").update(JSON.stringify(db.prepare(sql).all())).digest("hex");
const fileHash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sum = (items, field) => items.reduce((total, item) => total + Number(item.normalized?.[field] || 0), 0);
try {
  initializeDatabase({ reset: false }); const db = getDatabase(); db.pragma("foreign_keys = ON");
  const batch = db.prepare(`SELECT b.* FROM connection_import_batches b WHERE b.importType='erp_sales_daily_preview'
    AND EXISTS (SELECT 1 FROM connection_import_rows r WHERE r.batchId=b.id) ORDER BY b.createdAt DESC LIMIT 1`).get(); assert.ok(batch);
  const summary = JSON.parse(batch.previewSummaryJson || "{}"); const actualFileHash = fileHash(sourceFile); assert.equal(summary.sourceFileHash, actualFileHash, "原始预览与指定Excel SHA不一致。");
  const protectedBefore = { dailyFacts: Number(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total), periodFacts: Number(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total), periodHash: digest(db, "SELECT * FROM connection_sku_sales_facts ORDER BY id"), mappings: Number(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total), mappingHash: digest(db, "SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), linksHash: digest(db, "SELECT id,shopId,platformGoodsId,currentState FROM sales_links ORDER BY id"), inventoryHash: digest(db, "SELECT * FROM erp_sku_warehouse_inventory_facts ORDER BY id") };
  const evaluation = evaluateSalesDailyFactCoverage(batch.id); const categoriesList = ["ready", "pending_relation", "combo_pending", "relation_conflict", "error"];
  const categories = Object.fromEntries(categoriesList.map((category) => { const rows = evaluation.rows.filter((item) => item.category === category); return [category, { rows: rows.length, salesAmount: sum(rows, "salesAmount"), profitAmount: sum(rows, "profitAmount") }]; }));
  const totals = { rows: evaluation.rows.length, salesAmount: sum(evaluation.rows, "salesAmount"), profitAmount: sum(evaluation.rows, "profitAmount") };
  const reconciliation = { rows: totals.rows - categoriesList.reduce((total, key) => total + categories[key].rows, 0), salesAmount: totals.salesAmount - categoriesList.reduce((total, key) => total + categories[key].salesAmount, 0), profitAmount: totals.profitAmount - categoriesList.reduce((total, key) => total + categories[key].profitAmount, 0) };
  const absolute = (field, rows = evaluation.rows) => rows.reduce((total, item) => total + Math.abs(Number(item.normalized?.[field] || 0)), 0); const ready = evaluation.rows.filter((item) => item.category === "ready");
  const coverage = { salesAmount: absolute("salesAmount") ? absolute("salesAmount", ready) / absolute("salesAmount") : null, profitAmount: absolute("profitAmount") ? absolute("profitAmount", ready) / absolute("profitAmount") : null };
  const relations = { singlePending: evaluation.candidates.filter((item) => item.candidateType === "single").length, comboPending: evaluation.candidates.filter((item) => item.candidateType === "combo").length, allPending: evaluation.candidates.length };
  const errorBreakdown = Object.fromEntries(Object.entries(evaluation.rows.filter((item) => item.category === "error" || item.category === "relation_conflict").reduce((result, item) => { const key = item.errorType || item.category; result[key] = (result[key] || 0) + 1; return result; }, {})).sort(([left], [right]) => left.localeCompare(right)));
  assert.equal(reconciliation.rows, 0); assert.ok(Math.abs(reconciliation.salesAmount) < 0.000001); assert.ok(Math.abs(reconciliation.profitAmount) < 0.000001);
  const protectedAfter = { dailyFacts: Number(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total), periodFacts: Number(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total), periodHash: digest(db, "SELECT * FROM connection_sku_sales_facts ORDER BY id"), mappings: Number(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total), mappingHash: digest(db, "SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), linksHash: digest(db, "SELECT id,shopId,platformGoodsId,currentState FROM sales_links ORDER BY id"), inventoryHash: digest(db, "SELECT * FROM erp_sku_warehouse_inventory_facts ORDER BY id") }; assert.deepEqual(protectedAfter, protectedBefore); assert.equal(protectedAfter.dailyFacts, 0);
  const integrity = db.pragma("integrity_check", { simple: true }); const foreignKeys = db.pragma("foreign_key_check"); assert.equal(integrity, "ok"); assert.equal(foreignKeys.length, 0);
  const report = { success: true, sourceFile: path.basename(sourceFile), sourceFileSha256: actualFileHash, sourceDatabase: sourceDb, batchId: batch.id, dateRange: { start: summary.dateStart, end: summary.dateEnd }, currentMappings: { activeBySource: db.prepare("SELECT mappingType,sourceType,COUNT(*) count FROM sales_link_sku_erp_mappings WHERE currentState='active' GROUP BY mappingType,sourceType ORDER BY mappingType,sourceType").all(), workflowConfirmedSingle: Number(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE mappingType='single' AND currentState='active' AND sourceType='sales_relation_confirmation'").get().total), workflowConfirmedCombo: Number(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE mappingType='combo' AND currentState='active' AND sourceType='sales_relation_confirmation'").get().total) }, totals, categories, pendingRelations: relations, errorBreakdown, coverage, reconciliationDifference: reconciliation, protected: protectedAfter, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeys.length };
  fs.writeFileSync("/private/tmp/sales-daily-final-coverage.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
