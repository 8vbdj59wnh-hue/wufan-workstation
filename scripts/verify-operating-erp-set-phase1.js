import { getDatabase, initializeDatabase } from "../server/db.js";
import {
  materializeOperatingErpSet,
  simulateOperatingErpImpacts,
} from "../server/operatingErpSetService.js";

function count(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
}

function protectedBaseline(database) {
  const metrics = database.prepare(`SELECT COUNT(*) dailyFacts,COALESCE(SUM(salesAmount),0) salesAmount,
    COALESCE(SUM(costAmount),0) costAmount,COALESCE(SUM(profitAmount),0) profitAmount
    FROM connection_sku_sales_daily_facts`).get();
  return {
    erpSkus: count(database, "erp_skus"),
    salesObjects: count(database, "sales_objects"),
    products: count(database, "products"),
    productMappings: count(database, "product_erp_mappings"),
    dailyFacts: Number(metrics.dailyFacts),
    salesAmount: Number(metrics.salesAmount),
    costAmount: Number(metrics.costAmount),
    profitAmount: Number(metrics.profitAmount),
    links: count(database, "sales_links"),
    linkSkus: count(database, "sales_link_skus"),
    inventoryFacts: count(database, "erp_sku_warehouse_inventory_facts"),
    inventorySummaries: count(database, "erp_sku_inventory_daily_summaries"),
  };
}

initializeDatabase();
const database = getDatabase();
const before = protectedBaseline(database);
const calculation = materializeOperatingErpSet({ database, calculatedAt: new Date().toISOString() });
const after = protectedBaseline(database);
const exceptionCounts = calculation.exceptions.reduce((result, item) => {
  result[item.type] = (result[item.type] || 0) + 1;
  return result;
}, {});
const lifecycleCounts = Object.fromEntries(database.prepare(`SELECT lifecycleStatus,COUNT(*) total
  FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL GROUP BY lifecycleStatus ORDER BY lifecycleStatus`).all()
  .map((item) => [item.lifecycleStatus, Number(item.total)]));
const sourceCounts = Object.fromEntries(database.prepare(`SELECT sourceType,COUNT(DISTINCT normalizedCode) total
  FROM operating_erp_set_evidence WHERE active=1 GROUP BY sourceType ORDER BY sourceType`).all()
  .map((item) => [item.sourceType, Number(item.total)]));
const multipleSourceSamples = database.prepare(`SELECT m.merchantSkuCode,group_concat(DISTINCT e.sourceType) sourceTypes
  FROM operating_erp_set_members m JOIN operating_erp_set_evidence e ON e.normalizedCode=m.normalizedCode AND e.active=1
  WHERE m.erpSkuId IS NOT NULL GROUP BY m.normalizedCode HAVING COUNT(DISTINCT e.sourceType)>1
  ORDER BY COUNT(DISTINCT e.sourceType) DESC,m.merchantSkuCode LIMIT 20`).all();
const checks = {
  protectedDataUnchanged: JSON.stringify(before) === JSON.stringify(after),
  integrity: database.pragma("integrity_check", { simple: true }),
  foreignKeyErrors: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify({
  databasePath: process.env.WUFAN_DB_PATH,
  platformBatch: calculation.platformBatch,
  salesPolicy: calculation.salesPolicy,
  summary: calculation.summary,
  lifecycleCounts,
  sourceCounts,
  impacts: simulateOperatingErpImpacts(calculation, { database }),
  exceptionCounts,
  exceptionSamples: calculation.exceptions.slice(0, 30),
  multipleSourceSamples,
  before,
  after,
  checks,
}, null, 2));
