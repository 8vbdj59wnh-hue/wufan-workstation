import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-combo-draft-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath); process.env.WUFAN_DB_PATH = databasePath;
const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { generatePendingComboGroups, readComboReviewGroup, saveComboReviewDraft, searchComboReviewErpSkus } = await import("../server/salesComboReviewService.js");
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
const hash = (db, sql) => crypto.createHash("sha256").update(JSON.stringify(db.prepare(sql).all())).digest("hex");

try {
  initializeDatabase({ reset: false }); const db = getDatabase(); db.pragma("foreign_keys = ON");
  const batch = db.prepare(`SELECT sourceBatchId id,COUNT(*) total FROM sales_link_sku_erp_mapping_candidates
    WHERE candidateType='combo' AND status='pending' GROUP BY sourceBatchId HAVING total=938 LIMIT 1`).get();
  assert.ok(batch, "缺少938条Combo候选来源批次。");
  const reviewerId = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get()?.id;
  generatePendingComboGroups(batch.id, { createdBy: reviewerId });
  const group = db.prepare(`SELECT g.id FROM sales_link_sku_combo_groups g
    WHERE g.sourceBatchId=? AND g.status='pending' AND (SELECT COUNT(*) FROM sales_link_sku_combo_group_components c WHERE c.comboGroupId=g.id)=2 LIMIT 1`).get(batch.id);
  assert.ok(group);
  const protectedBefore = {
    mappings: count(db, "sales_link_sku_erp_mappings"), dailyFacts: count(db, "connection_sku_sales_daily_facts"), periodFacts: count(db, "connection_sku_sales_facts"),
    links: count(db, "sales_links"), linkSkus: count(db, "sales_link_skus"), erpSkus: count(db, "erp_skus"), products: count(db, "products"),
    mappingHash: hash(db, "SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), legacyHash: hash(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id"),
  };
  const initial = readComboReviewGroup(group.id); assert.equal(initial.item.status, "pending"); assert.ok(initial.components.every((item) => item.quantity === null));
  const payload = () => ({ reviewNote: "人工复核草稿", components: readComboReviewGroup(group.id).components.map((item) => ({ erpSkuId: item.erpSku.id, quantity: item.quantity, status: item.status })) });

  const emptySave = saveComboReviewDraft(group.id, payload(), { reviewedBy: reviewerId }); assert.equal(emptySave.changed, true);
  assert.ok(readComboReviewGroup(group.id).components.every((item) => item.quantity === null));
  const withQuantity = payload(); withQuantity.components[0].quantity = 1; withQuantity.components[1].quantity = 2.5;
  saveComboReviewDraft(group.id, withQuantity, { reviewedBy: reviewerId });
  const quantities = db.prepare("SELECT quantity,quantitySource FROM sales_link_sku_combo_group_components WHERE comboGroupId=? ORDER BY sortOrder").all(group.id);
  assert.deepEqual(quantities, [{ quantity: 1, quantitySource: "manual_confirmation" }, { quantity: 2.5, quantitySource: "manual_confirmation" }]);
  for (const invalid of [0, -1, "not-a-number"]) {
    const bad = structuredClone(withQuantity); bad.components[0].quantity = invalid;
    assert.throws(() => saveComboReviewDraft(group.id, bad, {}), /数量必须为空或大于0/);
  }
  const excluded = structuredClone(withQuantity); excluded.components[1].status = "excluded";
  saveComboReviewDraft(group.id, excluded, { reviewedBy: reviewerId });
  assert.equal(db.prepare("SELECT status FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND erpSkuId=?").get(group.id, excluded.components[1].erpSkuId).status, "excluded");

  const manualErp = db.prepare(`SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active' AND id NOT IN
    (SELECT erpSkuId FROM sales_link_sku_combo_group_components WHERE comboGroupId=?) ORDER BY merchantSkuCode LIMIT 1`).get(group.id);
  assert.ok(manualErp); const added = structuredClone(excluded); added.components.push({ erpSkuId: manualErp.id, quantity: null, status: "included" });
  const addResult = saveComboReviewDraft(group.id, added, { reviewedBy: reviewerId }); assert.equal(addResult.addedComponents, 1);
  const manualRow = db.prepare("SELECT * FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND erpSkuId=?").get(group.id, manualErp.id);
  assert.equal(manualRow.sourceType, "manual_added"); assert.equal(manualRow.sourceCandidateId, null); assert.equal(manualRow.quantity, null); assert.equal(manualRow.quantitySource, null);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND sourceType='sales_daily_preview'").get(group.id).total, 2);
  const beforeRepeat = db.prepare("SELECT updatedAt FROM sales_link_sku_combo_groups WHERE id=?").get(group.id).updatedAt;
  const repeat = saveComboReviewDraft(group.id, added, { reviewedBy: reviewerId }); assert.equal(repeat.idempotent, true); assert.equal(repeat.changed, false);
  assert.equal(db.prepare("SELECT updatedAt FROM sales_link_sku_combo_groups WHERE id=?").get(group.id).updatedAt, beforeRepeat);
  assert.equal(db.prepare("SELECT status FROM sales_link_sku_combo_groups WHERE id=?").get(group.id).status, "pending");
  const search = searchComboReviewErpSkus(manualErp.merchantSkuCode, { limit: 10 }); assert.ok(search.some((item) => item.id === manualErp.id)); assert.ok(search.every((item) => item.currentState === "active"));

  const protectedAfter = {
    mappings: count(db, "sales_link_sku_erp_mappings"), dailyFacts: count(db, "connection_sku_sales_daily_facts"), periodFacts: count(db, "connection_sku_sales_facts"),
    links: count(db, "sales_links"), linkSkus: count(db, "sales_link_skus"), erpSkus: count(db, "erp_skus"), products: count(db, "products"),
    mappingHash: hash(db, "SELECT * FROM sales_link_sku_erp_mappings ORDER BY id"), legacyHash: hash(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id"),
  };
  assert.deepEqual(protectedAfter, protectedBefore); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_combo_groups WHERE status='approved'").get().total, 0);
  const integrity = db.pragma("integrity_check", { simple: true }); const foreignKeys = db.pragma("foreign_key_check"); assert.equal(integrity, "ok"); assert.equal(foreignKeys.length, 0);
  const report = { success: true, isolatedDatabase: databasePath, groupId: group.id, tests: { emptyQuantitySaved: true, manualQuantitySaved: true, invalidQuantityRejected: true, componentExcluded: true, componentAdded: true, repeatSaveIdempotent: true, groupRemainsPending: true, erpSearch: true }, protected: protectedAfter, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeys.length };
  fs.writeFileSync("/private/tmp/combo-draft-verification.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
} finally { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); }
