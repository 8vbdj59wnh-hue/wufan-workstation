import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { resolveLinkSkuSalesObject } from "../server/capabilities/resolveLinkSkuSalesObject.js";
import { getLatestCompletePlatformBatch } from "../server/v3PlatformBatchService.js";
import { readV3RelationFeatureFlags, V3_RELATION_SOURCE_TYPE } from "../server/v3RelationFeatureFlags.js";
import { runV3RelationMainChain } from "../server/v3RelationMainChainService.js";

const flags = (overrides = {}) => ({ environment: {}, projection: "off", relationWrite: false, relationRead: false, ...overrides });
const fakeResult = () => ({ observations: [{ identityStatus: "confirmed" }], summary: { operatingTotal: 1 }, members: [{ normalizedCode: "a" }] });
function deps(log = []) {
  return {
    database: {},
    operatingSet: async () => { log.push("operating"); return fakeResult(); },
    enrich: async () => { log.push("enrich"); return { changedCodes: 1, bomPending: 0 }; },
    identity: async () => { log.push("identity"); return fakeResult(); },
    compare: async () => { log.push("compare"); return { summary: { same: 1 } }; },
    project: async (input) => { log.push("project"); return { objectsCreated: 1, structuresCreated: 1, relationsCreated: input.relationWriteEnabled ? 1 : 0, relationsWouldCreate: input.relationWriteEnabled ? 0 : 1, relationsProvenanceUpdated: 0, exceptions: [] }; },
  };
}

test("Feature Flags默认全部关闭", () => assert.deepEqual(readV3RelationFeatureFlags({ environment: {} }), { projection: "off", relationWrite: false, relationRead: false, safeDefault: true, relationSourceType: V3_RELATION_SOURCE_TYPE }));
test("Projection支持shadow", () => assert.equal(readV3RelationFeatureFlags(flags({ projection: "shadow" })).projection, "shadow"));
test("Projection支持on", () => assert.equal(readV3RelationFeatureFlags(flags({ projection: "on" })).projection, "on"));
test("无效Projection值被拒绝", () => assert.throws(() => readV3RelationFeatureFlags(flags({ projection: "maybe" })), /invalid_v3_auto_projection_flag/u));
test("Relation Write不能脱离Projection", () => assert.throws(() => readV3RelationFeatureFlags(flags({ relationWrite: true })), /v3_relation_write_requires_projection/u));
test("Relation Read可以独立回切", () => assert.equal(readV3RelationFeatureFlags(flags({ relationRead: true })).relationRead, true));

test("全部关闭时不执行V3步骤", async () => {
  const log = []; const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(log), flags: flags() });
  assert.equal(result.status, "deployed_disabled"); assert.deepEqual(log, []);
});
test("正式编排顺序固定", async () => {
  const log = []; await runV3RelationMainChain({ batchId: "batch" }, { ...deps(log), flags: flags({ projection: "on" }) });
  assert.deepEqual(log, ["operating", "enrich", "identity", "compare", "project"]);
});
test("旺店通失败保留平台事实并进入待重试", async () => {
  const log = []; const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(log), flags: flags({ projection: "on" }), enrich: async () => { throw new Error("timeout"); } });
  assert.equal(result.status, "erp_enrichment_pending"); assert.equal(result.retryable, true); assert.equal(result.steps[0].status, "completed");
});
test("BOM失败不继续投影", async () => {
  const log = []; const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(log), flags: flags({ projection: "on" }), enrich: async () => ({ bomPending: 2 }) });
  assert.equal(result.status, "bundle_bom_pending"); assert(!log.includes("project"));
});
test("Shadow只比较不写入", async () => {
  const log = []; const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(log), flags: flags({ projection: "shadow" }) });
  assert.equal(result.status, "shadow_completed"); assert(!log.includes("project"));
});
test("Projection开启但Relation Write关闭", async () => {
  const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(), flags: flags({ projection: "on" }) });
  assert.equal(result.status, "projection_completed"); assert.equal(result.projection.relationsWouldCreate, 1);
});
test("Relation Write开启写正式关系", async () => {
  const result = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(), flags: flags({ projection: "on", relationWrite: true }) });
  assert.equal(result.status, "relation_write_completed"); assert.equal(result.projection.relationsCreated, 1);
});
test("关闭Feature Flag可立即停止后续写入", async () => {
  const first = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(), flags: flags({ projection: "on", relationWrite: true }) });
  const rolledBack = await runV3RelationMainChain({ batchId: "batch" }, { ...deps(), flags: flags() });
  assert.equal(first.status, "relation_write_completed"); assert.equal(rolledBack.status, "deployed_disabled");
});

test("最新完整批次优先选择新数据同步中心批次", () => {
  const db = new Database(":memory:"); db.exec(`
    CREATE TABLE erp_import_batches(id TEXT,importType TEXT,status TEXT,importMode TEXT,businessDate TEXT,completedAt TEXT,createdAt TEXT,originalFilename TEXT);
    CREATE TABLE data_sync_tasks(id TEXT,taskCode TEXT);
    CREATE TABLE data_sync_batches(id TEXT,taskId TEXT,status TEXT,syncMode TEXT,periodEnd TEXT,completedAt TEXT,createdAt TEXT,fileName TEXT,fileHash TEXT,totalCount INTEGER);
    CREATE TABLE sales_link_skus(id TEXT,lastSeenBatchId TEXT);
    INSERT INTO erp_import_batches VALUES('old','platform_goods','completed','full','2026-08-05','2026-08-05','2026-08-05','8.5.xlsx');
    INSERT INTO data_sync_tasks VALUES('task','platform_goods_excel_import');
    INSERT INTO data_sync_batches VALUES('new','task','succeeded','full','2026-08-19','2026-08-19T23:00:00Z','2026-08-19T22:00:00Z','8.19.xlsx','hash',100);
    INSERT INTO sales_link_skus VALUES('sku','new');
  `);
  assert.equal(getLatestCompletePlatformBatch(db).id, "new"); db.close();
});

test("忽略未形成Link SKU批次覆盖的历史partial批次", () => {
  const db = new Database(":memory:"); db.exec(`
    CREATE TABLE erp_import_batches(id TEXT,importType TEXT,status TEXT,importMode TEXT,businessDate TEXT,completedAt TEXT,createdAt TEXT,originalFilename TEXT);
    CREATE TABLE data_sync_tasks(id TEXT,taskCode TEXT);
    CREATE TABLE data_sync_batches(id TEXT,taskId TEXT,status TEXT,syncMode TEXT,periodEnd TEXT,completedAt TEXT,createdAt TEXT,fileName TEXT,fileHash TEXT,totalCount INTEGER);
    CREATE TABLE sales_link_skus(id TEXT,lastSeenBatchId TEXT);
    INSERT INTO erp_import_batches VALUES('materialized','platform_goods','completed','full','2026-08-05','2026-08-05','2026-08-05','8.5.xlsx');
    INSERT INTO data_sync_tasks VALUES('task','platform_goods_excel_import');
    INSERT INTO data_sync_batches VALUES('partial-unmaterialized','task','partial','full','2026-08-06','2026-08-06','2026-08-06','8.6.xlsx','hash',34244);
    INSERT INTO sales_link_skus VALUES('sku','materialized');
  `);
  assert.equal(getLatestCompletePlatformBatch(db).id, "materialized"); db.close();
});

test("Relation Read开启时只选择V3关系资产", () => {
  const db = new Database(":memory:"); db.exec(`
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,status TEXT,sourceType TEXT,effectiveFrom TEXT,effectiveTo TEXT,sourceBatchId TEXT,sourceReferenceJson TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,objectType TEXT,source TEXT,sourceCode TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,structureHash TEXT,effectiveFrom TEXT,effectiveTo TEXT,status TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,currentState TEXT);
    INSERT INTO sales_link_skus VALUES('sku','link'); INSERT INTO sales_objects VALUES('so','A','single','wangdian','A','active');
    INSERT INTO sales_object_structures VALUES('st','so',1,'h','2026',NULL,'active'); INSERT INTO sales_object_structure_components VALUES('c','st','erp',1,1,'active'); INSERT INTO erp_skus VALUES('erp','A','active');
    INSERT INTO sales_link_sku_sales_object_relations VALUES('r','sku','so','active','legacy','2026',NULL,NULL,'{}');
  `);
  assert.equal(resolveLinkSkuSalesObject({ salesLinkSkuId: "sku" }, { database: db }).status, "active_complete");
  assert.equal(resolveLinkSkuSalesObject({ salesLinkSkuId: "sku" }, { database: db, relationSourceType: V3_RELATION_SOURCE_TYPE }).status, "missing_sales_object");
  db.close();
});

test("回滚读取排除本次V3新建关系但保留历史关系", () => {
  const db = new Database(":memory:"); db.exec(`
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,status TEXT,sourceType TEXT,effectiveFrom TEXT,effectiveTo TEXT,sourceBatchId TEXT,sourceReferenceJson TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,objectType TEXT,source TEXT,sourceCode TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,structureHash TEXT,effectiveFrom TEXT,effectiveTo TEXT,status TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,currentState TEXT);
    INSERT INTO sales_link_skus VALUES('sku','link'); INSERT INTO sales_objects VALUES('so','A','single','wangdian','A','active');
    INSERT INTO sales_object_structures VALUES('st','so',1,'h','2026',NULL,'active'); INSERT INTO sales_object_structure_components VALUES('c','st','erp',1,1,'active'); INSERT INTO erp_skus VALUES('erp','A','active');
    INSERT INTO sales_link_sku_sales_object_relations VALUES('r','sku','so','active','platform_goods_v3_projection','2026',NULL,'batch','{"createdByProjection":true}');
  `);
  assert.equal(resolveLinkSkuSalesObject({ salesLinkSkuId: "sku" }, { database: db, excludeProjectionCreated: true }).status, "missing_sales_object");
  assert.equal(resolveLinkSkuSalesObject({ salesLinkSkuId: "sku" }, { database: db, relationSourceType: V3_RELATION_SOURCE_TYPE }).status, "active_complete");
  db.close();
});
