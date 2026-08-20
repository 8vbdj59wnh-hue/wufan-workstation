import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  executeV3ShadowObservation,
  listV3ShadowDifferences,
  readV3ShadowSummary,
  readV3ShadowProtectedSnapshot,
} from "../server/v3ShadowObservationService.js";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY);
    CREATE TABLE sales_link_sku_erp_mappings(id TEXT PRIMARY KEY);
    CREATE TABLE sales_link_sku_product_structures(id TEXT PRIMARY KEY);
    CREATE TABLE platform_sku_manual_bindings(id TEXT PRIMARY KEY);
    CREATE TABLE products(id TEXT PRIMARY KEY);
    CREATE TABLE sales_links(id TEXT PRIMARY KEY);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesAmount REAL,costAmount REAL,profitAmount REAL);
    INSERT INTO connection_sku_sales_daily_facts VALUES('fact',100,40,60);
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,currentState TEXT,lastSeenBatchId TEXT,normalizedPlatformSkuCode TEXT,platformSkuCode TEXT,systemGoodsType TEXT);
    INSERT INTO sales_link_skus VALUES('missing','active','batch','','','单品');
    CREATE TABLE operating_erp_identity_observations(normalizedCode TEXT PRIMARY KEY,identityStatus TEXT,resolvedIdentityType TEXT,goodsStatus TEXT,suiteStatus TEXT,detailJson TEXT);
    INSERT INTO operating_erp_identity_observations VALUES('missing-code','erp_not_found','unresolved','not_found','not_found','{}');
    CREATE TABLE v3_relation_shadow_runs (
      id TEXT PRIMARY KEY,triggerType TEXT NOT NULL,triggerObjectId TEXT,sourceBatchId TEXT,status TEXT NOT NULL,
      startedAt TEXT NOT NULL,completedAt TEXT,durationMs REAL,metricsJson TEXT NOT NULL DEFAULT '{}',
      protectedBeforeJson TEXT NOT NULL DEFAULT '{}',protectedAfterJson TEXT NOT NULL DEFAULT '{}',errorMessage TEXT,
      createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    CREATE TABLE v3_relation_shadow_differences (
      id TEXT PRIMARY KEY,objectType TEXT NOT NULL,objectId TEXT NOT NULL,normalizedCode TEXT,differenceType TEXT NOT NULL,
      currentResultJson TEXT NOT NULL DEFAULT '{}',v3ResultJson TEXT NOT NULL DEFAULT '{}',firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,occurrenceCount INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'active',lastRunId TEXT,
      createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(objectType,objectId,differenceType)
    );
  `);
  return db;
}

const mainChainResult = () => ({
  batch: { id: "batch" },
  comparison: {
    summary: { total: 2, same: 1, v3_missing_current: 1, current_missing_v3: 0, relation_conflict: 0, type_conflict: 0, source_conflict: 0 },
    details: [{ linkSkuId: "sku-new", sourceCode: "NEW", status: "v3_missing_current", currentSalesObjectId: null, projectedSalesObjectId: "so-new" }],
  },
});

test("全部Flag关闭时Shadow不执行", async () => {
  const db = fixture();
  const result = await executeV3ShadowObservation({ type: "test", batchId: "batch" }, { database: db, flags: { projection: "off", relationWrite: false, relationRead: false }, runMainChain: async () => { throw new Error("must_not_run"); } });
  assert.equal(result.skipped, true);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM v3_relation_shadow_runs").get().total, 0);
});

test("Shadow只保存诊断摘要和去重差异", async () => {
  const db = fixture();
  const before = readV3ShadowProtectedSnapshot({ database: db });
  const options = { database: db, flags: { projection: "shadow", relationWrite: false, relationRead: false }, runMainChain: async () => mainChainResult() };
  const first = await executeV3ShadowObservation({ type: "platform_goods_import", batchId: "batch" }, options);
  const second = await executeV3ShadowObservation({ type: "platform_goods_repeat", batchId: "batch" }, options);
  assert.equal(first.metrics.v3_more_complete, 1);
  assert.equal(first.metrics.missing_erp_code, 1);
  assert.equal(first.metrics.erp_not_found, 1);
  assert.deepEqual(readV3ShadowProtectedSnapshot({ database: db }), before);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM v3_relation_shadow_runs").get().total, 2);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM v3_relation_shadow_differences").get().total, 2);
  assert.equal(db.prepare("SELECT occurrenceCount FROM v3_relation_shadow_differences WHERE objectId='sku-new'").get().occurrenceCount, 1);
  assert.equal(second.metrics.engineering.diagnosticWrites.stableSkipped, 2);
  assert.equal(second.metrics.engineering.diagnosticWrites.changed, 0);
  assert.equal(readV3ShadowSummary({ database: db }).latest.metrics.same, 1);
  assert.equal(listV3ShadowDifferences({}, { database: db }).pagination.total, 2);
  assert.equal(second.status, "completed");
});

test("Shadow检测到正式资产变化时记录失败", async () => {
  const db = fixture();
  await assert.rejects(() => executeV3ShadowObservation({ type: "test", batchId: "batch" }, {
    database: db,
    flags: { projection: "shadow", relationWrite: false, relationRead: false },
    runMainChain: async () => { db.prepare("INSERT INTO sales_objects VALUES ('illegal')").run(); return mainChainResult(); },
  }), /v3_shadow_business_asset_mutation_detected/u);
  assert.equal(db.prepare("SELECT status FROM v3_relation_shadow_runs").get().status, "failed");
});
