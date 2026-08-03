import { getDatabase } from "./db.js";
import { listConnectionProfiles, readConnectionProfile } from "./connectionService.js";

function text(value) { return String(value ?? "").trim(); }
function parseJson(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function periodType(start, end) {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 1) return "day";
  if (days <= 7) return "week";
  return "month";
}

function latestSalesSummary(database, salesLinkId) {
  const period = database.prepare(`SELECT periodStart,periodEnd FROM connection_sku_sales_facts WHERE salesLinkId=? ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1`).get(salesLinkId);
  if (!period) return { periodStart: null, periodEnd: null, shippedQuantity: null, salesAmount: null, costAmount: null, profitAmount: null, profitMargin: null };
  const row = database.prepare(`SELECT SUM(COALESCE(shippedQuantity,0)) shippedQuantity,SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount FROM connection_sku_sales_facts WHERE salesLinkId=? AND periodStart=? AND periodEnd=?`).get(salesLinkId, period.periodStart, period.periodEnd);
  return { ...period, ...row, profitMargin: Number(row.salesAmount) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null };
}

export function listConnectionCoreProfiles(userId = "", isAdmin = false) {
  const database = getDatabase();
  return listConnectionProfiles().filter((item) => isAdmin || !text(userId) || item.ownerId === text(userId)).map((item) => {
    const sales = latestSalesSummary(database, item.salesLinkId);
    const relation = database.prepare(`SELECT COUNT(*) skuCount,COUNT(DISTINCT productId) productCount FROM sales_link_skus WHERE salesLinkId=? AND COALESCE(currentState,'active')='active'`).get(item.salesLinkId);
    return { ...item, erpSales: sales, skuCount: Number(relation.skuCount || 0), productCount: Number(relation.productCount || 0) };
  });
}

export function getConnectionCoreDetail(connectionId, userId = "", isAdmin = false) {
  const database = getDatabase(); const profile = readConnectionProfile(connectionId);
  if (!isAdmin && text(userId) && profile.ownerId !== text(userId)) throw new Error("只能查看自己负责的链接。");
  const salesOverview = latestSalesSummary(database, profile.salesLinkId);
  const platformRow = database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId=? ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1`).get(profile.salesLinkId);
  const platformPerformance = platformRow ? { ...platformRow, metrics: parseJson(platformRow.metricsJson) } : null;
  const erpTrend = database.prepare(`SELECT periodStart,periodEnd,SUM(COALESCE(shippedQuantity,0)) shippedQuantity,SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount FROM connection_sku_sales_facts WHERE salesLinkId=? GROUP BY periodStart,periodEnd ORDER BY periodEnd,periodStart`).all(profile.salesLinkId).map((row) => ({ ...row, periodType: periodType(row.periodStart, row.periodEnd) }));
  const skuSales = salesOverview.periodEnd ? database.prepare(`
    SELECT f.salesLinkSkuId,f.skuCode,COALESCE(s.specificationName,p.name,'未命名SKU') skuName,p.id productId,
      SUM(COALESCE(f.shippedQuantity,0)) shippedQuantity,SUM(COALESCE(f.salesAmount,0)) salesAmount,SUM(COALESCE(f.profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts f JOIN sales_link_skus s ON s.id=f.salesLinkSkuId LEFT JOIN products p ON p.id=s.productId
    WHERE f.salesLinkId=? AND f.periodStart=? AND f.periodEnd=? GROUP BY f.salesLinkSkuId,f.skuCode,s.specificationName,p.name,p.id ORDER BY salesAmount DESC,f.skuCode
  `).all(profile.salesLinkId, salesOverview.periodStart, salesOverview.periodEnd).map((row) => ({ ...row, salesShare: Number(salesOverview.salesAmount) ? Number(row.salesAmount || 0) / Number(salesOverview.salesAmount) : 0 })) : [];
  const products = database.prepare(`SELECT p.id,p.skuCode,p.name,p.mainImage,COUNT(s.id) skuCount FROM sales_link_skus s JOIN products p ON p.id=s.productId WHERE s.salesLinkId=? AND COALESCE(s.currentState,'active')='active' GROUP BY p.id,p.skuCode,p.name,p.mainImage ORDER BY p.skuCode,p.id`).all(profile.salesLinkId);
  const relation = database.prepare(`SELECT COUNT(*) skuCount,COUNT(DISTINCT productId) productCount FROM sales_link_skus WHERE salesLinkId=? AND COALESCE(currentState,'active')='active'`).get(profile.salesLinkId);
  const inventory = database.prepare(`
    SELECT i.salesLinkSkuId,i.skuCode,i.businessDate,i.currentStock,i.availableStock,i.unitCost,i.salesVelocity,s.specificationName,p.id productId,p.name productName
    FROM connection_sku_inventory_facts i JOIN sales_link_skus s ON s.id=i.salesLinkSkuId LEFT JOIN products p ON p.id=s.productId
    WHERE s.salesLinkId=? AND i.businessDate=(SELECT MAX(latest.businessDate) FROM connection_sku_inventory_facts latest WHERE latest.salesLinkSkuId=i.salesLinkSkuId)
    ORDER BY i.skuCode,i.salesLinkSkuId
  `).all(profile.salesLinkId).map((row) => { const days = Number(row.salesVelocity) > 0 ? Number(row.availableStock || 0) / Number(row.salesVelocity) : null; return { ...row, stockDays: days, stockRisk: Number(row.availableStock || 0) <= 0 ? "out" : days !== null && days < 7 ? "low" : days !== null && days > 90 ? "high" : "normal" }; });
  return { profile: { ...profile, erpSales: salesOverview, skuCount: Number(relation.skuCount || 0), productCount: Number(relation.productCount || 0) }, salesOverview, platformPerformance, erpTrend, skuSales, products, inventory };
}
