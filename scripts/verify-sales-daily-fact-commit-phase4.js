import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = process.env.SOURCE_DB || "/private/var/folders/g0/xgk8_zrn415b60zcqfw3tnxh0000gn/T/sales-daily-relation-resolver-migration-lQmbDv/isolated.db";
assert.ok(fs.existsSync(source));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-daily-phase4-"));
const target = path.join(directory, "isolated.db"); fs.copyFileSync(source, target); process.env.WUFAN_DB_PATH = target;
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { confirmErpSkuBusinessUsage } = await import("../server/capabilities/resolveErpSkuBusinessUsage.js");
const { commitSalesDailyFacts, evaluateSalesDailyFactCoverage } = await import("../server/salesDailyFactPreviewService.js");
initializeDatabase(); const database = getDatabase();
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const digest = (sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const reviewer = database.prepare("SELECT id,name FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
const batch = database.prepare("SELECT * FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC LIMIT 1").get();
assert.ok(batch && reviewer);

// Explicit test fixtures: usages are manually confirmed in the isolated copy.
const coverage = evaluateSalesDailyFactCoverage(batch.id);
const normalRow = coverage.rows.find((row) => row.category === "ready" && row.identity.erpSkuId);
assert.ok(normalRow);
confirmErpSkuBusinessUsage({ erpSkuId: normalRow.identity.erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: "Phase 4隔离验证：人工确认商品用途。" }, { database });
for (const category of ["missing_relation", "relation_conflict"]) {
  const row = coverage.rows.find((item) => item.category === category && item.identity.erpSkuId);
  if (row) {
    confirmErpSkuBusinessUsage({ erpSkuId: row.identity.erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: `Phase 4隔离验证：确认${category}行的ERP用途，以单独验证关系阻断。` }, { database });
    if (category === "missing_relation") database.prepare("DELETE FROM sales_link_sku_erp_mapping_candidates WHERE salesLinkSkuId=?").run(row.identity.salesLinkSkuId);
  }
}
for (const [code, usageType] of [["0016", "accounting_auxiliary"], ["0013", "shipping_adjustment"]]) {
  const sku = database.prepare("SELECT id FROM erp_skus WHERE merchantSkuCode=? COLLATE NOCASE").get(code);
  if (sku) confirmErpSkuBusinessUsage({ erpSkuId: sku.id, usageType, reviewedBy: reviewer.id, decisionNote: `Phase 4隔离验证：人工确认${code}用途。` }, { database });
}

// Build one complete approved Combo fixture from real-file Combo candidates.
const multi = database.prepare(`SELECT salesLinkSkuId,COUNT(DISTINCT erpSkuId) count FROM sales_link_sku_erp_mapping_candidates
  WHERE candidateType='combo' GROUP BY salesLinkSkuId HAVING COUNT(DISTINCT erpSkuId)>1 ORDER BY count,salesLinkSkuId LIMIT 1`).get();
let comboGroupId = null;
if (multi) {
  const candidateComponents = database.prepare("SELECT DISTINCT erpSkuId FROM sales_link_sku_erp_mapping_candidates WHERE salesLinkSkuId=? AND candidateType='combo' ORDER BY erpSkuId").all(multi.salesLinkSkuId);
  comboGroupId = `phase4-combo-${crypto.randomUUID()}`; const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO sales_link_sku_combo_groups
    (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,reviewedBy,reviewedAt,reviewNote,approvedAt,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,'pending','sales_relation_confirmation','[]',NULL,NULL,?,NULL,?,?,?)`).run(comboGroupId, multi.salesLinkSkuId, `PHASE4-${crypto.randomUUID()}`, "Phase 4完整Combo隔离测试夹具", reviewer.id, timestamp, timestamp);
  const insertComponent = database.prepare(`INSERT INTO sales_link_sku_combo_group_components
    (id,comboGroupId,erpSkuId,quantity,quantitySource,sourceType,sortOrder,status,decisionNote,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'manual_added',?,'included',?,?,?)`);
  candidateComponents.forEach((component, index) => {
    insertComponent.run(`phase4-component-${crypto.randomUUID()}`, comboGroupId, component.erpSkuId, 1, "manual_confirmation", index + 1, "Phase 4完整Combo隔离测试夹具", timestamp, timestamp);
    database.prepare(`INSERT INTO sales_link_sku_erp_mappings
      (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt)
      VALUES (?,?,?,'combo',1,'active','sales_relation_confirmation',?,?,?)
      ON CONFLICT(salesLinkSkuId,erpSkuId) DO UPDATE SET mappingType='combo',quantity=1,currentState='active',sourceType='sales_relation_confirmation',comboGroupId=excluded.comboGroupId,updatedAt=excluded.updatedAt`)
      .run(`phase4-mapping-${crypto.randomUUID()}`, multi.salesLinkSkuId, component.erpSkuId, comboGroupId, timestamp, timestamp);
    confirmErpSkuBusinessUsage({ erpSkuId: component.erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: "Phase 4隔离验证：人工确认Combo组件为商品用途。" }, { database });
  });
  database.prepare("UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy=?,reviewedAt=?,approvedAt=?,updatedAt=? WHERE id=?").run(reviewer.id, timestamp, timestamp, timestamp, comboGroupId);
}

// A second real-file Combo candidate is intentionally left incomplete.
const incomplete = database.prepare(`SELECT salesLinkSkuId,COUNT(DISTINCT erpSkuId) count FROM sales_link_sku_erp_mapping_candidates
  WHERE candidateType='combo' AND salesLinkSkuId<>? GROUP BY salesLinkSkuId HAVING COUNT(DISTINCT erpSkuId)>1 ORDER BY count,salesLinkSkuId LIMIT 1`).get(multi?.salesLinkSkuId || "");
if (incomplete) {
  const components = database.prepare("SELECT DISTINCT erpSkuId FROM sales_link_sku_erp_mapping_candidates WHERE salesLinkSkuId=? AND candidateType='combo' ORDER BY erpSkuId").all(incomplete.salesLinkSkuId);
  const groupId = `phase4-incomplete-${crypto.randomUUID()}`; const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO sales_link_sku_combo_groups
    (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,reviewNote,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,'pending','sales_relation_confirmation','[]',?,?,?,?)`).run(groupId, incomplete.salesLinkSkuId, `PHASE4-INCOMPLETE-${crypto.randomUUID()}`, "Phase 4不完整Combo阻断测试", reviewer.id, timestamp, timestamp);
  database.prepare(`INSERT INTO sales_link_sku_combo_group_components
    (id,comboGroupId,erpSkuId,quantity,quantitySource,sourceType,sortOrder,status,decisionNote,createdAt,updatedAt)
    VALUES (?,?,?,1,'manual_confirmation','manual_added',1,'included',?,?,?)`).run(`phase4-incomplete-component-${crypto.randomUUID()}`, groupId, components[0].erpSkuId, "Phase 4不完整Combo阻断测试", timestamp, timestamp);
  database.prepare("UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy=?,reviewedAt=?,approvedAt=?,updatedAt=? WHERE id=?").run(reviewer.id, timestamp, timestamp, timestamp, groupId);
  components.slice(0, 2).forEach((component) => {
    database.prepare(`INSERT INTO sales_link_sku_erp_mappings
      (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,comboGroupId,createdAt,updatedAt)
      VALUES (?,?,?,'combo',1,'active','sales_relation_confirmation',?,?,?)
      ON CONFLICT(salesLinkSkuId,erpSkuId) DO UPDATE SET mappingType='combo',quantity=1,currentState='active',sourceType='sales_relation_confirmation',comboGroupId=excluded.comboGroupId,updatedAt=excluded.updatedAt`)
      .run(`phase4-incomplete-mapping-${crypto.randomUUID()}`, incomplete.salesLinkSkuId, component.erpSkuId, groupId, timestamp, timestamp);
    confirmErpSkuBusinessUsage({ erpSkuId: component.erpSkuId, usageType: "product", reviewedBy: reviewer.id, decisionNote: "Phase 4隔离验证：人工确认不完整Combo组件用途。" }, { database });
  });
}

const protectedBefore = {
  mappings: count("sales_link_sku_erp_mappings"), mappingHash: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  comboGroups: count("sales_link_sku_combo_groups"), comboHash: digest("SELECT * FROM sales_link_sku_combo_groups ORDER BY id"),
  erpSkus: count("erp_skus"), erpHash: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: count("erp_sku_business_usages"), usageHash: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"),
};

function clonePreview(sourceBatch, suffix) {
  const id = `phase4-preview-${suffix}-${crypto.randomUUID()}`; const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,previewSummaryJson)
    SELECT ?,sourceType,externalShopId,fileName,fileHash||?,businessDate,periodStart,periodEnd,periodType,'preview_ready',totalRows,matchedRows,pendingRows,errorRows,createdBy,?,?,importType,previewSummaryJson FROM connection_import_batches WHERE id=?`)
    .run(id, `:${suffix}`, timestamp, timestamp, sourceBatch.id);
  database.prepare(`INSERT INTO connection_import_rows (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt)
    SELECT 'phase4-row-'||?||'-'||id,?,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,? FROM connection_import_rows WHERE batchId=?`).run(suffix, id, timestamp, sourceBatch.id);
  database.prepare("UPDATE connection_import_batches SET previewSummaryJson=? WHERE id=?").run(sourceBatch.previewSummaryJson, id);
  return id;
}

const rollbackBatchId = clonePreview(batch, "rollback");
assert.throws(() => commitSalesDailyFacts(rollbackBatchId, { confirmedBy: reviewer.id, database, failAfterInserts: 1 }), /TEST_TRANSACTION_ROLLBACK/);
assert.equal(count("connection_sku_sales_daily_facts"), 0, "事务失败必须回滚全部日报事实");
assert.equal(database.prepare("SELECT status FROM connection_import_batches WHERE id=?").get(rollbackBatchId).status, "preview_ready");

const first = commitSalesDailyFacts(batch.id, { confirmedBy: reviewer.id, database });
assert.ok(first.result.insertedCount > 0, "人工确认用途且关系完整的商品行必须写入");
assert.equal(first.result.insertedCount, count("connection_sku_sales_daily_facts"));
assert.ok((first.result.blockedCounts.accounting_auxiliary || 0) > 0, "辅助核算不得写入商品事实");
assert.ok((first.result.blockedCounts.shipping_adjustment || 0) > 0, "邮费调整不得写入商品事实");
assert.ok((first.result.blockedCounts.unknown || 0) > 0, "未知用途必须阻断");
assert.ok((first.result.blockedCounts.missing_relation || 0) + (first.result.blockedCounts.pending_relation || 0) > 0, "缺失或待确认关系必须阻断");
assert.ok((first.result.blockedCounts.relation_conflict || 0) > 0, "不完整Combo关系必须按冲突阻断");
assert.ok(Math.abs(first.result.insertedSalesAmount - first.result.eligibleSalesAmount) < 1e-6);
assert.ok(Math.abs(first.result.insertedProfitAmount - first.result.eligibleProfitAmount) < 1e-6);
if (comboGroupId) assert.ok(database.prepare("SELECT 1 FROM connection_sku_sales_daily_facts WHERE factType='combo_component' LIMIT 1").get(), "完整Combo应写入组件事实");

const repeated = commitSalesDailyFacts(batch.id, { confirmedBy: reviewer.id, database });
assert.equal(repeated.result.idempotent, true); assert.equal(count("connection_sku_sales_daily_facts"), first.result.insertedCount);
const skipBatchId = clonePreview(batch, "skip");
const skipped = commitSalesDailyFacts(skipBatchId, { confirmedBy: reviewer.id, database });
assert.equal(skipped.result.insertedCount, 0); assert.equal(skipped.result.skippedCount, first.result.insertedCount);

const altered = database.prepare("SELECT id,salesAmount FROM connection_sku_sales_daily_facts ORDER BY id LIMIT 1").get();
database.prepare("UPDATE connection_sku_sales_daily_facts SET salesAmount=? WHERE id=?").run(Number(altered.salesAmount || 0) + 1, altered.id);
const conflictBatchId = clonePreview(batch, "conflict");
const conflict = commitSalesDailyFacts(conflictBatchId, { confirmedBy: reviewer.id, database });
assert.equal(conflict.result.updatePendingCount, 1); assert.equal(database.prepare("SELECT salesAmount FROM connection_sku_sales_daily_facts WHERE id=?").get(altered.id).salesAmount, Number(altered.salesAmount || 0) + 1, "差异事实禁止静默覆盖");
database.prepare("UPDATE connection_sku_sales_daily_facts SET salesAmount=? WHERE id=?").run(altered.salesAmount, altered.id);

const protectedAfter = {
  mappings: count("sales_link_sku_erp_mappings"), mappingHash: digest("SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"),
  comboGroups: count("sales_link_sku_combo_groups"), comboHash: digest("SELECT * FROM sales_link_sku_combo_groups ORDER BY id"),
  erpSkus: count("erp_skus"), erpHash: digest("SELECT * FROM erp_skus ORDER BY id"),
  usages: count("erp_sku_business_usages"), usageHash: digest("SELECT * FROM erp_sku_business_usages ORDER BY id"),
};
assert.deepEqual(protectedAfter, protectedBefore, "事实提交不得修改关系、Combo、ERP SKU或用途治理记录");
assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, isolatedDatabase: target, sourceBatchId: batch.id, first: first.result, repeatedIdempotent: repeated.result.idempotent, skip: { skippedCount: skipped.result.skippedCount }, updatePending: { count: conflict.result.updatePendingCount }, transactionRollback: true, comboFactVerified: Boolean(comboGroupId), protectedBefore, protectedAfter, integrity: "ok", foreignKeyErrors: 0 }, null, 2));
closeDatabase();
