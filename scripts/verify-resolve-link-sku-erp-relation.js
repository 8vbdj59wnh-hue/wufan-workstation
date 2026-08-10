import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveLinkSkuErpRelation, resolveLinkSkuErpRelations } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-link-sku-erp-relation-"));
const databasePath = path.join(root, "isolated.db");
const database = new Database(databasePath);
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE sales_link_skus (id TEXT PRIMARY KEY,salesLinkId TEXT NOT NULL,erpSkuId TEXT,productId TEXT);
  CREATE TABLE erp_skus (id TEXT PRIMARY KEY,currentState TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE sales_link_sku_combo_groups (
    id TEXT PRIMARY KEY,salesLinkSkuId TEXT NOT NULL,status TEXT NOT NULL,sourceType TEXT NOT NULL,
    reviewedBy TEXT,reviewedAt TEXT,approvedAt TEXT,createdAt TEXT NOT NULL
  );
  CREATE TABLE sales_link_sku_erp_mappings (
    id TEXT PRIMARY KEY,salesLinkSkuId TEXT NOT NULL,erpSkuId TEXT NOT NULL,mappingType TEXT NOT NULL,
    quantity REAL NOT NULL,currentState TEXT NOT NULL,sourceType TEXT NOT NULL,sourceBatchId TEXT,
    comboGroupId TEXT
  );
  CREATE TABLE sales_link_sku_combo_group_components (
    id TEXT PRIMARY KEY,comboGroupId TEXT NOT NULL,erpSkuId TEXT NOT NULL,quantity REAL,
    quantitySource TEXT,sortOrder INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL
  );
  CREATE TABLE sales_link_sku_erp_mapping_candidates (
    id TEXT PRIMARY KEY,salesLinkSkuId TEXT NOT NULL,erpSkuId TEXT NOT NULL,candidateType TEXT NOT NULL,
    status TEXT NOT NULL
  );
`);

const insertLinkSku = database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,erpSkuId,productId) VALUES (?,?,'legacy-must-not-be-read','legacy-product')");
const insertErpSku = database.prepare("INSERT INTO erp_skus(id,currentState) VALUES (?,'active')");
const insertMapping = database.prepare("INSERT INTO sales_link_sku_erp_mappings VALUES (?,?,?,?,?,'active',?,?,?)");
const insertGroup = database.prepare("INSERT INTO sales_link_sku_combo_groups VALUES (?,?,?,'sales_relation_confirmation','reviewer','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z')");
const insertComponent = database.prepare("INSERT INTO sales_link_sku_combo_group_components VALUES (?,?,?,?,?,?,'included')");

function addLinkSku(id) { insertLinkSku.run(id, `link-${id}`); }
function addErp(id) { insertErpSku.run(id); }
function resolve(id) { return resolveLinkSkuErpRelation({ salesLinkSkuId: id }, { database }); }
function hasConflict(result, code) { return result.conflicts.some((item) => item.code === code); }

const cases = {};

cases.invalidInput = resolveLinkSkuErpRelation({}, { database });
assert.equal(cases.invalidInput.relationStatus, "invalid_input");

cases.notFound = resolve("missing-link-sku");
assert.equal(cases.notFound.relationStatus, "not_found");

addLinkSku("sku-empty");
cases.missing = resolve("sku-empty");
assert.equal(cases.missing.relationStatus, "missing");

addLinkSku("sku-single-1"); addErp("erp-single-1");
insertMapping.run("map-single-1", "sku-single-1", "erp-single-1", "single", 1, "platform_goods_excel", "batch-1", null);
cases.singleUnit = resolve("sku-single-1");
assert.equal(cases.singleUnit.relationshipShape, "single_unit");
assert.equal(cases.singleUnit.relationStatus, "active_complete");
assert.equal(cases.singleUnit.isUsable, true);
assert.equal(cases.singleUnit.mappings[0].erpSkuId, "erp-single-1");
assert.notEqual(cases.singleUnit.mappings[0].erpSkuId, "legacy-must-not-be-read");

addLinkSku("sku-single-5"); addErp("erp-single-5");
insertMapping.run("map-single-5", "sku-single-5", "erp-single-5", "single", 5, "sales_relation_confirmation", "batch-2", null);
cases.singleMultiQuantity = resolve("sku-single-5");
assert.equal(cases.singleMultiQuantity.relationshipShape, "single_multi_quantity");
assert.equal(cases.singleMultiQuantity.relationStatus, "active_complete");

addLinkSku("sku-combo"); addErp("erp-combo-a"); addErp("erp-combo-b");
insertGroup.run("group-combo", "sku-combo", "approved");
insertComponent.run("component-a", "group-combo", "erp-combo-a", 1, "manual_confirmation", 0);
insertComponent.run("component-b", "group-combo", "erp-combo-b", 3, "manual_confirmation", 1);
insertMapping.run("map-combo-a", "sku-combo", "erp-combo-a", "combo", 1, "sales_relation_confirmation", "batch-3", "group-combo");
insertMapping.run("map-combo-b", "sku-combo", "erp-combo-b", "combo", 3, "sales_relation_confirmation", "batch-3", "group-combo");
cases.multiComponent = resolve("sku-combo");
assert.equal(cases.multiComponent.relationshipShape, "multi_component");
assert.equal(cases.multiComponent.relationStatus, "active_complete");
assert.equal(cases.multiComponent.combo.isConsistent, true);
assert.deepEqual(cases.multiComponent.relationSources, ["sales_relation_confirmation"]);

addLinkSku("sku-combo-incomplete"); addErp("erp-incomplete-a"); addErp("erp-incomplete-b");
insertGroup.run("group-incomplete", "sku-combo-incomplete", "approved");
insertComponent.run("component-incomplete-a", "group-incomplete", "erp-incomplete-a", 1, "manual_confirmation", 0);
insertMapping.run("map-incomplete-a", "sku-combo-incomplete", "erp-incomplete-a", "combo", 1, "sales_relation_confirmation", "batch-4", "group-incomplete");
insertMapping.run("map-incomplete-b", "sku-combo-incomplete", "erp-incomplete-b", "combo", 1, "sales_relation_confirmation", "batch-4", "group-incomplete");
cases.comboIncomplete = resolve("sku-combo-incomplete");
assert.equal(cases.comboIncomplete.relationStatus, "conflict");
assert.equal(hasConflict(cases.comboIncomplete, "combo_group_mismatch"), true);

addLinkSku("sku-single-combo-conflict"); addErp("erp-conflict-a"); addErp("erp-conflict-b");
insertGroup.run("group-conflict", "sku-single-combo-conflict", "approved");
insertComponent.run("component-conflict-a", "group-conflict", "erp-conflict-a", 1, "manual_confirmation", 0);
insertComponent.run("component-conflict-b", "group-conflict", "erp-conflict-b", 1, "manual_confirmation", 1);
insertMapping.run("map-conflict-a", "sku-single-combo-conflict", "erp-conflict-a", "single", 1, "platform_goods_excel", "batch-5", null);
insertMapping.run("map-conflict-b", "sku-single-combo-conflict", "erp-conflict-b", "combo", 1, "sales_relation_confirmation", "batch-5", "group-conflict");
cases.singleComboConflict = resolve("sku-single-combo-conflict");
assert.equal(cases.singleComboConflict.relationStatus, "conflict");
assert.equal(hasConflict(cases.singleComboConflict, "single_combo_active_conflict"), true);

addLinkSku("sku-source-conflict"); addErp("erp-source-a"); addErp("erp-source-b");
insertMapping.run("map-source-a", "sku-source-conflict", "erp-source-a", "combo", 1, "platform_goods_excel", "batch-6", null);
insertMapping.run("map-source-b", "sku-source-conflict", "erp-source-b", "combo", 1, "sales_relation_confirmation", "batch-6", null);
cases.sourceConflict = resolve("sku-source-conflict");
assert.equal(cases.sourceConflict.relationStatus, "conflict");
assert.equal(hasConflict(cases.sourceConflict, "relation_source_conflict"), true);

addLinkSku("sku-missing-erp");
insertMapping.run("map-missing-erp", "sku-missing-erp", "erp-does-not-exist", "single", 1, "legacy_migration", null, null);
cases.erpMissing = resolve("sku-missing-erp");
assert.equal(cases.erpMissing.relationStatus, "conflict");
assert.equal(hasConflict(cases.erpMissing, "erp_sku_missing"), true);

addLinkSku("sku-invalid-quantity"); addErp("erp-invalid-quantity");
insertMapping.run("map-invalid-quantity", "sku-invalid-quantity", "erp-invalid-quantity", "single", 0, "legacy_migration", null, null);
cases.invalidQuantity = resolve("sku-invalid-quantity");
assert.equal(cases.invalidQuantity.relationStatus, "conflict");
assert.equal(hasConflict(cases.invalidQuantity, "invalid_quantity"), true);

addLinkSku("sku-pending"); addErp("erp-pending");
database.prepare("INSERT INTO sales_link_sku_erp_mapping_candidates VALUES (?,?,?,'single','pending')").run("candidate-pending", "sku-pending", "erp-pending");
cases.pending = resolve("sku-pending");
assert.equal(cases.pending.relationStatus, "pending");
assert.equal(cases.pending.governance.hasPendingCandidate, true);

const comparisonFields = ["relationStatus", "relationshipShape", "isComplete", "isUsable", "mappings", "combo", "conflicts", "warnings"];
const mixedIds = [
  "sku-single-1", "sku-single-5", "sku-combo", "sku-combo-incomplete",
  "sku-single-combo-conflict", "sku-pending", "sku-empty", "missing-link-sku", "sku-single-1",
];
let batchSqlCount = 0;
const batch = resolveLinkSkuErpRelations({ salesLinkSkuIds: mixedIds }, { database, onQuery: () => { batchSqlCount += 1; } });
assert.equal(batch.capability, "ResolveLinkSkuErpRelations");
assert.deepEqual(Object.keys(batch.results), [...new Set(mixedIds)]);
assert.equal(Object.keys(batch.results).length, mixedIds.length - 1);
for (const id of Object.keys(batch.results)) {
  const single = resolve(id);
  for (const field of comparisonFields) assert.deepEqual(batch.results[id][field], single[field], `${id}.${field}批量与单条结果不一致`);
}
assert.deepEqual(resolveLinkSkuErpRelations({ salesLinkSkuIds: [] }, { database }).results, {});

const integrity = database.pragma("integrity_check", { simple: true });
const foreignKeyErrors = database.pragma("foreign_key_check");
assert.equal(integrity, "ok");
assert.deepEqual(foreignKeyErrors, []);

const summary = {
  success: true,
  databasePath,
  cases: Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, {
    relationStatus: value.relationStatus,
    relationshipShape: value.relationshipShape,
    conflicts: value.conflicts.map((item) => item.code),
  }])),
  integrityCheck: integrity,
  foreignKeyCheckErrors: foreignKeyErrors.length,
  batchBoundaryTests: {
    inputCount: mixedIds.length,
    uniqueResultCount: Object.keys(batch.results).length,
    sqlCount: batchSqlCount,
    emptyResults: 0,
    consistentFields: comparisonFields,
  },
};
console.log(JSON.stringify(summary, null, 2));
database.close();
