import fs from "node:fs";
import crypto from "node:crypto";

const sourceDb = process.argv[2] || "/private/tmp/wangdian-bom-authority-phase3.db";
const platformFile = process.argv[3] || "/Users/mac/Downloads/8.19平台货品.xlsx";
const livePath = process.argv[4] || "/private/tmp/v3-phase5-live-observations.json";
const outputDb = process.argv[5] || "/private/tmp/v3-relation-main-chain-phase5-live.db";
const outputPath = process.argv[6] || "/private/tmp/v3-relation-main-chain-phase5-live-result.json";
fs.copyFileSync(sourceDb, outputDb);
process.env.WUFAN_ENV = "test"; process.env.WUFAN_DB_PATH = outputDb; process.env.WUFAN_ALLOW_DB_RESET = "1";

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { previewPlatformGoodsExcelDataSync, commitPlatformGoodsExcelDataSync } = await import("../server/platformGoodsExcelDataSyncAdapter.js");
const { materializeOperatingErpSet } = await import("../server/operatingErpSetService.js");
const { materializeOperatingErpIdentityShadow } = await import("../server/operatingErpIdentityShadowService.js");
const { projectOperatingSalesObjects, compareV3ProjectionResolver } = await import("../server/salesObjectAutoProjectionService.js");
const { getLatestCompletePlatformBatch } = await import("../server/v3PlatformBatchService.js");
initializeDatabase();
const db = getDatabase();
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const observations = live.observations || {};
const normalize = (value) => String(value ?? "").trim().replace(/\.0+$/u, "").toLowerCase();
const count = (table, where = "") => Number(db.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total);
const assets = () => ({ salesObjects: count("sales_objects"), structures: count("sales_object_structures"), components: count("sales_object_structure_components"), relations: count("sales_link_sku_sales_object_relations"), v3Relations: count("sales_link_sku_sales_object_relations", "WHERE sourceType='platform_goods_v3_projection'"), legacyMappings: count("sales_link_sku_erp_mappings"), productStructures: count("sales_link_sku_product_structures"), applicationItems: count("product_structure_application_items"), dailyFacts: count("connection_sku_sales_daily_facts"), productMappings: count("product_erp_mappings"), inventoryFacts: count("erp_sku_inventory_daily_summaries") });
const financial = () => db.prepare("SELECT COUNT(*) facts,ROUND(COALESCE(SUM(salesAmount),0),4) salesAmount,ROUND(COALESCE(SUM(costAmount),0),4) costAmount,ROUND(COALESCE(SUM(profitAmount),0),4) profitAmount FROM connection_sku_sales_daily_facts").get();
const before = { assets: assets(), financial: financial() };
const task = db.prepare("SELECT id FROM data_sync_tasks WHERE taskCode='platform_goods_excel_import'").get();
const preview = previewPlatformGoodsExcelDataSync({ taskId: task.id, buffer: fs.readFileSync(platformFile), fileName: "8.19平台货品.xlsx", createdBy: "phase5-live-rehearsal" });
const commit = commitPlatformGoodsExcelDataSync(preview.dataSyncBatch.id);
const batch = getLatestCompletePlatformBatch(db);
const operating = materializeOperatingErpSet({ database: db, calculatedAt: "2026-08-21T08:00:00Z" });
const identity = materializeOperatingErpIdentityShadow({ database: db, calculatedAt: "2026-08-21T08:01:00Z", liveObservations: observations });
const erpByCode = new Map(db.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all().map((row) => [normalize(row.merchantSkuCode), row.id]));
const bundleSources = {};
for (const [code, observation] of Object.entries(observations)) {
  if (!observation.suite || observation.suite.deleted) continue;
  const components = observation.suite.components.filter((item) => !item.deleted).map((item) => ({ erpSkuId: erpByCode.get(normalize(item.skuCode)) || null, quantity: Number(item.quantity) }));
  if (components.length && components.every((item) => item.erpSkuId && item.quantity > 0)) bundleSources[normalize(code)] = { sourceUpdatedAt: observation.suite.modifiedAt || null, components };
}
const beforeProjection = { assets: assets(), financial: financial(), resolver: compareV3ProjectionResolver({ database: db, batchId: batch.id, detailLimit: 100 }) };
const first = projectOperatingSalesObjects({ database: db, batchId: batch.id, timestamp: "2026-08-21T08:02:00Z", relationWriteEnabled: true, bundleSources });
const afterFirst = { assets: assets(), financial: financial(), resolver: compareV3ProjectionResolver({ database: db, batchId: batch.id, detailLimit: 100 }) };
const second = projectOperatingSalesObjects({ database: db, batchId: batch.id, timestamp: "2026-08-21T08:03:00Z", relationWriteEnabled: true, bundleSources });
const afterSecond = { assets: assets(), financial: financial() };
const linkSummary = db.prepare(`SELECT COUNT(*) linkSkus,COUNT(DISTINCT salesLinkId) links,
  SUM(trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))<>'') coded,
  SUM(trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))='') missingCode,
  SUM(EXISTS(SELECT 1 FROM sales_link_sku_sales_object_relations r WHERE r.linkSkuId=sales_link_skus.id AND r.status='active')) related
  FROM sales_link_skus WHERE lastSeenBatchId=?`).get(batch.id);
const identityStatus = db.prepare("SELECT identityStatus,resolvedIdentityType,COUNT(*) total FROM operating_erp_identity_observations WHERE inOperatingObjectSet=1 GROUP BY identityStatus,resolvedIdentityType ORDER BY identityStatus,resolvedIdentityType").all();
const output = {
  generatedAt: new Date().toISOString(), sourceDb, outputDb, platformFile, platformFileSha256: crypto.createHash("sha256").update(fs.readFileSync(platformFile)).digest("hex"), liveSummary: live.summary,
  before, platform: { batch, preview: preview.summary, commit: commit.result, linkSummary }, operating: operating.summary, identity: { summary: identity.summary, status: identityStatus },
  beforeProjection, first, afterFirst, second, afterSecond,
  protection: {
    legacyAdded: { mappings: afterFirst.assets.legacyMappings - before.assets.legacyMappings, productStructures: afterFirst.assets.productStructures - before.assets.productStructures, applicationItems: afterFirst.assets.applicationItems - before.assets.applicationItems },
    factsUnchanged: JSON.stringify(before.financial) === JSON.stringify(afterFirst.financial), productMappingsUnchanged: before.assets.productMappings === afterFirst.assets.productMappings, inventoryUnchanged: before.assets.inventoryFacts === afterFirst.assets.inventoryFacts,
    secondRunCompletelyIdempotent: second.objectsCreated === 0 && second.structuresCreated === 0 && second.relationsCreated === 0 && second.relationsProvenanceUpdated === 0,
    integrityCheck: db.pragma("integrity_check", { simple: true }), foreignKeyViolations: db.pragma("foreign_key_check").length,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, liveSummary: output.liveSummary, linkSummary, operating: output.operating, identity: output.identity, first: { objectsCreated: first.objectsCreated, structuresCreated: first.structuresCreated, relationsCreated: first.relationsCreated, provenanceUpdated: first.relationsProvenanceUpdated, conflicts: first.relationConflicts, exceptions: first.exceptions.length }, resolverAfter: afterFirst.resolver.summary, second: { objectsCreated: second.objectsCreated, structuresCreated: second.structuresCreated, relationsCreated: second.relationsCreated, provenanceUpdated: second.relationsProvenanceUpdated }, protection: output.protection }, null, 2));
closeDatabase();
