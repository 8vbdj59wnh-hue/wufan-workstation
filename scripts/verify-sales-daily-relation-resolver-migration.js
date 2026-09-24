import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDatabase = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
const sourceFile = process.env.SALES_DAILY_FILE;
if (!sourceFile) throw new Error("SALES_DAILY_FILE_required");
if (!fs.existsSync(sourceDatabase)) throw new Error(`隔离验证源数据库不存在：${sourceDatabase}`);
if (!fs.existsSync(sourceFile)) throw new Error(`真实销售日报不存在：${sourceFile}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sales-daily-relation-resolver-migration-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDatabase, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase } = await import("../server/db.js");
const {
  previewSalesDailyFacts, classifySalesDailyPreviewRows, classifyResolvedRelationForSalesDaily,
} = await import("../server/salesDailyFactPreviewService.js");
initializeDatabase();
const database = getDatabase();
const IMPORT_TYPE = "erp_sales_daily_preview";

database.transaction(() => {
  database.prepare("DELETE FROM sales_link_sku_combo_group_components WHERE comboGroupId IN (SELECT id FROM sales_link_sku_combo_groups WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?))").run(IMPORT_TYPE);
  database.prepare("DELETE FROM sales_link_sku_combo_groups WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run(IMPORT_TYPE);
  database.prepare("DELETE FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run(IMPORT_TYPE);
  database.prepare("DELETE FROM connection_import_rows WHERE batchId IN (SELECT id FROM connection_import_batches WHERE importType=?)").run(IMPORT_TYPE);
  database.prepare("DELETE FROM connection_import_batches WHERE importType=?").run(IMPORT_TYPE);
})();

const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const protectedCounts = () => ({
  dailyFacts: count("connection_sku_sales_daily_facts"), periodFacts: count("connection_sku_sales_facts"),
  mappings: count("sales_link_sku_erp_mappings"), comboGroups: count("sales_link_sku_combo_groups"),
  links: count("sales_links"), linkSkus: count("sales_link_skus"), erpSkus: count("erp_skus"), products: count("products"),
});
const before = protectedCounts();
const buffer = fs.readFileSync(sourceFile);
const preview = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
assert.equal(preview.summary.totalRows, 11826);

const storedRows = database.prepare("SELECT rowNumber,rawDataJson,normalizedDataJson,status,errorType FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(preview.batch.id).map((row) => ({
  ...row, raw: JSON.parse(row.rawDataJson), normalized: JSON.parse(row.normalizedDataJson),
}));
const oldCounts = { ready: 0, pending_relation: 0, error: 0 };
const newCounts = { ready: 0, pending_relation: 0, missing_relation: 0, relation_conflict: 0, error: 0 };
const differences = new Map();
let sameCount = 0;
const exactMapping = database.prepare("SELECT 1 FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND erpSkuId=? AND currentState='active' LIMIT 1");
for (const row of storedRows) {
  const newCategory = row.status;
  newCounts[newCategory] += 1;
  const hasIdentity = row.normalized.salesLinkSkuId && row.normalized.erpSkuId;
  const oldCategory = row.errorType && !hasIdentity ? "error" : exactMapping.get(row.normalized.salesLinkSkuId, row.normalized.erpSkuId) ? "ready" : "pending_relation";
  oldCounts[oldCategory] += 1;
  if (oldCategory === newCategory) sameCount += 1;
  else {
    const reason = oldCategory === "pending_relation" && newCategory === "relation_conflict"
      ? "旧逻辑只检查目标mapping缺失；统一解析发现链接SKU已有完整关系但目标ERP不在关系集合中"
      : oldCategory === "pending_relation" && newCategory === "missing_relation"
        ? "旧逻辑将所有无精确mapping行归为pending；统一解析明确区分无治理记录的missing"
        : "数据模型分类差异";
    const key = `${oldCategory}->${newCategory}|${reason}`;
    differences.set(key, { oldCategory, newCategory, reason, count: (differences.get(key)?.count || 0) + 1 });
  }
}
assert.equal(sameCount + [...differences.values()].reduce((sum, item) => sum + item.count, 0), storedRows.length);
assert.deepEqual(oldCounts, { ready: 9058, pending_relation: 2711, error: 57 });
assert.deepEqual(newCounts, { ready: 9058, pending_relation: 0, missing_relation: 2625, relation_conflict: 86, error: 57 });

let relationSqlCount = 0;
const cache = {
  shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(),
  dailyFactKeys: new Set(database.prepare("SELECT salesLinkSkuId,erpSkuId,saleDate FROM connection_sku_sales_daily_facts").all().map((row) => `${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`)),
};
const started = process.hrtime.bigint();
const repeatedClassification = classifySalesDailyPreviewRows(database, storedRows.map((row) => ({ rowNumber: row.rowNumber, raw: row.raw, normalized: row.normalized })), {
  cache, onRelationQuery: () => { relationSqlCount += 1; },
});
const relationValidationMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.equal(repeatedClassification.length, 11826);
assert.ok(relationSqlCount <= 6, `统一关系解析SQL超过6次：${relationSqlCount}`);

const identityItem = { result: { category: "identity_ready", erpSku: { id: "erp-target" } } };
const relationCases = {
  single: { relationStatus: "active_complete", isUsable: true, relationshipShape: "single_unit", mappings: [{ mappingId: "m1", erpSkuId: "erp-target" }] },
  singleMultiQuantity: { relationStatus: "active_complete", isUsable: true, relationshipShape: "single_multi_quantity", mappings: [{ mappingId: "m2", erpSkuId: "erp-target", quantity: 5 }] },
  multiComponent: { relationStatus: "active_complete", isUsable: true, relationshipShape: "multi_component", mappings: [{ mappingId: "m3", erpSkuId: "erp-target" }, { mappingId: "m4", erpSkuId: "erp-other" }] },
  pending: { relationStatus: "pending", isUsable: false, mappings: [] },
  comboConflict: { relationStatus: "conflict", isUsable: false, relationshipShape: "multi_component", mappings: [], conflicts: [{ code: "combo_group_incomplete", message: "Combo关系不完整" }] },
  missing: { relationStatus: "missing", isUsable: false, mappings: [] },
};
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.single).result.category, "ready");
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.singleMultiQuantity).result.category, "ready");
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.multiComponent).result.category, "ready");
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.pending).result.category, "pending_relation");
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.comboConflict).result.category, "relation_conflict");
assert.equal(classifyResolvedRelationForSalesDaily(identityItem, relationCases.missing).result.category, "missing_relation");
assert.equal(classifyResolvedRelationForSalesDaily({ result: { category: "error", errorType: "missing_field" } }, relationCases.single).result.category, "error");

const second = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
assert.equal(second.idempotent, true);
assert.equal(second.batch.id, preview.batch.id);
const after = protectedCounts();
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
const foreignKeyErrors = database.pragma("foreign_key_check");
assert.deepEqual(foreignKeyErrors, []);

console.log(JSON.stringify({
  success: true,
  sourceFile: path.basename(sourceFile),
  sourceFileSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  totalRows: storedRows.length,
  oldCounts,
  newCounts,
  sameCount,
  differenceCount: storedRows.length - sameCount,
  differences: [...differences.values()],
  performance: { uniqueSalesLinkSkuIds: new Set(storedRows.map((row) => row.normalized.salesLinkSkuId).filter(Boolean)).size, relationSqlCount, relationValidationMs: Number(relationValidationMs.toFixed(3)) },
  protectedBefore: before,
  protectedAfter: after,
  idempotentPreview: true,
  integrityCheck: "ok",
  foreignKeyCheckErrors: foreignKeyErrors.length,
}, null, 2));
database.close();
