import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("旧前端入口只保留URL兼容，不再加载重复页面和历史导入工作区", () => {
  const modulesSource = fs.readFileSync(path.join(repositoryRoot, "src/modules.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(repositoryRoot, "src/main.js"), "utf8");
  const connectionCenterSource = fs.readFileSync(path.join(repositoryRoot, "src/connectionCenterPage.js"), "utf8");

  assert.doesNotMatch(modulesSource, /id:\s*["'](?:operationDashboard|assessment)["']/u);
  assert.doesNotMatch(modulesSource, /id:\s*["']dataCenter["']/u);
  assert.match(modulesSource, /id:\s*["']adminDataCenter["'][\s\S]*?hidden:\s*true/u);
  assert.match(mainSource, /operationDashboard:\s*["']dashboard["']/u);
  assert.match(mainSource, /assessment:\s*["']dashboard["']/u);
  assert.doesNotMatch(mainSource, /from\s+["']\.\/assessmentPage\.js["']/u);
  assert.doesNotMatch(mainSource, /from\s+["']\.\/operationDashboardPage\.js["']/u);
  assert.doesNotMatch(mainSource, /from\s+["']\.\/dataCenterPage\.js["']/u);
  assert.match(mainSource, /normalizeRetiredDataCenterRoute/u);
  for (const deadEntry of ["renderImportPage", "renderMappingPage", "renderMappingModal", "data-connection-import-form", "data-mapping-filter-form"]) {
    assert.equal(connectionCenterSource.includes(deadEntry), false, `${deadEntry} 应从正式前端入口移除`);
  }
});

test("Combo与旧人工绑定正式代码不再读取或写入", () => {
  const serverSource = fs.readFileSync(path.join(repositoryRoot, "server/index.js"), "utf8");
  const appStateSource = fs.readFileSync(path.join(repositoryRoot, "src/appState.js"), "utf8");
  const productImportSource = fs.readFileSync(path.join(repositoryRoot, "server/productV2Import.js"), "utf8");

  assert.equal(fs.existsSync(path.join(repositoryRoot, "server/salesComboReviewService.js")), false);
  assert.doesNotMatch(serverSource, /\/api\/connection-data-foundation\/combo-reviews/u);
  assert.doesNotMatch(appStateSource, /loadComboReview|platformSkuManualBindings|unbindPlatformSku/u);
  assert.doesNotMatch(productImportSource, /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+platform_sku_manual_bindings\b/iu);
  assert.match(productImportSource, /export function proposePlatformSkuProductRelation/u);
  assert.match(productImportSource, /sourceType:\s*["']product_relation_proposal["']/u);
});

test("Legacy Schema Guard阻止初始化重新创建旧运行表", () => {
  const schemaSource = fs.readFileSync(path.join(repositoryRoot, "server/schema.sql"), "utf8");
  const databaseSource = fs.readFileSync(path.join(repositoryRoot, "server/db.js"), "utf8");
  const migrationStart = databaseSource.indexOf("export function runLightweightMigrations");
  const migrationEnd = databaseSource.indexOf("\nexport function ", migrationStart + 1);
  const activeMigrations = databaseSource.slice(migrationStart, migrationEnd >= 0 ? migrationEnd : undefined);
  for (const tableName of [
    "sales_link_sku_erp_mappings",
    "sales_link_sku_product_structures",
    "sales_link_sku_product_structure_components",
    "sales_link_sku_combo_groups",
    "sales_link_sku_combo_group_components",
    "platform_sku_manual_bindings",
  ]) {
    assert.doesNotMatch(schemaSource, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\b`, "iu"), `${tableName} 不得回到新环境Schema`);
  }
  assert.doesNotMatch(activeMigrations, /\bmigrateSalesLinkSkuComboGroupsV1\s*\(/u);
  assert.doesNotMatch(activeMigrations, /\bmigrateSalesLinkSkuProductStructuresV1\s*\(/u);
});

test("正式运行时Legacy读取仅限诊断、Schema和资产目录", () => {
  const allowed = new Set([
    "server/db.js",
    "server/productStructureSchema.js",
    "server/dataAssetMapService.js",
    "server/capabilities/resolveLinkSkuErpRelation.js",
    "server/capabilities/resolveLinkSkuRelationRead.js",
  ]);
  const pattern = /\bsales_link_sku_(?:erp_mappings|product_structures|product_structure_components)\b|\bconnection_sku_sales_facts\b/u;
  const files = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
  const offenders = files(path.join(repositoryRoot, "server")).map((file) => ({
    file: path.relative(repositoryRoot, file),
    source: fs.readFileSync(file, "utf8"),
  })).filter(({ file, source }) => !allowed.has(file) && pattern.test(source)).map(({ file }) => file);
  assert.deepEqual(offenders, []);

  const legacyResolver = fs.readFileSync(path.join(repositoryRoot, "server/capabilities/resolveLinkSkuErpRelation.js"), "utf8");
  const unifiedResolver = fs.readFileSync(path.join(repositoryRoot, "server/capabilities/resolveLinkSkuRelationRead.js"), "utf8");
  assert.match(legacyResolver, /LEGACY_RESOLVER_MODE\s*=\s*["']diagnostic_only["']/u);
  assert.match(unifiedResolver, /options\.shadowCompare\s*===\s*true/u);
});

test("关系建议必须经审批后生成Sales Object，Legacy关系资产不增长", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "link-v2-cleanup-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { ensureSingleLinkSkuErpMapping } = await import("../server/linkSkuErpMappingService.js");
  const { applyApprovedProductStructureApplication, reviewProductStructureApplicationItem } = await import("../server/productStructureApplicationApprovalService.js");
  const { resolveLinkSkuRelationForRead, FORMAL_SALES_OBJECT_RESOLVER_SCOPES } = await import("../server/capabilities/resolveLinkSkuRelationRead.js");
  const { proposePlatformSkuProductRelation } = await import("../server/productV2Import.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const tableExists = (name) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    for (const tableName of [
      "sales_link_sku_erp_mappings",
      "sales_link_sku_product_structures",
      "sales_link_sku_product_structure_components",
      "sales_link_sku_combo_groups",
      "sales_link_sku_combo_group_components",
      "platform_sku_manual_bindings",
    ]) assert.equal(tableExists(tableName), false, `${tableName} 不应在空数据库初始化时创建`);
    const stamp = "2026-08-19T12:00:00.000Z";
    const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES('shop-cleanup','test','测试店铺','测试店铺','测试店铺','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES('link-cleanup','shop-cleanup','goods-cleanup','测试链接','strong','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES('link-sku-cleanup','link-cleanup','platform-sku-cleanup','pending','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES('erp-batch-cleanup','goods_info','erp.xlsx','erp-cleanup','completed',?)").run(stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES('erp-goods-cleanup','ERP-GOODS-CLEANUP','ERP商品','{}','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES('erp-sku-cleanup','ERP-SKU-CLEANUP','erp-goods-cleanup','{}','erp-batch-cleanup','erp-batch-cleanup','active',?,?)").run(stamp, stamp);

    const proposal = ensureSingleLinkSkuErpMapping(database, {
      salesLinkSkuId: "link-sku-cleanup", erpSkuId: "erp-sku-cleanup", sourceType: "test", sourceBatchId: "source-cleanup", timestamp: stamp,
    });
    assert.equal(proposal.outcome, "governance_pending");
    assert.equal(tableExists("sales_link_sku_erp_mappings"), false);
    assert.equal(tableExists("sales_link_sku_product_structures"), false);
    const item = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=?").get(proposal.applicationBatchId);
    assert.equal(item.approvalStatus, "pending");
    assert.equal(item.productStructureId, null);

    reviewProductStructureApplicationItem(item.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "测试审核" }, { database });
    const applied = applyApprovedProductStructureApplication(item.id, { appliedBy: reviewer.id }, { database });
    assert.equal(applied.outcome, "applied");
    assert.equal(applied.generatedMappingCount, 0);
    assert.equal(applied.generatedComponentCount, 1);
    assert.equal(applied.salesObjectStructureVersion, 1);
    assert.equal(tableExists("sales_link_sku_erp_mappings"), false);
    assert.equal(tableExists("sales_link_sku_product_structures"), false);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sales_objects WHERE status='active'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sales_link_sku_sales_object_relations WHERE status='active'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sales_object_structures WHERE status='active'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sales_object_structure_components WHERE status='active'").get().count, 1);
    const structureTrace = JSON.parse(database.prepare("SELECT sourceReferenceJson FROM sales_object_structures WHERE id=?").get(applied.salesObjectStructureId).sourceReferenceJson);
    assert.equal(structureTrace.applicationItemId, item.id);
    assert.equal(structureTrace.relationModel, "sales_object");
    const migratedItem = database.prepare("SELECT productStructureId,salesObjectStructureId,structureVersion FROM product_structure_application_items WHERE id=?").get(item.id);
    const audit = database.prepare("SELECT productStructureId,salesObjectStructureId,structureVersion FROM product_structure_application_audits WHERE id=?").get(applied.auditId);
    assert.deepEqual(migratedItem, { productStructureId: null, salesObjectStructureId: applied.salesObjectStructureId, structureVersion: 1 });
    assert.deepEqual(audit, { productStructureId: null, salesObjectStructureId: applied.salesObjectStructureId, structureVersion: 1 });
    assert.equal(ensureSingleLinkSkuErpMapping(database, {
      salesLinkSkuId: "link-sku-cleanup", erpSkuId: "erp-sku-cleanup", sourceType: "test", sourceBatchId: "source-cleanup", timestamp: stamp,
    }).outcome, "idempotent");

    const read = resolveLinkSkuRelationForRead({ salesLinkSkuId: "link-sku-cleanup" }, {
      database, scope: "linkDetail", enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES,
    });
    assert.equal(read.resolverSource, "sales_object");
    assert.equal(read.isUsable, true, "审核应用必须同步形成正式Resolver可读结构");
    assert.deepEqual(read.mappings.map((mapping) => [mapping.erpSkuId, mapping.quantity]), [["erp-sku-cleanup", 1]]);

    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES('link-sku-rollback','link-cleanup','platform-sku-rollback','pending','active',?,?)").run(stamp, stamp);
    const rollbackProposal = ensureSingleLinkSkuErpMapping(database, {
      salesLinkSkuId: "link-sku-rollback", erpSkuId: "erp-sku-cleanup", sourceType: "test", sourceBatchId: "source-rollback", timestamp: stamp,
    });
    const rollbackItem = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=?").get(rollbackProposal.applicationBatchId);
    reviewProductStructureApplicationItem(rollbackItem.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "回滚测试" }, { database });
    const beforeRollback = {
      objects: database.prepare("SELECT COUNT(*) count FROM sales_objects").get().count,
      relations: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_sales_object_relations").get().count,
      structures: database.prepare("SELECT COUNT(*) count FROM sales_object_structures").get().count,
      components: database.prepare("SELECT COUNT(*) count FROM sales_object_structure_components").get().count,
      legacyMappingsExist: tableExists("sales_link_sku_erp_mappings"),
      legacyStructuresExist: tableExists("sales_link_sku_product_structures"),
    };
    const rolledBack = applyApprovedProductStructureApplication(rollbackItem.id, { appliedBy: reviewer.id, failAfterDeactivate: true }, { database });
    assert.equal(rolledBack.outcome, "rolled_back");
    assert.deepEqual({
      objects: database.prepare("SELECT COUNT(*) count FROM sales_objects").get().count,
      relations: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_sales_object_relations").get().count,
      structures: database.prepare("SELECT COUNT(*) count FROM sales_object_structures").get().count,
      components: database.prepare("SELECT COUNT(*) count FROM sales_object_structure_components").get().count,
      legacyMappingsExist: tableExists("sales_link_sku_erp_mappings"),
      legacyStructuresExist: tableExists("sales_link_sku_product_structures"),
    }, beforeRollback);
    assert.equal(resolveLinkSkuRelationForRead({ salesLinkSkuId: "link-sku-rollback" }, { database, scope: "linkDetail" }).isUsable, false);

    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES('link-sku-manual','link-cleanup','platform-sku-manual','pending','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES('product-manual','PRODUCT-MANUAL','人工绑定产品','开发中',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES('product-map-manual','product-manual','erp-goods-cleanup','erp-sku-cleanup','ERP-SKU-CLEANUP','exact_sku','active',?,?)").run(stamp, stamp);
    const manualProposal = proposePlatformSkuProductRelation("link-sku-manual", "product-manual", reviewer.id);
    assert.equal(manualProposal.outcome, "governance_pending");
    assert.ok(manualProposal.applicationBatchId);
    assert.equal(tableExists("platform_sku_manual_bindings"), false);
    assert.equal(database.prepare("SELECT matchStatus FROM sales_link_skus WHERE id='link-sku-manual'").get().matchStatus, "pending_relation");
    assert.equal(database.prepare("SELECT matchMethod FROM sales_link_skus WHERE id='link-sku-manual'").get().matchMethod, "sales_object_approval");
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(database.pragma("foreign_key_check").length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
