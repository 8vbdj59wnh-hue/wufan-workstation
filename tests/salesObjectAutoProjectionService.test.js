import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  compareV3ProjectionResolver,
  projectOperatingSalesObjects,
} from "../server/salesObjectAutoProjectionService.js";
import { createProductStructureApplicationBatch } from "../server/productStructureApplicationApprovalService.js";
import { classifyResolvedRelationForSalesDaily } from "../server/salesDailyFactPreviewService.js";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE persons(id TEXT PRIMARY KEY,status TEXT,authRole TEXT);
    INSERT INTO persons VALUES ('admin','active','admin');
    CREATE TABLE erp_import_batches(id TEXT PRIMARY KEY,importType TEXT,status TEXT,importMode TEXT,businessDate TEXT,completedAt TEXT,createdAt TEXT,originalFilename TEXT);
    INSERT INTO erp_import_batches VALUES ('batch','platform_goods','completed','full','2026-08-05','2026-08-05','2026-08-05','8.5.xlsx');
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,currentState TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,normalizedObjectCode TEXT UNIQUE,objectType TEXT,source TEXT,sourceType TEXT,sourceCode TEXT,sourceBatchId TEXT,status TEXT,blockedReason TEXT,firstSeenAt TEXT,lastSeenAt TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,structureHash TEXT,effectiveFrom TEXT,effectiveTo TEXT,status TEXT,sourceType TEXT,sourceBatchId TEXT,sourceReferenceJson TEXT,validityBasis TEXT,sourceState TEXT,sourceUpdatedAt TEXT,lastVerifiedAt TEXT,syncedAt TEXT,supersedesStructureId TEXT,reviewedBy TEXT,reviewedAt TEXT,activatedAt TEXT,createdAt TEXT,updatedAt TEXT,UNIQUE(id,salesObjectId));
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT,sourceType TEXT,sourceReferenceJson TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE sales_object_structure_effective_periods(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,validFrom TEXT,validTo TEXT,sourceState TEXT,validityBasis TEXT,sourceUpdatedAt TEXT,firstVerifiedAt TEXT,lastVerifiedAt TEXT,syncedAt TEXT,sourceReferenceJson TEXT,createdAt TEXT,updatedAt TEXT,FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId));
    CREATE UNIQUE INDEX one_open ON sales_object_structure_effective_periods(salesObjectId) WHERE validTo IS NULL AND sourceState='active';
    CREATE TABLE sales_links(id TEXT PRIMARY KEY,platformGoodsId TEXT);
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT,platformSkuId TEXT,normalizedPlatformSkuCode TEXT,platformSkuCode TEXT,matchStatus TEXT);
    CREATE TABLE data_sync_batches(id TEXT PRIMARY KEY,status TEXT,syncMode TEXT,createdAt TEXT,completedAt TEXT,fileName TEXT);
    INSERT INTO data_sync_batches VALUES('batch','succeeded','full','2026-08-20','2026-08-20','8.19.xlsx');
    CREATE TABLE platform_goods_excel_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,rowNumber INTEGER,salesLinkId TEXT,salesLinkSkuId TEXT,platformGoodsId TEXT,platformSkuId TEXT,merchantSkuCode TEXT,systemGoodsType TEXT,rawDataJson TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,effectiveFrom TEXT,effectiveTo TEXT,status TEXT,sourceType TEXT,sourceBatchId TEXT,sourceReferenceJson TEXT,reviewedBy TEXT,reviewedAt TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE UNIQUE INDEX one_relation ON sales_link_sku_sales_object_relations(linkSkuId) WHERE status='active';
    CREATE TABLE operating_erp_identity_observations(normalizedCode TEXT PRIMARY KEY,merchantSkuCode TEXT,inOperatingObjectSet INTEGER,resolvedIdentityType TEXT,identityStatus TEXT,goodsErpSkuId TEXT,suiteSalesObjectId TEXT,sourceMode TEXT,sourceCheckedAt TEXT,sourceUpdatedAt TEXT,detailJson TEXT);
    CREATE TABLE operating_erp_identity_shadow_comparisons(normalizedCode TEXT PRIMARY KEY,currentSalesObjectId TEXT,bundleStructureStatus TEXT,productMappingStatus TEXT,comparisonStatus TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesLinkSkuId TEXT,saleDate TEXT,erpSkuId TEXT);
    INSERT INTO connection_sku_sales_daily_facts VALUES ('fact',NULL,NULL,NULL);
    CREATE TABLE sales_link_sku_product_structures(id TEXT PRIMARY KEY);
    CREATE TABLE sales_link_sku_product_structure_components(id TEXT PRIMARY KEY);
    CREATE TABLE sales_link_sku_erp_mappings(id TEXT PRIMARY KEY);
    CREATE TABLE product_structure_application_batches(id TEXT PRIMARY KEY,batchCode TEXT UNIQUE,sourceType TEXT,sourceFileHashesJson TEXT,status TEXT,createdBy TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE product_structure_application_items(id TEXT PRIMARY KEY,applicationBatchId TEXT,productStructureId TEXT,salesLinkSkuId TEXT,classification TEXT,approvalStatus TEXT,relationshipShape TEXT,sourceTypesJson TEXT,currentMappingsJson TEXT,targetComponentsJson TEXT,componentDiffJson TEXT,impactSalesAmount REAL,impactProfitAmount REAL,createdAt TEXT,updatedAt TEXT);
  `);
  return db;
}

const legacyCounts = (db) => ({
  productStructures: db.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures").get().total,
  legacyMappings: db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total,
  applicationItems: db.prepare("SELECT COUNT(*) total FROM product_structure_application_items").get().total,
});

function addCandidate(db, { code = "SINGLE", type = "single", status = "confirmed", erpSkuId = "erp-single", productMappingStatus = "complete", linkCount = 1 } = {}) {
  const normalizedCode = code.toLowerCase();
  if (erpSkuId) db.prepare("INSERT OR IGNORE INTO erp_skus VALUES (?,?,'active')").run(erpSkuId, code);
  db.prepare("INSERT INTO operating_erp_identity_observations VALUES (?,?,1,?,?,?,NULL,'materialized','2026-08-20','2026-08-20','{}')").run(normalizedCode, code, type, status, type === "single" ? erpSkuId : null);
  db.prepare("INSERT INTO operating_erp_identity_shadow_comparisons VALUES (?,NULL,?,?,?)").run(normalizedCode, type === "bundle" ? "complete" : "not_applicable", productMappingStatus, status === "confirmed" ? "v3_fill" : status);
  for (let index = 0; index < linkCount; index += 1) {
    const linkSkuId = `${normalizedCode}-link-${index}`;
    const linkId = `${normalizedCode}-link-asset-${index}`;
    const platformGoodsId = `${normalizedCode}-goods-${index}`;
    const platformSkuId = `${normalizedCode}-platform-sku-${index}`;
    db.prepare("INSERT INTO sales_links VALUES (?,?)").run(linkId, platformGoodsId);
    db.prepare("INSERT INTO sales_link_skus VALUES (?,?,?,?,?,'matched')").run(linkSkuId, linkId, platformSkuId, normalizedCode, code);
    db.prepare(`INSERT INTO platform_goods_excel_import_rows(batchId,rowNumber,salesLinkId,salesLinkSkuId,platformGoodsId,platformSkuId,merchantSkuCode,systemGoodsType,rawDataJson)
      VALUES('batch',?,?,?,?,?,?,?,?)`).run(index + 2, linkId, linkSkuId, platformGoodsId, platformSkuId, code, type === "bundle" ? "组合装" : "单品", JSON.stringify({ 最后修改时间: "2026-08-13 22:49:39" }));
  }
}

function addExistingProjection(db, { code = "BUNDLE", type = "bundle", componentId = "erp-part", quantity = 2, sourceType = type === "bundle" ? "wangdian_suite_api" : "wangdian_goods_api" } = {}) {
  const normalizedCode = code.toLowerCase();
  db.prepare("INSERT OR IGNORE INTO erp_skus VALUES (?,?,'active')").run(componentId, componentId);
  db.prepare("INSERT INTO sales_objects VALUES (?,?,?,?,?,?,?,NULL,'active',NULL,'2026','2026','2026','2026')").run(`so-${normalizedCode}`, code, normalizedCode, type, "wangdian", sourceType, code);
  db.prepare("INSERT INTO sales_object_structures VALUES (?,?,1,'hash','2026',NULL,'active',?,NULL,'{}','exact','active',NULL,'2026','2026',NULL,'admin','2026','2026','2026','2026')").run(`st-${normalizedCode}`, `so-${normalizedCode}`, sourceType);
  db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?,?,1,'active',?,'{}','2026','2026')").run(`component-${normalizedCode}`, `st-${normalizedCode}`, `so-${normalizedCode}`, componentId, quantity, sourceType);
  db.prepare("UPDATE operating_erp_identity_shadow_comparisons SET currentSalesObjectId=?,comparisonStatus='consistent' WHERE normalizedCode=?").run(`so-${normalizedCode}`, normalizedCode);
  db.prepare("UPDATE operating_erp_identity_observations SET suiteSalesObjectId=? WHERE normalizedCode=?").run(`so-${normalizedCode}`, normalizedCode);
  return `so-${normalizedCode}`;
}

test("Single首次自动投影", () => { const db = fixture(); addCandidate(db); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.objectsCreated, 1); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_objects").get().total, 1); });
test("Single重复投影幂等", () => { const db = fixture(); addCandidate(db); projectOperatingSalesObjects({ database: db }); const second = projectOperatingSalesObjects({ database: db }); assert.equal(second.objectsCreated, 0); assert.equal(second.objectsUpdated, 0); assert.equal(second.structuresCreated, 0); assert.equal(second.structuresUpdated, 0); assert.equal(second.componentsCreated, 0); assert.equal(second.engineering.batchCount, 0); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total, 1); });
test("Bundle首次由权威BOM投影", () => { const db = fixture(); addCandidate(db, { code: "PACK", type: "bundle", erpSkuId: null }); db.prepare("INSERT INTO erp_skus VALUES ('part','PART','active')").run(); const result = projectOperatingSalesObjects({ database: db, bundleSources: { pack: { components: [{ erpSkuId: "part", quantity: 2 }] } } }); assert.equal(result.objectsCreated, 1); assert.equal(db.prepare("SELECT objectType FROM sales_objects").get().objectType, "bundle"); });
test("Bundle读取Phase3当前版本", () => { const db = fixture(); addCandidate(db, { code: "PACK", type: "bundle", erpSkuId: null }); addExistingProjection(db, { code: "PACK" }); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.bundleCount, 1); assert.equal(result.exceptions.length, 0); });
test("Bundle BOM变化建立新版本并保持Relation关闭", () => {
  const db = fixture();
  addCandidate(db, { code: "PACK", type: "bundle", erpSkuId: null });
  addExistingProjection(db, { code: "PACK", quantity: 2 });
  const first = projectOperatingSalesObjects({ database: db, relationWriteEnabled: false, bundleSources: { pack: { sourceUpdatedAt: "2026-08-21", components: [{ erpSkuId: "erp-part", quantity: 3 }] } } });
  assert.equal(first.objectsCreated, 0);
  assert.equal(first.structuresCreated, 1);
  assert.equal(first.structuresSuperseded, 1);
  assert.equal(first.componentsCreated, 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total, 2);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structures WHERE status='active'").get().total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_sales_object_relations").get().total, 0);
  const second = projectOperatingSalesObjects({ database: db, relationWriteEnabled: false, bundleSources: { pack: { sourceUpdatedAt: "2026-08-21", components: [{ erpSkuId: "erp-part", quantity: 3 }] } } });
  assert.equal(second.objectsCreated, 0);
  assert.equal(second.structuresCreated, 0);
  assert.equal(second.structuresUpdated, 0);
  assert.equal(second.structuresSuperseded, 0);
  assert.equal(second.componentsCreated, 0);
  assert.equal(second.engineering.batchCount, 0);
});
test("Bundle内容未变时只迁移结构权威且不改不可变组件", () => {
  const db = fixture();
  addCandidate(db, { code: "PACK", type: "bundle", erpSkuId: null });
  addExistingProjection(db, { code: "PACK", quantity: 2, sourceType: "legacy_excel" });
  const source = { pack: { sourceUpdatedAt: "2026-08-21", components: [{ erpSkuId: "erp-part", quantity: 2 }] } };
  const first = projectOperatingSalesObjects({ database: db, relationWriteEnabled: false, bundleSources: source });
  assert.equal(first.structuresCreated, 0);
  assert.equal(first.structuresUpdated, 1);
  assert.equal(first.structuresSuperseded, 0);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total, 1);
  assert.equal(db.prepare("SELECT sourceType FROM sales_object_structures WHERE status='active'").get().sourceType, "wangdian_suite_api");
  assert.equal(db.prepare("SELECT sourceType FROM sales_object_structure_components WHERE structureId=(SELECT id FROM sales_object_structures WHERE status='active')").get().sourceType, "legacy_excel");
  const second = projectOperatingSalesObjects({ database: db, relationWriteEnabled: false, bundleSources: source });
  assert.equal(second.structuresCreated, 0);
  assert.equal(second.structuresSuperseded, 0);
  assert.equal(second.engineering.batchCount, 0);
});
test("正确Link关系自动建立", () => { const db = fixture(); addCandidate(db); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.relationsCreated, 1); });
test("重复Link关系不增长", () => { const db = fixture(); addCandidate(db); projectOperatingSalesObjects({ database: db }); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.relationsCreated, 0); assert.equal(result.relationsUnchanged, 1); });
test("Relation Write关闭时只报告待写关系", () => { const db = fixture(); addCandidate(db); const result = projectOperatingSalesObjects({ database: db, relationWriteEnabled: false }); assert.equal(result.relationsCreated, 0); assert.equal(result.relationsWouldCreate, 1); });
test("已有正确关系切换为V3可追溯来源", () => { const db = fixture(); addCandidate(db); projectOperatingSalesObjects({ database: db }); db.prepare("UPDATE sales_link_sku_sales_object_relations SET sourceType='legacy',sourceBatchId=NULL,sourceReferenceJson='{}'").run(); const result = projectOperatingSalesObjects({ database: db }); const relation = db.prepare("SELECT sourceType,sourceBatchId,sourceReferenceJson FROM sales_link_sku_sales_object_relations").get(); assert.equal(result.relationsProvenanceUpdated, 1); assert.equal(relation.sourceType, 'platform_goods_v3_projection'); assert.equal(relation.sourceBatchId, 'batch'); assert.equal(JSON.parse(relation.sourceReferenceJson).createdByProjection, false); });
test("已有不同Link关系不静默覆盖", () => { const db = fixture(); addCandidate(db); db.prepare("INSERT INTO sales_objects VALUES ('wrong','WRONG','wrong','single','legacy','manual_legacy','WRONG',NULL,'active',NULL,'2026','2026','2026','2026')").run(); db.prepare("INSERT INTO sales_link_sku_sales_object_relations VALUES ('wrong-r','single-link-0','wrong','2026',NULL,'active','legacy',NULL,'{}',NULL,NULL,'2026','2026')").run(); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.relationConflicts, 1); assert.equal(db.prepare("SELECT salesObjectId FROM sales_link_sku_sales_object_relations").get().salesObjectId, "wrong"); });
test("平台规格历史换绑会保留旧关系并切换当前关系", () => {
  const db = fixture();
  addCandidate(db, { code: "HP0613-1", erpSkuId: "erp-0613" });
  const oldObjectId = addExistingProjection(db, { code: "HP0731-4", type: "single", componentId: "erp-0731", quantity: 1, sourceType: "wangdian_goods_api" });
  db.prepare("INSERT INTO data_sync_batches VALUES('old-batch','partial','full','2026-08-06','2026-08-06','平台货品.xlsx')").run();
  db.prepare(`INSERT INTO platform_goods_excel_import_rows(batchId,rowNumber,salesLinkId,salesLinkSkuId,platformGoodsId,platformSkuId,merchantSkuCode,systemGoodsType,rawDataJson)
    SELECT 'old-batch',1,salesLinkId,id,'hp0613-1-goods-0',platformSkuId,'HP0731-4','单品',? FROM sales_link_skus WHERE id='hp0613-1-link-0'`)
    .run(JSON.stringify({ 最后修改时间: "2026-07-30 19:34:45" }));
  db.prepare("INSERT INTO sales_link_sku_sales_object_relations VALUES ('old-r','hp0613-1-link-0',?,'2026-08-12',NULL,'active','platform_goods_excel',NULL,'{}','admin','2026','2026','2026')").run(oldObjectId);
  db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES ('historical-fact','hp0613-1-link-0','2026-08-07','erp-0731')").run();
  const result = projectOperatingSalesObjects({ database: db, timestamp: "2026-08-21T00:00:00Z" });
  assert.equal(result.historicalRelationChanges, 1);
  assert.equal(result.relationConflicts, 0);
  assert.equal(db.prepare(`SELECT o.normalizedObjectCode FROM sales_link_sku_sales_object_relations r JOIN sales_objects o ON o.id=r.salesObjectId WHERE r.status='active'`).get().normalizedObjectCode, "hp0613-1");
  const historical = db.prepare("SELECT effectiveFrom,effectiveTo,status FROM sales_link_sku_sales_object_relations WHERE id='old-r'").get();
  assert.deepEqual(historical, { effectiveFrom: "2026-07-30T19:34:45", effectiveTo: "2026-08-13T22:49:39", status: "superseded" });
  assert.equal(db.prepare("SELECT erpSkuId FROM connection_sku_sales_daily_facts WHERE id='historical-fact'").get().erpSkuId, "erp-0731");
  const classified = classifyResolvedRelationForSalesDaily({
    normalized: { saleDate: "2026-08-07" },
    result: { category: "identity_ready", salesLinkSku: { id: "hp0613-1-link-0" }, erpSku: { id: "erp-0731" } },
  }, { relationStatus: "active_complete", isUsable: true, mappings: [{ erpSkuId: "erp-0613", quantity: 1 }] }, { database: db });
  assert.equal(classified.result.category, "ready");
  assert.equal(classified.result.relationClassification, "historical_relation_change");
});
test("ERP不存在保持异常", () => { const db = fixture(); addCandidate(db, { status: "erp_not_found", erpSkuId: null }); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.objectsCreated, 0); assert.equal(result.exceptions[0].type, "erp_not_found"); });
test("类型冲突不覆盖现有对象", () => { const db = fixture(); addCandidate(db); db.prepare("INSERT INTO sales_objects VALUES ('bundle','SINGLE','single','bundle','wangdian','wangdian_suite_api','SINGLE',NULL,'active',NULL,'2026','2026','2026','2026')").run(); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.exceptions[0].type, "type_conflict"); assert.equal(db.prepare("SELECT objectType FROM sales_objects").get().objectType, "bundle"); });
test("Product Mapping缺失不阻断投影", () => { const db = fixture(); addCandidate(db, { productMappingStatus: "missing" }); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.objectsCreated, 1); assert.equal(result.productMappingGovernance, 1); });
test("正常投影不创建Product Structure", () => { const db = fixture(); addCandidate(db); const before = legacyCounts(db); projectOperatingSalesObjects({ database: db }); assert.equal(legacyCounts(db).productStructures, before.productStructures); });
test("正常投影不创建Legacy Mapping", () => { const db = fixture(); addCandidate(db); const before = legacyCounts(db); projectOperatingSalesObjects({ database: db }); assert.equal(legacyCounts(db).legacyMappings, before.legacyMappings); });
test("两个已知缺口无需审批自动补齐", () => { const db = fixture(); addCandidate(db, { code: "HP1025-1", erpSkuId: "erp-1025", linkCount: 1 }); addCandidate(db, { code: "HP1055-1", erpSkuId: "erp-1055", linkCount: 1 }); const result = projectOperatingSalesObjects({ database: db }); assert.equal(result.objectsCreated, 2); assert.equal(result.relationsCreated, 2); assert.equal(legacyCounts(db).applicationItems, 0); });
test("投影失败事务完整回滚", () => { const db = fixture(); addCandidate(db, { code: "FAIL" }); assert.throws(() => projectOperatingSalesObjects({ database: db, failAfterCode: "FAIL" }), /isolated_sales_object_projection_failure/u); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_objects").get().total, 0); });
test("投影不改变Daily Facts", () => { const db = fixture(); addCandidate(db); projectOperatingSalesObjects({ database: db }); assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, 1); });
test("影子Resolver识别V3新增关系", () => { const db = fixture(); addCandidate(db); projectOperatingSalesObjects({ database: db }); db.prepare("DELETE FROM sales_link_sku_sales_object_relations").run(); const shadow = compareV3ProjectionResolver({ database: db }); assert.equal(shadow.summary.v3_missing_current, 1); });
test("V3可解释的正常关系不再创建人工审批项", () => { const db = fixture(); addCandidate(db); const result = createProductStructureApplicationBatch({ batchCode: "v3-normal", sourceType: "platform_goods", previewItems: [{ salesLinkSkuId: "single-link-0", previewStatus: "new_structure", components: [{ erpSkuId: "erp-single", quantity: 1, sourceType: "platform_goods" }], currentMappings: [] }] }, { database: db }); assert.equal(result.itemCount, 0); assert.equal(result.autoProjectedSkipped, 1); assert.equal(db.prepare("SELECT COUNT(*) total FROM product_structure_application_items").get().total, 0); });
