import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-sales-daily-preview-source.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sales-relation-confirmation-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { previewSalesDailyFacts, readSalesDailyFactPreview } = await import("../server/salesDailyFactPreviewService.js");
const { confirmSalesRelationCandidate, confirmSalesRelationCandidates } = await import("../server/salesRelationCandidateService.js");
const { hasPermission } = await import("../shared/permissions.js");

const count = (database, table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);

try {
  initializeDatabase();
  const database = getDatabase();
  const buffer = fs.readFileSync(sourceFile);
  const preview = previewSalesDailyFacts({ buffer, fileName: path.basename(sourceFile) });
  const reviewer = database.prepare("SELECT id FROM persons ORDER BY createdAt LIMIT 1").get();
  assert.ok(reviewer?.id, "隔离副本中必须存在可记录的审核人");
  const before = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
    links: count(database, "sales_links"),
    linkSkus: count(database, "sales_link_skus"),
    erpSkus: count(database, "erp_skus"),
    products: count(database, "products"),
    mappings: count(database, "sales_link_sku_erp_mappings"),
  };
  const eligibleSingles = database.prepare(`SELECT c.* FROM sales_link_sku_erp_mapping_candidates c
    WHERE c.sourceBatchId=? AND c.candidateType='single' AND c.status='pending'
      AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=c.salesLinkSkuId AND m.currentState='active')
    ORDER BY c.sourceRowNumber LIMIT 4`).all(preview.batch.id);
  assert.equal(eligibleSingles.length, 4, "需要至少4条无active映射的single候选用于隔离验证");
  const protectedOldFields = database.prepare(`SELECT id,erpSkuId,productId FROM sales_link_skus WHERE id IN (${eligibleSingles.map(() => "?").join(",")}) ORDER BY id`).all(...eligibleSingles.map((item) => item.salesLinkSkuId));

  const one = confirmSalesRelationCandidate(eligibleSingles[0].id, { reviewedBy: reviewer.id });
  assert.equal(one.summary.created, 1);
  const createdMapping = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE id=?").get(one.result.mappingId);
  assert.deepEqual({ mappingType: createdMapping.mappingType, quantity: createdMapping.quantity, sourceType: createdMapping.sourceType, currentState: createdMapping.currentState }, { mappingType: "single", quantity: 1, sourceType: "sales_relation_confirmation", currentState: "active" });
  assert.equal(createdMapping.sourceBatchId, preview.batch.id);
  const approved = database.prepare("SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE id=?").get(eligibleSingles[0].id);
  assert.equal(approved.status, "approved"); assert.equal(approved.reviewedBy, reviewer.id); assert.ok(approved.reviewedAt); assert.equal(approved.mappingId, createdMapping.id);

  const mappingCountAfterOne = count(database, "sales_link_sku_erp_mappings");
  const repeated = confirmSalesRelationCandidate(eligibleSingles[0].id, { reviewedBy: reviewer.id });
  assert.equal(repeated.summary.idempotent, 1); assert.equal(count(database, "sales_link_sku_erp_mappings"), mappingCountAfterOne, "重复点击不得重复写入");

  const batch = confirmSalesRelationCandidates([eligibleSingles[1].id, eligibleSingles[2].id], { reviewedBy: reviewer.id });
  assert.equal(batch.summary.created, 2); assert.equal(batch.summary.conflicts, 0);

  const conflictId = `sales-link-sku-erp-map-test-${crypto.randomUUID()}`; const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,sourceBatchId,createdAt,updatedAt)
    VALUES (?,?,?,'single',1,'active','isolated_conflict_fixture',?,?,?)`).run(conflictId, eligibleSingles[3].salesLinkSkuId, eligibleSingles[3].erpSkuId, preview.batch.id, timestamp, timestamp);
  const conflict = confirmSalesRelationCandidate(eligibleSingles[3].id, { reviewedBy: reviewer.id });
  assert.equal(conflict.summary.conflicts, 1); assert.equal(conflict.result.mappingId, conflictId);
  assert.equal(database.prepare("SELECT status FROM sales_link_sku_erp_mapping_candidates WHERE id=?").get(eligibleSingles[3].id).status, "conflict");

  const combo = database.prepare("SELECT id FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId=? AND candidateType='combo' LIMIT 1").get(preview.batch.id);
  assert.throws(() => confirmSalesRelationCandidate(combo.id, { reviewedBy: reviewer.id }), /组合候选/);
  assert.equal(hasPermission({ role: "user", permissions: {} }, "links.manage") || hasPermission({ role: "user", permissions: {} }, "products.edit"), false);
  const routeSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(routeSource, /sales-relation-candidates\/:id\/confirm", requireLinkManage/);
  assert.match(routeSource, /sales-relation-candidates\/confirm-batch", requireLinkManage/);

  const refreshedPreview = readSalesDailyFactPreview(preview.batch.id, { category: "pending_relation", page: 1, pageSize: 1 });
  assert.equal(refreshedPreview.summary.relationRecalculationRequired, true);
  assert.equal(refreshedPreview.summary.relationConfirmationCount, 2, "单条与批量各生成一次重算标记");
  assert.ok(refreshedPreview.summary.relationLastConfirmedAt);

  const after = {
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
    links: count(database, "sales_links"),
    linkSkus: count(database, "sales_link_skus"),
    erpSkus: count(database, "erp_skus"),
    products: count(database, "products"),
    mappings: count(database, "sales_link_sku_erp_mappings"),
  };
  assert.equal(after.dailyFacts, before.dailyFacts); assert.equal(after.periodFacts, before.periodFacts);
  assert.equal(after.links, before.links); assert.equal(after.linkSkus, before.linkSkus); assert.equal(after.erpSkus, before.erpSkus); assert.equal(after.products, before.products);
  assert.equal(after.mappings, before.mappings + 4, "只允许3条人工确认关系和1条并发冲突测试夹具");
  assert.deepEqual(database.prepare(`SELECT id,erpSkuId,productId FROM sales_link_skus WHERE id IN (${eligibleSingles.map(() => "?").join(",")}) ORDER BY id`).all(...eligibleSingles.map((item) => item.salesLinkSkuId)), protectedOldFields, "旧erpSkuId/productId字段不得修改");
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(database.pragma("foreign_key_check").length, 0);
  process.stdout.write(`${JSON.stringify({ success: true, isolatedDatabase: databasePath, sourceBatchId: preview.batch.id, sourceSha256: crypto.createHash("sha256").update(buffer).digest("hex"), singleConfirmation: one.summary, batchConfirmation: batch.summary, repeatedConfirmation: repeated.summary, conflict: conflict.summary, recalculationRequired: refreshedPreview.summary.relationRecalculationRequired, protectedCounts: { before, after }, integrityCheck: "ok", foreignKeyErrors: 0 }, null, 2)}\n`);
} finally {
  closeDatabase();
}
