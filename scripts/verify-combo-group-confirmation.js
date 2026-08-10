import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-combo-confirm-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db", databasePath); process.env.WUFAN_DB_PATH = databasePath;
const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { confirmComboReviewGroup, generatePendingComboGroups, readComboReviewGroup, saveComboReviewDraft } = await import("../server/salesComboReviewService.js");
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
const digest = (db, sql) => crypto.createHash("sha256").update(JSON.stringify(db.prepare(sql).all())).digest("hex");
const mappingId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

try {
  initializeDatabase({ reset: false }); const db = getDatabase(); db.pragma("foreign_keys = ON");
  const reviewer = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get()?.id; assert.ok(reviewer);
  const batch = db.prepare(`SELECT sourceBatchId id,COUNT(*) total FROM sales_link_sku_erp_mapping_candidates WHERE candidateType='combo' AND status='pending' GROUP BY sourceBatchId HAVING total=938 LIMIT 1`).get(); assert.ok(batch);
  generatePendingComboGroups(batch.id, { createdBy: reviewer });
  const businessBefore = { daily: count(db, "connection_sku_sales_daily_facts"), period: count(db, "connection_sku_sales_facts"), inventoryHash: digest(db, "SELECT * FROM erp_sku_warehouse_inventory_facts ORDER BY id"), inventorySummaryHash: digest(db, "SELECT * FROM erp_sku_inventory_daily_summaries ORDER BY id"), legacyHash: digest(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id") };
  const groups = db.prepare(`SELECT g.id,g.salesLinkSkuId,COUNT(c.id) componentCount FROM sales_link_sku_combo_groups g JOIN sales_link_sku_combo_group_components c ON c.comboGroupId=g.id
    WHERE g.sourceBatchId=? AND g.status='pending' AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=g.salesLinkSkuId)
    GROUP BY g.id ORDER BY componentCount DESC,g.id`).all(batch.id);
  assert.ok(groups.length >= 5);
  const saveAll = (group, { excludeLast = false } = {}) => {
    const detail = readComboReviewGroup(group.id);
    return saveComboReviewDraft(group.id, { reviewNote: "Combo整组人工审核通过", components: detail.components.map((item, index) => ({ erpSkuId: item.erpSku.id, quantity: index + 1, status: excludeLast && index === detail.components.length - 1 ? "excluded" : "included" })) }, { reviewedBy: reviewer });
  };

  const normal = groups.find((item) => item.componentCount >= 3); saveAll(normal, { excludeLast: true });
  const normalBefore = readComboReviewGroup(normal.id); const included = normalBefore.components.filter((item) => item.status === "included"); const excluded = normalBefore.components.filter((item) => item.status === "excluded");
  const confirmed = confirmComboReviewGroup(normal.id, { reviewedBy: reviewer, reviewNote: "已核对完整组合" });
  assert.equal(confirmed.outcome, "created"); assert.equal(confirmed.mappingIds.length, included.length);
  const approvedGroup = db.prepare("SELECT * FROM sales_link_sku_combo_groups WHERE id=?").get(normal.id);
  assert.equal(approvedGroup.status, "approved"); assert.equal(approvedGroup.reviewedBy, reviewer); assert.ok(approvedGroup.reviewedAt); assert.ok(approvedGroup.approvedAt); assert.equal(approvedGroup.reviewNote, "已核对完整组合");
  const mappings = db.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE comboGroupId=? ORDER BY erpSkuId").all(normal.id);
  assert.equal(mappings.length, included.length); assert.ok(mappings.every((item) => item.mappingType === "combo" && item.currentState === "active" && item.sourceType === "sales_relation_confirmation" && item.sourceBatchId === batch.id));
  for (const component of included) { const mapping = mappings.find((item) => item.erpSkuId === component.erpSku.id); assert.equal(Number(mapping.quantity), Number(component.quantity)); }
  for (const component of included.filter((item) => item.id)) { const candidate = db.prepare("SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE id=(SELECT sourceCandidateId FROM sales_link_sku_combo_group_components WHERE id=?)").get(component.id); if (candidate) { assert.equal(candidate.status, "approved"); assert.ok(candidate.reviewedAt); assert.ok(candidate.mappingId); } }
  for (const component of excluded) { const candidate = db.prepare("SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE id=(SELECT sourceCandidateId FROM sales_link_sku_combo_group_components WHERE id=?)").get(component.id); if (candidate) assert.equal(candidate.status, "rejected"); }
  const summary = JSON.parse(db.prepare("SELECT previewSummaryJson FROM connection_import_batches WHERE id=?").get(batch.id).previewSummaryJson); assert.equal(summary.relationRecalculationRequired, true); assert.ok(summary.relationLastConfirmedAt); assert.equal(summary.comboRelationConfirmationCount, 1);
  const repeated = confirmComboReviewGroup(normal.id, { reviewedBy: reviewer }); assert.equal(repeated.outcome, "idempotent"); assert.deepEqual(repeated.mappingIds.sort(), confirmed.mappingIds.sort());

  const unconfirmed = groups.find((item) => item.id !== normal.id); assert.throws(() => confirmComboReviewGroup(unconfirmed.id, { reviewedBy: reviewer }), (error) => error.code === "quantity_unconfirmed");
  assert.equal(db.prepare("SELECT status FROM sales_link_sku_combo_groups WHERE id=?").get(unconfirmed.id).status, "pending");

  const singleConflict = groups.find((item) => ![normal.id, unconfirmed.id].includes(item.id)); saveAll(singleConflict);
  const arbitraryErp = db.prepare("SELECT id FROM erp_skus WHERE currentState='active' AND id NOT IN (SELECT erpSkuId FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=?) LIMIT 1").get(singleConflict.salesLinkSkuId).id;
  const singleMapId = mappingId("test-single"); db.prepare(`INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES (?,?,?,'single',1,'active','verification',datetime('now'),datetime('now'))`).run(singleMapId, singleConflict.salesLinkSkuId, arbitraryErp);
  assert.throws(() => confirmComboReviewGroup(singleConflict.id, { reviewedBy: reviewer }), (error) => error.code === "single_conflict"); db.prepare("DELETE FROM sales_link_sku_erp_mappings WHERE id=?").run(singleMapId);

  const comboConflict = groups.find((item) => ![normal.id, unconfirmed.id, singleConflict.id].includes(item.id)); saveAll(comboConflict);
  const comboErp = db.prepare("SELECT id FROM erp_skus WHERE currentState='active' AND id NOT IN (SELECT erpSkuId FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=?) LIMIT 1").get(comboConflict.salesLinkSkuId).id;
  const comboMapId = mappingId("test-combo"); db.prepare(`INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES (?,?,?,'combo',1,'active','verification',datetime('now'),datetime('now'))`).run(comboMapId, comboConflict.salesLinkSkuId, comboErp);
  assert.throws(() => confirmComboReviewGroup(comboConflict.id, { reviewedBy: reviewer }), (error) => error.code === "active_combo_conflict"); db.prepare("DELETE FROM sales_link_sku_erp_mappings WHERE id=?").run(comboMapId);

  const rollback = groups.find((item) => ![normal.id, unconfirmed.id, singleConflict.id, comboConflict.id].includes(item.id)); saveAll(rollback);
  const rollbackDetail = readComboReviewGroup(rollback.id); const failErp = rollbackDetail.components[1].erpSku.id;
  db.exec(`CREATE TRIGGER verify_combo_rollback BEFORE INSERT ON sales_link_sku_erp_mappings WHEN NEW.comboGroupId='${rollback.id}' AND NEW.erpSkuId='${failErp}' BEGIN SELECT RAISE(ABORT,'forced rollback'); END;`);
  const mappingCountBeforeRollback = count(db, "sales_link_sku_erp_mappings"); assert.throws(() => confirmComboReviewGroup(rollback.id, { reviewedBy: reviewer }), /forced rollback/); db.exec("DROP TRIGGER verify_combo_rollback");
  assert.equal(count(db, "sales_link_sku_erp_mappings"), mappingCountBeforeRollback); assert.equal(db.prepare("SELECT status FROM sales_link_sku_combo_groups WHERE id=?").get(rollback.id).status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mapping_candidates c JOIN sales_link_sku_combo_group_components x ON x.sourceCandidateId=c.id WHERE x.comboGroupId=? AND c.status<>'pending'").get(rollback.id).total, 0);

  const businessAfter = { daily: count(db, "connection_sku_sales_daily_facts"), period: count(db, "connection_sku_sales_facts"), inventoryHash: digest(db, "SELECT * FROM erp_sku_warehouse_inventory_facts ORDER BY id"), inventorySummaryHash: digest(db, "SELECT * FROM erp_sku_inventory_daily_summaries ORDER BY id"), legacyHash: digest(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id") }; assert.deepEqual(businessAfter, businessBefore);
  const integrity = db.pragma("integrity_check", { simple: true }); const foreignKeys = db.pragma("foreign_key_check"); assert.equal(integrity, "ok"); assert.equal(foreignKeys.length, 0);
  const report = { success: true, isolatedDatabase: databasePath, normalConfirmation: { groupId: normal.id, mappings: mappings.length, candidatesApproved: included.length, candidatesRejected: excluded.length }, tests: { normal: true, idempotent: true, unconfirmedQuantityBlocked: true, singleConflictBlocked: true, existingComboBlocked: true, transactionRollback: true, auditComplete: true, previewMarkedForRecalculation: true }, protected: businessAfter, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeys.length };
  fs.writeFileSync("/private/tmp/combo-confirmation-verification.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
