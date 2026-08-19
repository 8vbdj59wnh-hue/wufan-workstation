import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";

const databasePath = path.resolve(process.argv[2] || "");
assert(databasePath, "请提供隔离数据库路径");
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { ensureSingleLinkSkuErpMapping } = await import("../server/linkSkuErpMappingService.js");
const { applyApprovedProductStructureApplication, reviewProductStructureApplicationItem } = await import("../server/productStructureApplicationApprovalService.js");
const { resolveLinkSkuRelationForRead } = await import("../server/capabilities/resolveLinkSkuRelationRead.js");
const { updatePlatformSkuManualBinding } = await import("../server/productV2Import.js");

const count = (database, table, where = "") => Number(database.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total);
const snapshot = (database) => ({
  dailyFacts: count(database, "connection_sku_sales_daily_facts"),
  legacyMappings: count(database, "sales_link_sku_erp_mappings"),
  legacyProductStructures: count(database, "sales_link_sku_product_structures"),
  legacyProductStructureComponents: count(database, "sales_link_sku_product_structure_components"),
  legacyManualBindings: count(database, "platform_sku_manual_bindings"),
  salesObjects: count(database, "sales_objects"),
  salesObjectRelations: count(database, "sales_link_sku_sales_object_relations"),
  salesObjectStructures: count(database, "sales_object_structures"),
  salesObjectComponents: count(database, "sales_object_structure_components"),
});

try {
  initializeDatabase({ reset: false });
  const database = getDatabase();
  database.pragma("foreign_keys=ON");
  const now = new Date().toISOString();
  const suffix = crypto.randomUUID();
  const link = database.prepare("SELECT id FROM sales_links WHERE currentState='active' ORDER BY id LIMIT 1").get();
  const erpSku = database.prepare("SELECT id FROM erp_skus WHERE currentState='active' ORDER BY id LIMIT 1").get();
  const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
  assert(link && erpSku && reviewer, "隔离库缺少关系写入验证基础身份");
  const insertLinkSku = database.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt)
    VALUES (?,?,?,?, 'pending','active',?,?)`);
  const appliedLinkSkuId = `phase3-link-sku-${suffix}`;
  const rollbackLinkSkuId = `phase3-rollback-link-sku-${suffix}`;
  const manualLinkSkuId = `phase3-manual-link-sku-${suffix}`;
  insertLinkSku.run(appliedLinkSkuId, link.id, `phase3-platform-${suffix}`, `PHASE3-${suffix}`, now, now);
  insertLinkSku.run(rollbackLinkSkuId, link.id, `phase3-rollback-platform-${suffix}`, `PHASE3-ROLLBACK-${suffix}`, now, now);
  insertLinkSku.run(manualLinkSkuId, link.id, `phase3-manual-platform-${suffix}`, `PHASE3-MANUAL-${suffix}`, now, now);

  const before = snapshot(database);
  const proposal = ensureSingleLinkSkuErpMapping(database, {
    salesLinkSkuId: appliedLinkSkuId,
    erpSkuId: erpSku.id,
    sourceType: "phase3_verification",
    sourceBatchId: `phase3-source-${suffix}`,
    timestamp: now,
  });
  assert.equal(proposal.outcome, "governance_pending");
  assert.deepEqual(snapshot(database), before, "创建审批不得写入任何运行关系");
  const item = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=?").get(proposal.applicationBatchId);
  assert.equal(item.productStructureId, null);
  reviewProductStructureApplicationItem(item.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "Phase 3隔离验收" }, { database });
  const applied = applyApprovedProductStructureApplication(item.id, { appliedBy: reviewer.id }, { database });
  assert.equal(applied.outcome, "applied");
  assert.equal(applied.generatedMappingCount, 0);
  const afterApply = snapshot(database);
  assert.equal(afterApply.legacyMappings, before.legacyMappings);
  assert.equal(afterApply.legacyProductStructures, before.legacyProductStructures);
  assert.equal(afterApply.legacyProductStructureComponents, before.legacyProductStructureComponents);
  assert.equal(afterApply.legacyManualBindings, before.legacyManualBindings);
  assert.equal(afterApply.dailyFacts, before.dailyFacts);
  assert.equal(afterApply.salesObjects, before.salesObjects + 1);
  assert.equal(afterApply.salesObjectRelations, before.salesObjectRelations + 1);
  assert.equal(afterApply.salesObjectStructures, before.salesObjectStructures + 1);
  assert.equal(afterApply.salesObjectComponents, before.salesObjectComponents + 1);
  const resolved = resolveLinkSkuRelationForRead({ salesLinkSkuId: appliedLinkSkuId }, { database, scope: "linkDetail" });
  assert.equal(resolved.resolverSource, "sales_object");
  assert.equal(resolved.isUsable, true);
  assert.deepEqual(resolved.mappings.map((row) => [row.erpSkuId, row.quantity]), [[erpSku.id, 1]]);
  assert.equal(applyApprovedProductStructureApplication(item.id, { appliedBy: reviewer.id }, { database }).outcome, "idempotent");
  assert.deepEqual(snapshot(database), afterApply, "重复应用必须幂等");

  const rollbackProposal = ensureSingleLinkSkuErpMapping(database, {
    salesLinkSkuId: rollbackLinkSkuId,
    erpSkuId: erpSku.id,
    sourceType: "phase3_verification",
    sourceBatchId: `phase3-rollback-source-${suffix}`,
    timestamp: now,
  });
  const rollbackItem = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=?").get(rollbackProposal.applicationBatchId);
  reviewProductStructureApplicationItem(rollbackItem.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "Phase 3回滚验收" }, { database });
  const beforeRollback = snapshot(database);
  const rolledBack = applyApprovedProductStructureApplication(rollbackItem.id, { appliedBy: reviewer.id, failAfterDeactivate: true }, { database });
  assert.equal(rolledBack.outcome, "rolled_back");
  assert.deepEqual(snapshot(database), beforeRollback);

  const product = database.prepare(`SELECT m.productId
    FROM product_erp_mappings m JOIN erp_skus e ON e.id=m.erpSkuId AND e.currentState='active'
    WHERE m.currentState='active' GROUP BY m.productId HAVING COUNT(DISTINCT m.erpSkuId)=1 ORDER BY m.productId LIMIT 1`).get();
  assert(product, "隔离库缺少可验证的唯一产品ERP关系");
  const beforeManual = snapshot(database);
  const manual = updatePlatformSkuManualBinding(manualLinkSkuId, product.productId, reviewer.id);
  assert.equal(manual.legacyManualBindingCreated, false);
  assert.equal(manual.outcome, "governance_pending");
  assert.equal(snapshot(database).legacyManualBindings, beforeManual.legacyManualBindings);
  assert.equal(snapshot(database).legacyMappings, beforeManual.legacyMappings);

  console.log(JSON.stringify({
    success: true,
    databasePath,
    proposal: { applicationBatchId: proposal.applicationBatchId, productStructureId: item.productStructureId },
    applied,
    resolver: { source: resolved.resolverSource, isUsable: resolved.isUsable, mappings: resolved.mappings },
    idempotent: true,
    rollback: rolledBack,
    manualBinding: manual,
    before,
    afterApply,
    final: snapshot(database),
    integrityCheck: database.pragma("integrity_check", { simple: true }),
    foreignKeyCheckErrors: database.pragma("foreign_key_check").length,
  }, null, 2));
} finally {
  closeDatabase();
}
