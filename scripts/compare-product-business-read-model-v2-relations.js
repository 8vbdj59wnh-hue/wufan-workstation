import Database from "better-sqlite3";
import { linkPerformanceMetrics, readProductBusinessRelationContext, salesMetrics, structureMetrics } from "../server/productBusinessReadModel.js";

const source = String(process.env.PRODUCT_BUSINESS_COMPARE_DB_PATH ?? "").trim();
const AMOUNT_TOLERANCE = 0.000001;
if (!source) throw new Error("请通过PRODUCT_BUSINESS_COMPARE_DB_PATH指定只读数据库快照。");
const database = new Database(source, { readonly: true, fileMustExist: true });
const periodEnd = String(process.env.PERIOD_END || database.prepare("SELECT MAX(periodEnd) value FROM connection_sku_sales_facts").get()?.value || "").slice(0, 10);
if (!periodEnd) throw new Error("销售事实中没有可用周期。");
const end = new Date(`${periodEnd}T00:00:00Z`); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 29);
const periodStart = start.toISOString().slice(0, 10);
const protectedTables = ["sales_links", "sales_link_skus", "sales_link_sku_erp_mappings", "connection_sku_sales_facts", "connection_sku_sales_daily_facts", "products", "erp_skus"];
const counts = () => Object.fromEntries(protectedTables.map((table) => [table, Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));
const before = counts();
const legacyRows = database.prepare(`
  SELECT s.productId,COUNT(DISTINCT f.id) factCount,SUM(f.salesAmount) salesAmount,SUM(f.shippedQuantity) salesQuantity,SUM(f.profitAmount) grossProfit
  FROM connection_sku_sales_facts f JOIN sales_link_skus s ON s.id=f.salesLinkSkuId
  WHERE s.productId IS NOT NULL AND f.periodStart>=? AND f.periodEnd<=?
    AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual')
  GROUP BY s.productId
`).all(periodStart, periodEnd);
const legacyLinks = new Map(database.prepare(`SELECT s.productId,COUNT(DISTINCT s.salesLinkId) count FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
  WHERE s.productId IS NOT NULL AND COALESCE(s.currentState,'active')='active' AND COALESCE(l.currentState,'active')='active'
    AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual') GROUP BY s.productId`).all().map((row) => [row.productId, Number(row.count)]));
const legacy = new Map(legacyRows.map((row) => [row.productId, row]));
const context = readProductBusinessRelationContext(database);
const current = salesMetrics(database, periodStart, periodEnd, context);
const structures = structureMetrics(database, context);
const performance = linkPerformanceMetrics(database, periodStart, periodEnd, context);
const productIds = [...new Set([...legacy.keys(), ...current.keys(), ...legacyLinks.keys(), ...structures.links.keys()])];
const differenceRows = productIds.map((productId) => {
  const oldRow = legacy.get(productId); const newRow = current.get(productId);
  const salesDifference = Number(newRow?.salesAmount || 0) - Number(oldRow?.salesAmount || 0);
  const profitDifference = Number(newRow?.grossProfit || 0) - Number(oldRow?.grossProfit || 0);
  const legacyLinkCount = legacyLinks.get(productId) || 0;
  const v2LinkCount = structures.links.get(productId) || 0;
  return { productId, legacySalesAmount: Number(oldRow?.salesAmount || 0), v2SalesAmount: Number(newRow?.salesAmount || 0),
    salesDifference, legacyProfit: Number(oldRow?.grossProfit || 0), v2Profit: Number(newRow?.grossProfit || 0), profitDifference,
    legacyLinkCount, v2LinkCount, linkDifference: v2LinkCount - legacyLinkCount,
    hasSalesDifference: Math.abs(salesDifference) > AMOUNT_TOLERANCE,
    hasProfitDifference: Math.abs(profitDifference) > AMOUNT_TOLERANCE,
    hasLinkDifference: legacyLinkCount !== v2LinkCount };
}).filter((row) => row.hasSalesDifference || row.hasProfitDifference || row.hasLinkDifference)
  .sort((left, right) => Math.max(Math.abs(right.salesDifference), Math.abs(right.profitDifference), Math.abs(right.linkDifference))
    - Math.max(Math.abs(left.salesDifference), Math.abs(left.profitDifference), Math.abs(left.linkDifference)));
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const result = { periodStart, periodEnd, legacy: { productCount: legacy.size, salesAmount: sum(legacyRows, "salesAmount"), profitAmount: sum(legacyRows, "grossProfit"), linkProductCount: legacyLinks.size },
  v2: { productCount: current.size, salesAmount: sum([...current.values()], "salesAmount"), profitAmount: sum([...current.values()], "grossProfit"), linkProductCount: structures.links.size,
    resolvedLinkSkuCount: context.resolvedLinkSkuCount, performanceProductCount: performance.size },
  differences: { productCount: differenceRows.length,
    salesDifferenceProductCount: differenceRows.filter((row) => row.hasSalesDifference).length,
    profitDifferenceProductCount: differenceRows.filter((row) => row.hasProfitDifference).length,
    linkDifferenceProductCount: differenceRows.filter((row) => row.hasLinkDifference).length,
    amountTolerance: AMOUNT_TOLERANCE, top: differenceRows.slice(0, 30) }, protectedTables: { before, after: counts(), unchanged: JSON.stringify(before) === JSON.stringify(counts()) },
  integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheck: database.pragma("foreign_key_check").length };
console.log(JSON.stringify(result, null, 2));
database.close();
