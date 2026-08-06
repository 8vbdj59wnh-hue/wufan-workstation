import { getDatabase } from "./db.js";
import { listConnectionProfiles, readConnectionProfile } from "./connectionService.js";
import { readConnectionV3Metrics, readConnectionV3MetricsMap } from "./connectionV3MetricsService.js";

function text(value) { return String(value ?? "").trim(); }
function parseJson(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function periodType(start, end) {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 1) return "day";
  if (days <= 7) return "week";
  return "month";
}

function latestSalesSummary(database, salesLinkId) {
  return readConnectionV3Metrics(salesLinkId).current;
}

function readRelationCounts(database, salesLinkIds) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const marks = ids.map(() => "?").join(",");
  return new Map(database.prepare(`
    SELECT x.salesLinkId,COUNT(DISTINCT x.id) skuCount,COUNT(DISTINCT pm.productId) productCount
    FROM sales_link_skus x
    LEFT JOIN sales_link_sku_erp_mappings m ON m.salesLinkSkuId=x.id AND m.currentState='active'
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=m.erpSkuId AND pm.currentState='active'
    WHERE x.salesLinkId IN (${marks}) AND COALESCE(x.currentState,'active')='active'
    GROUP BY x.salesLinkId
  `).all(...ids).map((row) => [row.salesLinkId, row]));
}

const connectionSortColumns = {
  default: "c.updatedAt", newest: "c.createdAt", name: "c.name", platform: "sh.platform",
  shop: "sh.displayName", goodsId: "l.platformGoodsId", owner: "ownerName", status: "c.status",
  erpSales: "COALESCE((SELECT SUM(sf.salesAmount) FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id),0)",
  erpProfit: "COALESCE((SELECT SUM(sf.profitAmount) FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id),0)",
  relations: "(SELECT COUNT(*) FROM sales_link_skus sx2 WHERE sx2.salesLinkId=l.id AND COALESCE(sx2.currentState,'active')='active')",
};

function listOptions(raw = {}) {
  const pageSize = Math.min(200, Math.max(20, Number(raw.pageSize) || 50));
  const page = Math.max(1, Number(raw.page) || 1);
  return { ...raw, page, pageSize, offset: (page - 1) * pageSize };
}

/** Lightweight, SQL-paged list used by the V2 link asset UI. */
export function listConnectionCoreProfilesPage(rawOptions = {}, userId = "", isAdmin = false) {
  const database = getDatabase();
  const options = listOptions(rawOptions);
  const where = ["1=1"];
  const params = {};
  if (!isAdmin) { where.push("c.ownerId=@scopeOwnerId"); params.scopeOwnerId = text(userId); }
  if (text(options.keyword)) { where.push("(c.name LIKE @keyword OR l.title LIKE @keyword OR l.platformGoodsId LIKE @keyword OR l.platformGoodsCode LIKE @keyword)"); params.keyword = `%${text(options.keyword)}%`; }
  for (const [key, column] of [["platform", "sh.platform"], ["shopId", "l.shopId"], ["ownerId", "c.ownerId"], ["status", "c.status"]]) {
    if (text(options[key]) && !["assigned", "unassigned"].includes(text(options[key]))) { where.push(`${column}=@${key}`); params[key] = text(options[key]); }
  }
  if (options.ownerId === "assigned") where.push("c.ownerId IS NOT NULL AND c.ownerId<>''");
  if (options.ownerId === "unassigned") where.push("(c.ownerId IS NULL OR c.ownerId='')");
  if (text(options.productCode)) { where.push("EXISTS (SELECT 1 FROM sales_link_skus sx JOIN sales_link_sku_erp_mappings mx ON mx.salesLinkSkuId=sx.id AND mx.currentState='active' JOIN erp_skus es ON es.id=mx.erpSkuId WHERE sx.salesLinkId=l.id AND es.merchantSkuCode LIKE @productCode)"); params.productCode = `%${text(options.productCode)}%`; }
  if (options.salesStatus === "selling") where.push("EXISTS (SELECT 1 FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id AND COALESCE(sf.shippedQuantity,0)>0)");
  if (options.salesStatus === "stopped") where.push("NOT EXISTS (SELECT 1 FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id AND COALESCE(sf.shippedQuantity,0)>0)");
  if (options.profitStatus === "profit") where.push("COALESCE((SELECT SUM(sf.profitAmount) FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id),0)>=0");
  if (options.profitStatus === "loss") where.push("COALESCE((SELECT SUM(sf.profitAmount) FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id),0)<0");
  if (options.profitStatus === "unknown") where.push("NOT EXISTS (SELECT 1 FROM connection_sku_sales_facts sf WHERE sf.salesLinkId=l.id)");
  const relationExists = "EXISTS (SELECT 1 FROM sales_link_skus sx JOIN sales_link_sku_erp_mappings mx ON mx.salesLinkSkuId=sx.id AND mx.currentState='active' WHERE sx.salesLinkId=l.id)";
  if (options.productRelation === "linked") where.push(relationExists);
  if (options.productRelation === "unlinked") where.push(`NOT ${relationExists}`);
  const skuCount = "(SELECT COUNT(*) FROM sales_link_skus sx WHERE sx.salesLinkId=l.id AND COALESCE(sx.currentState,'active')='active')";
  if (options.skuCount === "none") where.push(`${skuCount}=0`);
  if (options.skuCount === "single") where.push(`${skuCount}=1`);
  if (options.skuCount === "multiple") where.push(`${skuCount}>1`);
  if (text(options.category)) { where.push("EXISTS (SELECT 1 FROM sales_link_skus sx JOIN sales_link_sku_erp_mappings mx ON mx.salesLinkSkuId=sx.id AND mx.currentState='active' JOIN product_erp_mappings pm ON pm.erpSkuId=mx.erpSkuId AND pm.currentState='active' JOIN products px ON px.id=pm.productId WHERE sx.salesLinkId=l.id AND px.category=@category)"); params.category = text(options.category); }
  if (text(options.lifecycle)) { where.push("EXISTS (SELECT 1 FROM sales_link_skus sx JOIN sales_link_sku_erp_mappings mx ON mx.salesLinkSkuId=sx.id AND mx.currentState='active' JOIN product_erp_mappings pm ON pm.erpSkuId=mx.erpSkuId AND pm.currentState='active' JOIN products px ON px.id=pm.productId WHERE sx.salesLinkId=l.id AND px.status=@lifecycle)"); params.lifecycle = text(options.lifecycle); }
  const whereSql = where.join(" AND ");
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId WHERE ${whereSql}`).get(params)?.count || 0);
  const sortField = connectionSortColumns[text(options.sortField)] || connectionSortColumns.default;
  const sortDirection = String(options.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const rows = database.prepare(`
    WITH candidates AS (
      SELECT c.id,${sortField} sortValue
      FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
      LEFT JOIN persons p ON p.id=c.ownerId WHERE ${whereSql}
      ORDER BY sortValue ${sortDirection},c.id ${sortDirection} LIMIT @limit OFFSET @offset
    )
      SELECT c.id,c.salesLinkId,c.name,c.mainImage,c.imageSource,c.ownerId,c.status,c.level,c.notes,c.originSource,c.createdAt,c.updatedAt,
        l.title salesLinkTitle,l.canonicalUrl,l.platformGoodsId,l.platformGoodsCode,l.currentState salesLinkState,
        sh.id shopId,sh.platform,sh.displayName shopDisplayName,sh.shopName,p.name ownerName,
        COALESCE((SELECT SUM(f.salesAmount) FROM connection_sku_sales_facts f WHERE f.salesLinkId=l.id),0) salesAmount,
        COALESCE((SELECT SUM(f.profitAmount) FROM connection_sku_sales_facts f WHERE f.salesLinkId=l.id),0) profitAmount,
        (SELECT MAX(ps.periodEnd) FROM connection_period_snapshots ps WHERE ps.salesLinkId=l.id) latestPeriodEnd,
        (SELECT ps.payAmount FROM connection_period_snapshots ps WHERE ps.salesLinkId=l.id ORDER BY ps.periodEnd DESC,ps.periodStart DESC,ps.createdAt DESC LIMIT 1) latestPayAmount,
        (SELECT COUNT(*) FROM sales_link_skus sx WHERE sx.salesLinkId=l.id AND COALESCE(sx.currentState,'active')='active') skuCount,q.sortValue
      FROM candidates q JOIN connection_profiles c ON c.id=q.id JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
      LEFT JOIN persons p ON p.id=c.ownerId ORDER BY q.sortValue ${sortDirection},c.id ${sortDirection}
  `).all({ ...params, limit: options.pageSize, offset: options.offset });
  const ids = rows.map((row) => row.salesLinkId);
  const relations = readRelationCounts(database, ids);
  const metrics = readConnectionV3MetricsMap(ids);
  const items = rows.map((row) => ({ ...row,
    erpSales: metrics.get(row.salesLinkId)?.current ?? null,
    skuCount: Number(relations.get(row.salesLinkId)?.skuCount || row.skuCount || 0),
    productCount: Number(relations.get(row.salesLinkId)?.productCount || 0), products: [],
  }));
  return { items, pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) } };
}

export function listConnectionCoreProfiles(userId = "", isAdmin = false) {
  const database = getDatabase();
  const profiles = listConnectionProfiles().filter((item) => isAdmin || item.ownerId === text(userId));
  const metrics = readConnectionV3MetricsMap(profiles.map((item) => item.salesLinkId));
  const relationCounts = readRelationCounts(database, profiles.map((item) => item.salesLinkId));
  return profiles.map((item) => {
    const sales = metrics.get(item.salesLinkId)?.current ?? latestSalesSummary(database, item.salesLinkId);
    const relation = relationCounts.get(item.salesLinkId) ?? {};
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
