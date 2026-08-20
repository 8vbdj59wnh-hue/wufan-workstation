import fs from "node:fs";
import crypto from "node:crypto";

const sourceDb = process.argv[2] || "/private/tmp/wangdian-bom-authority-phase3.db";
const platformFile = process.argv[3] || "/Users/mac/Downloads/8.19平台货品.xlsx";
const outputDb = process.argv[4] || "/private/tmp/v3-relation-main-chain-phase5.db";
const outputPath = process.argv[5] || "/private/tmp/v3-relation-main-chain-phase5-result.json";
fs.copyFileSync(sourceDb, outputDb);
process.env.WUFAN_ENV = "test";
process.env.WUFAN_DB_PATH = outputDb;
process.env.WUFAN_ALLOW_DB_RESET = "1";

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { previewPlatformGoodsExcelDataSync, commitPlatformGoodsExcelDataSync } = await import("../server/platformGoodsExcelDataSyncAdapter.js");
const { materializeOperatingErpSet } = await import("../server/operatingErpSetService.js");
const { materializeOperatingErpIdentityShadow } = await import("../server/operatingErpIdentityShadowService.js");
const { projectOperatingSalesObjects, compareV3ProjectionResolver } = await import("../server/salesObjectAutoProjectionService.js");
const { runV3RelationMainChain } = await import("../server/v3RelationMainChainService.js");
const { getLatestCompletePlatformBatch } = await import("../server/v3PlatformBatchService.js");

initializeDatabase();
const db = getDatabase();
const count = (table, where = "") => Number(db.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total);
const sha256 = (path) => crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const financial = () => db.prepare(`SELECT COUNT(*) facts,ROUND(COALESCE(SUM(salesAmount),0),4) salesAmount,
  ROUND(COALESCE(SUM(costAmount),0),4) costAmount,ROUND(COALESCE(SUM(profitAmount),0),4) profitAmount
  FROM connection_sku_sales_daily_facts`).get();
const assets = () => ({
  erpSkus: count("erp_skus"), products: count("products"), productMappings: count("product_erp_mappings"),
  salesObjects: count("sales_objects"), structures: count("sales_object_structures"), components: count("sales_object_structure_components"),
  relations: count("sales_link_sku_sales_object_relations"), v3Relations: count("sales_link_sku_sales_object_relations", "WHERE sourceType='platform_goods_v3_projection'"),
  links: count("sales_links"), linkSkus: count("sales_link_skus"), dailyFacts: count("connection_sku_sales_daily_facts"),
  inventoryFacts: count("erp_sku_inventory_daily_summaries"), legacyMappings: count("sales_link_sku_erp_mappings"),
  productStructures: count("sales_link_sku_product_structures"), productStructureComponents: count("sales_link_sku_product_structure_components"),
  manualBindings: count("platform_sku_manual_bindings"), applicationItems: count("product_structure_application_items"),
});
const platformSummary = (batchId) => db.prepare(`SELECT COUNT(*) linkSkus,
  SUM(CASE WHEN trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))<>'' THEN 1 ELSE 0 END) coded,
  SUM(CASE WHEN trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))='' THEN 1 ELSE 0 END) missingCode,
  COUNT(DISTINCT salesLinkId) links
  FROM sales_link_skus WHERE lastSeenBatchId=?`).get(batchId);

const before = { assets: assets(), financial: financial(), sourceSha256: sha256(sourceDb) };
const task = db.prepare("SELECT id FROM data_sync_tasks WHERE taskCode='platform_goods_excel_import'").get();
if (!task) throw new Error("platform_goods_excel_import_task_missing");
const buffer = fs.readFileSync(platformFile);
const preview = previewPlatformGoodsExcelDataSync({ taskId: task.id, buffer, fileName: "8.19平台货品.xlsx", createdBy: "phase5-isolated-rehearsal" });
const committed = commitPlatformGoodsExcelDataSync(preview.dataSyncBatch.id);
const latestBatch = getLatestCompletePlatformBatch(db);
const latestPlatform = platformSummary(latestBatch.id);

const operating = materializeOperatingErpSet({ database: db, calculatedAt: "2026-08-21T06:00:00.000Z" });
const identity = materializeOperatingErpIdentityShadow({ database: db, calculatedAt: "2026-08-21T06:01:00.000Z" });
const identitySummary = db.prepare(`SELECT identityStatus,COALESCE(resolvedIdentityType,'') identityType,COUNT(*) total
  FROM operating_erp_identity_observations WHERE inOperatingObjectSet=1 GROUP BY identityStatus,resolvedIdentityType ORDER BY identityStatus,resolvedIdentityType`).all();
const governance = db.prepare(`SELECT identityStatus,COUNT(*) total FROM operating_erp_identity_observations
  WHERE inOperatingObjectSet=1 AND identityStatus<>'confirmed' GROUP BY identityStatus ORDER BY identityStatus`).all();
const legacyAfterPlatform = assets();
const beforeProjection = { assets: assets(), financial: financial(), resolver: compareV3ProjectionResolver({ database: db, batchId: latestBatch.id, detailLimit: 100 }) };
const first = projectOperatingSalesObjects({ database: db, batchId: latestBatch.id, timestamp: "2026-08-21T06:02:00.000Z", relationWriteEnabled: true });
const afterFirst = { assets: assets(), financial: financial(), resolver: compareV3ProjectionResolver({ database: db, batchId: latestBatch.id, detailLimit: 100 }) };
const second = projectOperatingSalesObjects({ database: db, batchId: latestBatch.id, timestamp: "2026-08-21T06:03:00.000Z", relationWriteEnabled: true });
const afterSecond = { assets: assets(), financial: financial(), resolver: compareV3ProjectionResolver({ database: db, batchId: latestBatch.id, detailLimit: 100 }) };

const flagsOffBefore = assets();
const rollback = await runV3RelationMainChain({ batchId: latestBatch.id }, { database: db, flags: { environment: {}, projection: "off", relationWrite: false, relationRead: false } });
const flagsOffAfter = assets();
const evidenceSample = db.prepare(`SELECT id,linkSkuId,salesObjectId,sourceType,sourceBatchId,sourceReferenceJson
  FROM sales_link_sku_sales_object_relations WHERE sourceType='platform_goods_v3_projection' ORDER BY id LIMIT 5`).all().map((row) => ({ ...row, sourceReference: JSON.parse(row.sourceReferenceJson || "{}") }));
const output = {
  generatedAt: new Date().toISOString(), sourceDb, outputDb, platformFile,
  platformFileSha256: sha256(platformFile), sourceDbSha256: before.sourceSha256,
  before,
  platformImport: { preview: preview.summary, commit: committed.result, protected: committed.protected, batch: latestBatch, latestPlatform, postPlatformAssets: legacyAfterPlatform },
  operating: { summary: operating.summary, members: operating.members.length, evidence: operating.evidence.length, exceptions: operating.exceptions.length, salesPolicy: operating.salesPolicy },
  identity: { observations: identity.observations.length, comparisons: identity.comparisons.length, summary: identitySummary, governance },
  beforeProjection, first, afterFirst, second, afterSecond,
  rollback: { result: rollback, assetsUnchanged: JSON.stringify(flagsOffBefore) === JSON.stringify(flagsOffAfter) },
  evidenceSample,
  protection: {
    legacyAddedByPlatformImport: {
      legacyMappings: legacyAfterPlatform.legacyMappings - before.assets.legacyMappings,
      productStructures: legacyAfterPlatform.productStructures - before.assets.productStructures,
      manualBindings: legacyAfterPlatform.manualBindings - before.assets.manualBindings,
    },
    legacyAddedByProjection: {
      legacyMappings: afterFirst.assets.legacyMappings - beforeProjection.assets.legacyMappings,
      productStructures: afterFirst.assets.productStructures - beforeProjection.assets.productStructures,
      manualBindings: afterFirst.assets.manualBindings - beforeProjection.assets.manualBindings,
      applicationItems: afterFirst.assets.applicationItems - beforeProjection.assets.applicationItems,
    },
    factsUnchanged: JSON.stringify(beforeProjection.financial) === JSON.stringify(afterFirst.financial),
    productMappingsUnchanged: beforeProjection.assets.productMappings === afterFirst.assets.productMappings,
    inventoryUnchanged: beforeProjection.assets.inventoryFacts === afterFirst.assets.inventoryFacts,
    secondRunNoNewObjects: second.objectsCreated === 0,
    secondRunNoNewStructures: second.structuresCreated === 0,
    secondRunNoNewRelations: second.relationsCreated === 0,
    secondRunNoProvenanceUpdates: second.relationsProvenanceUpdated === 0,
    integrityCheck: db.pragma("integrity_check", { simple: true }), foreignKeyViolations: db.pragma("foreign_key_check").length,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, platformImport: output.platformImport.latestPlatform, operating: output.operating, identity: output.identity, first: { objectsCreated: first.objectsCreated, structuresCreated: first.structuresCreated, relationsCreated: first.relationsCreated, provenanceUpdated: first.relationsProvenanceUpdated, conflicts: first.relationConflicts }, second: { objectsCreated: second.objectsCreated, structuresCreated: second.structuresCreated, relationsCreated: second.relationsCreated, provenanceUpdated: second.relationsProvenanceUpdated }, protection: output.protection }, null, 2));
closeDatabase();
