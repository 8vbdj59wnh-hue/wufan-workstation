import fs from "node:fs";

const sourceDb = process.argv[2] || "/private/tmp/wangdian-bom-authority-phase3.db";
const outputDb = process.argv[3] || "/private/tmp/sales-object-projection-phase4.db";
const outputPath = process.argv[4] || "/private/tmp/sales-object-projection-phase4-result.json";
fs.copyFileSync(sourceDb, outputDb);
process.env.WUFAN_ENV = "test";
process.env.WUFAN_DB_PATH = outputDb;
process.env.WUFAN_ALLOW_DB_RESET = "1";

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const {
  classifySalesObjectLifecycle,
  compareV3ProjectionResolver,
  projectOperatingSalesObjects,
} = await import("../server/salesObjectAutoProjectionService.js");
initializeDatabase();
const db = getDatabase();
const count = (table) => Number(db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const metrics = () => db.prepare(`SELECT COUNT(*) facts,ROUND(COALESCE(SUM(salesAmount),0),4) salesAmount,
  ROUND(COALESCE(SUM(costAmount),0),4) costAmount,ROUND(COALESCE(SUM(profitAmount),0),4) profitAmount
  FROM connection_sku_sales_daily_facts`).get();
const protectedCounts = () => ({
  erpSkus: count("erp_skus"), products: count("products"), productMappings: count("product_erp_mappings"),
  dailyFacts: count("connection_sku_sales_daily_facts"), productStructures: count("sales_link_sku_product_structures"),
  productStructureComponents: count("sales_link_sku_product_structure_components"), legacyMappings: count("sales_link_sku_erp_mappings"),
});
const projectionCounts = () => ({
  salesObjects: count("sales_objects"), structures: count("sales_object_structures"),
  components: count("sales_object_structure_components"), relations: count("sales_link_sku_sales_object_relations"),
});
const readProjectionLegacyCounts = () => ({
  productStructures: count("sales_link_sku_product_structures"),
  productStructureComponents: count("sales_link_sku_product_structure_components"),
  legacyMappings: count("sales_link_sku_erp_mappings"),
  applicationItems: count("product_structure_application_items"),
});
const known = () => db.prepare(`SELECT o.normalizedObjectCode,o.id salesObjectId,o.objectType,s.id structureId,
  (SELECT COUNT(*) FROM sales_link_sku_sales_object_relations r WHERE r.salesObjectId=o.id AND r.status='active') activeRelations
  FROM sales_objects o LEFT JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
  WHERE o.normalizedObjectCode IN ('hp1025-1','hp1055-1') ORDER BY o.normalizedObjectCode`).all();

const before = {
  protected: protectedCounts(), projection: projectionCounts(), metrics: metrics(), legacy: readProjectionLegacyCounts(),
  resolver: compareV3ProjectionResolver({ database: db }), knownMissing: known(),
};
const normalLegacyApprovals = Number(db.prepare(`SELECT COUNT(*) total FROM product_structure_application_items i
  JOIN sales_link_skus s ON s.id=i.salesLinkSkuId JOIN operating_erp_identity_observations o
    ON o.normalizedCode=lower(trim(COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode,'')))
  WHERE o.inOperatingObjectSet=1 AND o.identityStatus='confirmed'`).get().total);
const first = projectOperatingSalesObjects({ database: db, timestamp: "2026-08-21T00:00:00.000Z" });
const afterFirst = {
  protected: protectedCounts(), projection: projectionCounts(), metrics: metrics(), legacy: readProjectionLegacyCounts(),
  resolver: compareV3ProjectionResolver({ database: db }), knownProjected: known(), lifecycle: classifySalesObjectLifecycle({ database: db }),
};
const second = projectOperatingSalesObjects({ database: db, timestamp: "2026-08-21T01:00:00.000Z" });
const afterSecond = { protected: protectedCounts(), projection: projectionCounts(), metrics: metrics(), legacy: readProjectionLegacyCounts() };
const latestBatch = first.batch;
const latestLinkSummary = db.prepare(`SELECT COUNT(*) total,
  SUM(CASE WHEN trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))='' THEN 1 ELSE 0 END) missingCode,
  SUM(CASE WHEN EXISTS(SELECT 1 FROM sales_link_sku_sales_object_relations r WHERE r.linkSkuId=s.id AND r.status='active') THEN 1 ELSE 0 END) related
  FROM sales_link_skus s WHERE lastSeenBatchId=?`).get(latestBatch.id);
const identityGovernance = db.prepare(`SELECT identityStatus,COUNT(*) total FROM operating_erp_identity_observations
  WHERE inOperatingObjectSet=1 AND identityStatus<>'confirmed' GROUP BY identityStatus ORDER BY identityStatus`).all();
const output = {
  generatedAt: new Date().toISOString(), sourceDatabase: sourceDb, isolatedDatabase: outputDb, latestBatch,
  before, projection: first, repeatedProjection: second, afterFirst, afterSecond,
  acceptance: {
    currentCandidates: first.candidateCount,
    autoProjected: Object.keys(first.projectedByCode).length,
    autoProjectionRate: first.confirmedCount / first.candidateCount,
    singleProjectionRate: first.singleCount / 2724,
    bundleProjectionRate: first.bundleCount / 3642,
    linkSkuTotal: Number(latestLinkSummary.total), linkSkuMissingCode: Number(latestLinkSummary.missingCode),
    linkSkuRelated: Number(latestLinkSummary.related), linkSkuRelationRate: Number(latestLinkSummary.related) / Number(latestLinkSummary.total),
    linkSkuCodedTotal: Number(latestLinkSummary.total) - Number(latestLinkSummary.missingCode),
    linkSkuCodedRelationRate: Number(latestLinkSummary.related) / (Number(latestLinkSummary.total) - Number(latestLinkSummary.missingCode)),
    v3NewObjects: first.objectsCreated, v3NewRelations: first.relationsCreated, trueRelationConflicts: first.relationConflicts,
    normalApprovalHistoricalBurden: normalLegacyApprovals, normalApprovalAdded: afterFirst.legacy.applicationItems - before.legacy.applicationItems,
    productStructuresAdded: afterFirst.legacy.productStructures - before.legacy.productStructures,
    legacyMappingsAdded: afterFirst.legacy.legacyMappings - before.legacy.legacyMappings,
    productMappingGovernance: first.productMappingGovernance,
    identityGovernance,
  },
  protection: {
    protectedUnchanged: JSON.stringify(before.protected) === JSON.stringify(afterFirst.protected),
    metricsUnchanged: JSON.stringify(before.metrics) === JSON.stringify(afterFirst.metrics),
    idempotentProjectionCounts: JSON.stringify(afterFirst.projection) === JSON.stringify(afterSecond.projection),
    legacyUnchanged: JSON.stringify(before.legacy) === JSON.stringify(afterFirst.legacy),
    integrityCheck: db.pragma("integrity_check", { simple: true }), foreignKeyViolations: db.pragma("foreign_key_check").length,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
closeDatabase();
