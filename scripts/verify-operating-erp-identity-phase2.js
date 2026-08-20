import fs from "node:fs";
import Database from "better-sqlite3";
import { materializeOperatingErpIdentityShadow } from "../server/operatingErpIdentityShadowService.js";

const databasePath = process.env.WUFAN_DB_PATH;
if (!databasePath) throw new Error("WUFAN_DB_PATH_required");
const database = new Database(databasePath, { fileMustExist: true });
database.pragma("foreign_keys=ON");
const livePayload = process.env.LIVE_OBSERVATIONS_PATH && fs.existsSync(process.env.LIVE_OBSERVATIONS_PATH)
  ? JSON.parse(fs.readFileSync(process.env.LIVE_OBSERVATIONS_PATH, "utf8")) : { observations: {}, targetSummary: {} };

const protectedTables = [
  "erp_skus", "sales_objects", "sales_link_skus", "sales_link_sku_sales_object_relations",
  "sales_object_structures", "sales_object_structure_components", "product_erp_mappings",
  "connection_sku_sales_daily_facts", "erp_sku_inventory_daily_summaries",
];
const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
const before = Object.fromEntries(protectedTables.map((table) => [table, count(table)]));
const metricsBefore = database.prepare(`SELECT COUNT(*) facts,COALESCE(SUM(salesAmount),0) salesAmount,COALESCE(SUM(costAmount),0) cost,COALESCE(SUM(profitAmount),0) profit FROM connection_sku_sales_daily_facts`).get();
const result = materializeOperatingErpIdentityShadow({ database, liveObservations: livePayload.observations });
const after = Object.fromEntries(protectedTables.map((table) => [table, count(table)]));
const metricsAfter = database.prepare(`SELECT COUNT(*) facts,COALESCE(SUM(salesAmount),0) salesAmount,COALESCE(SUM(costAmount),0) cost,COALESCE(SUM(profitAmount),0) profit FROM connection_sku_sales_daily_facts`).get();

const latestBatch = database.prepare(`SELECT id,businessDate,completedAt,createdAt,originalFilename FROM erp_import_batches
  WHERE importType='platform_goods' AND status='completed' AND (importMode IS NULL OR trim(importMode)='' OR importMode='full')
  ORDER BY COALESCE(businessDate,substr(completedAt,1,10),substr(createdAt,1,10)) DESC,COALESCE(completedAt,createdAt) DESC LIMIT 1`).get();
const missingCurrent = database.prepare(`SELECT COUNT(*) total,COUNT(DISTINCT salesLinkId) affectedLinks,
    SUM(CASE WHEN erpSkuId IS NOT NULL THEN 1 ELSE 0 END) hasErpSkuId,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM sales_link_sku_sales_object_relations r WHERE r.linkSkuId=s.id AND r.status='active') THEN 1 ELSE 0 END) hasActiveRelation
  FROM sales_link_skus s WHERE s.lastSeenBatchId=? AND trim(COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode,''))=''`).get(latestBatch.id);

const liveRows = Object.values(livePayload.observations || {});
const liveSummary = {
  targeted: liveRows.length,
  liveGoodsRequests: liveRows.filter((item) => item.reason === "unresolved" && item.goodsChecked).length,
  materializedGoodsChecks: liveRows.filter((item) => item.goodsBasis === "materialized_goods_snapshot_not_found").length,
  liveSuiteRequests: liveRows.filter((item) => item.suiteChecked).length,
  goodsFound: liveRows.filter((item) => item.goods).length,
  suitesFound: liveRows.filter((item) => item.suite).length,
  goodsErrors: liveRows.filter((item) => item.goodsError).length,
  suiteErrors: liveRows.filter((item) => item.suiteError).length,
  unresolvedReasons: Object.fromEntries([...new Set(liveRows.filter((item) => item.reason === "unresolved").map((item) => {
    if (item.goodsError || item.suiteError) return "api_failure";
    if (item.goods && item.suite) return "sku_type_conflict";
    if (item.suite?.deleted) return "historical_bundle_deleted";
    if (item.goods) return "single_found";
    if (item.suite) return "bundle_found";
    return "not_found";
  }))].map((reason) => [reason, liveRows.filter((item) => item.reason === "unresolved").filter((item) => {
    if (reason === "api_failure") return item.goodsError || item.suiteError;
    if (reason === "sku_type_conflict") return item.goods && item.suite;
    if (reason === "historical_bundle_deleted") return item.suite?.deleted && !item.goods && !item.goodsError && !item.suiteError;
    if (reason === "single_found") return item.goods && !item.suite && !item.goodsError && !item.suiteError;
    if (reason === "bundle_found") return item.suite && !item.goods && !item.goodsError && !item.suiteError;
    return !item.goods && !item.suite && !item.goodsError && !item.suiteError;
  }).length])),
};

const currentProjection = database.prepare(`SELECT
    COUNT(*) total,
    SUM(CASE WHEN objectType='single' THEN 1 ELSE 0 END) singles,
    SUM(CASE WHEN objectType='bundle' THEN 1 ELSE 0 END) bundles
  FROM sales_objects WHERE id IN (
    SELECT DISTINCT o.id FROM operating_erp_set_members m JOIN sales_objects o ON o.normalizedObjectCode=m.normalizedCode
    WHERE m.lifecycleStatus IN ('active','sales_active','unresolved')
  )`).get();
const formalObjectTotal = count("sales_objects");
const output = {
  generatedAt: new Date().toISOString(),
  databasePath,
  latestBatch,
  missingCurrent,
  liveTargetSummary: livePayload.targetSummary || {},
  liveSummary,
  shadowSummary: result.summary,
  currentProjection: { ...currentProjection, formalObjectTotal, historicalOrNonOperating: formalObjectTotal - Number(currentProjection.total || 0) },
  protection: {
    before, after, unchanged: JSON.stringify(before) === JSON.stringify(after),
    metricsBefore, metricsAfter, metricsUnchanged: JSON.stringify(metricsBefore) === JSON.stringify(metricsAfter),
    integrityCheck: database.pragma("integrity_check", { simple: true }),
    foreignKeyErrors: database.pragma("foreign_key_check").length,
  },
  exceptions: result.comparisons.filter((item) => item.comparisonStatus !== "consistent" || ["bom_missing","component_missing","quantity_invalid","structure_conflict"].includes(item.bundleStructureStatus)),
};
process.stdout.write(JSON.stringify(output, null, 2));
database.close();
