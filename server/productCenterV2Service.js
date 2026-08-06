import { createProductFromErpSku } from "./erpSkuService.js";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const newProductCycleDays = 30;
const businessZones = ["new", "hit", "active", "clearance"];
const explicitNewStatuses = new Set(["新品", "开发中", "待上架", "上架"]);
const clearanceStatuses = new Set(["风险期", "淘汰", "清仓", "停售"]);

function whereClause({ search = "", profileStatus = "all", erpStatus = "" } = {}) {
  const conditions = ["s.currentState='active'"];
  const params = {};
  if (text(search)) {
    params.search = `%${text(search)}%`;
    conditions.push("(s.merchantSkuCode LIKE @search OR COALESCE(s.specificationName,'') LIKE @search OR COALESCE(g.goodsName,'') LIKE @search OR COALESCE(g.goodsCode,'') LIKE @search OR COALESCE(p.name,'') LIKE @search)");
  }
  if (profileStatus === "profiled") conditions.push("p.id IS NOT NULL");
  if (profileStatus === "unprofiled") conditions.push("p.id IS NULL");
  if (text(erpStatus)) { params.erpStatus = text(erpStatus); conditions.push("COALESCE(s.erpStatus,'')=@erpStatus"); }
  return { sql: conditions.join(" AND "), params };
}

function baseCtes() {
  return `
    WITH latest_inventory AS (
      SELECT * FROM (
        SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.erpSkuId ORDER BY i.businessDate DESC,i.updatedAt DESC) position
        FROM erp_sku_inventory_daily_summaries i
      ) WHERE position=1
    ), link_rollup AS (
      SELECT m.erpSkuId,COUNT(DISTINCT x.salesLinkId) linkCount,COUNT(DISTINCT m.salesLinkSkuId) platformSkuCount,
        json_group_array(DISTINCT sh.platform) platformsJson
      FROM sales_link_sku_erp_mappings m
      JOIN sales_link_skus x ON x.id=m.salesLinkSkuId AND x.currentState='active'
      JOIN sales_links sl ON sl.id=x.salesLinkId AND sl.currentState='active'
      JOIN sales_shops sh ON sh.id=sl.shopId
      WHERE m.currentState='active'
      GROUP BY m.erpSkuId
    ), sales_rollup AS (
      SELECT erpSkuId,SUM(COALESCE(shippedQuantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
        SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount,
        MIN(periodStart) firstPeriod,MAX(periodEnd) lastPeriod
      FROM connection_sku_sales_facts WHERE erpSkuId IS NOT NULL GROUP BY erpSkuId
    )`;
}

function parsePlatforms(value) {
  try { return JSON.parse(value || "[]").filter(Boolean); }
  catch { return []; }
}

function classifyBusinessZones(rows) {
  const cycleStart = Date.now() - newProductCycleDays * 86400000;
  const isNew = (row) => explicitNewStatuses.has(row.lifecycleStatus)
    || (!clearanceStatuses.has(row.lifecycleStatus) && (Date.parse(row.firstPeriod || "") || 0) >= cycleStart);
  const newIds = new Set(rows.filter(isNew).map((row) => row.erpSkuId));
  const sustained = rows.filter((row) => !newIds.has(row.erpSkuId) && !clearanceStatuses.has(row.lifecycleStatus) && Number(row.salesMetric || 0) > 0);
  const topCount = sustained.length ? Math.max(1, Math.ceil(sustained.length * 0.2)) : 0;
  const topBy = (field) => new Set([...sustained].filter((row) => Number(row[field] || 0) > 0)
    .sort((left, right) => Number(right[field] || 0) - Number(left[field] || 0)).slice(0, topCount).map((row) => row.erpSkuId));
  const hitIds = new Set([...topBy("salesAmount"), ...topBy("salesMetric")]);
  const remainingSales = rows.filter((row) => !newIds.has(row.erpSkuId) && !hitIds.has(row.erpSkuId))
    .map((row) => Number(row.salesMetric || 0)).filter((value) => value > 0).sort((left, right) => left - right);
  const lowSalesThreshold = remainingSales.length >= 5 ? remainingSales[Math.max(0, Math.ceil(remainingSales.length * 0.2) - 1)] : 0;
  const counts = Object.fromEntries(businessZones.map((zone) => [zone, 0]));
  const items = rows.map((row) => {
    const quantity = Number(row.salesMetric || 0);
    const stock = Number(row.stockNum || 0);
    let businessZone = "";
    if (newIds.has(row.erpSkuId)) businessZone = "new";
    else if (hitIds.has(row.erpSkuId)) businessZone = "hit";
    else if (stock > 0 && (clearanceStatuses.has(row.lifecycleStatus) || quantity <= 0 || (lowSalesThreshold > 0 && quantity <= lowSalesThreshold))) businessZone = "clearance";
    else if (quantity > 0) businessZone = "active";
    if (businessZone) counts[businessZone] += 1;
    return { ...row, businessZone };
  });
  return { items, counts, rules: { newProductCycleDays, hitTopPercent: 20, lowSalesPercent: 20 } };
}

function filterRows(rows, options) {
  const search = text(options.search).toLowerCase();
  return rows.filter((row) => {
    const matchesSearch = !search || [row.merchantSkuCode, row.specificationName, row.goodsName, row.goodsCode, row.productName]
      .some((value) => text(value).toLowerCase().includes(search));
    const stock = Number(row.stockNum || 0);
    const matchesStock = !text(options.stockStatus)
      || (options.stockStatus === "available" && stock > 10)
      || (options.stockStatus === "low" && stock > 0 && stock <= 10)
      || (options.stockStatus === "empty" && stock <= 0);
    return matchesSearch
      && (!text(options.profileStatus) || options.profileStatus === "all" || row.profileStatus === options.profileStatus)
      && (!text(options.erpStatus) || text(row.erpStatus) === text(options.erpStatus))
      && (!text(options.brand) || row.displayBrand === options.brand)
      && (!text(options.category) || row.displayCategory === options.category)
      && (!text(options.lifecycleStatus) || row.lifecycleStatus === options.lifecycleStatus)
      && (!text(options.platform) || row.platforms.includes(options.platform))
      && (!text(options.businessZone) || options.businessZone === "all" || row.businessZone === options.businessZone)
      && matchesStock;
  });
}

function sortRows(rows, sort = "updated-desc") {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const numericField = sort.startsWith("sales-") ? "salesMetric" : sort.startsWith("stock-") ? "stockNum" : sort.startsWith("capital-") ? "inventoryCostAmount" : "";
  return [...rows].sort((left, right) => {
    let comparison;
    if (numericField) comparison = Number(left[numericField] || 0) - Number(right[numericField] || 0);
    else {
      const field = sort === "created-desc" ? "skuCreatedAt" : "skuUpdatedAt";
      comparison = (Date.parse(left[field] || "") || 0) - (Date.parse(right[field] || "") || 0);
    }
    if (comparison === 0) return collator.compare(text(left.merchantSkuCode), text(right.merchantSkuCode));
    return sort.endsWith("-asc") ? comparison : comparison * -1;
  });
}

export function listProductCenterV2Skus(options = {}) {
  const database = getDatabase();
  const limit = Math.min(200, Math.max(20, number(options.limit, 50)));
  const offset = Math.max(0, number(options.offset, 0));
  const where = whereClause({});
  const from = `FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId`;
  const summary = database.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) profiled,
      SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) unprofiled
    ${from} WHERE s.currentState='active'`).get();
  const rawRows = database.prepare(`${baseCtes()}
    SELECT s.id erpSkuId,s.merchantSkuCode,s.erpGoodsId,s.specificationName,s.barcode,s.unit,s.erpStatus,s.mainImage skuImage,
      s.sourceUpdatedAt,s.createdAt skuCreatedAt,s.updatedAt skuUpdatedAt,g.goodsCode,g.goodsName,g.brand erpBrand,g.category erpCategory,
      p.id productId,p.name productName,p.mainImage productImage,p.brand,p.category,p.ownerId,p.status lifecycleStatus,
      CASE WHEN p.id IS NULL THEN 'unprofiled' ELSE 'profiled' END profileStatus,
      i.businessDate inventoryDate,i.stockNum,i.availableSendStock,i.costPrice,i.inventoryCostAmount,i.sales7d,i.salesMonth,i.sales90d,
      COALESCE(l.linkCount,0) linkCount,COALESCE(l.platformSkuCount,0) platformSkuCount,l.platformsJson,
      COALESCE(f.quantity,0) quantity,COALESCE(f.salesAmount,0) salesAmount,COALESCE(f.costAmount,0) salesCostAmount,COALESCE(f.profitAmount,0) profitAmount,
      f.firstPeriod,f.lastPeriod
    ${from}
    LEFT JOIN latest_inventory i ON i.erpSkuId=s.id
    LEFT JOIN link_rollup l ON l.erpSkuId=s.id
    LEFT JOIN sales_rollup f ON f.erpSkuId=s.id
    WHERE ${where.sql}`).all(where.params).map((row) => ({ ...row,
      displayBrand: text(row.brand) || text(row.erpBrand), displayCategory: text(row.category) || text(row.erpCategory),
      platforms: parsePlatforms(row.platformsJson), salesMetric: Number(row.quantity || 0) > 0 ? Number(row.quantity) : Number(row.salesMonth || 0) }));
  const zones = classifyBusinessZones(rawRows);
  const filtered = filterRows(zones.items, options);
  const sorted = sortRows(filtered, text(options.sort) || "updated-desc");
  const facets = {
    brands: [...new Set(rawRows.map((row) => row.displayBrand).filter(Boolean))].sort(),
    categories: [...new Set(rawRows.map((row) => row.displayCategory).filter(Boolean))].sort(),
    lifecycleStatuses: [...new Set(rawRows.map((row) => text(row.lifecycleStatus)).filter(Boolean))].sort(),
    platforms: [...new Set(rawRows.flatMap((row) => row.platforms))].sort(),
  };
  return { rows: sorted.slice(offset, offset + limit), pagination: { total: filtered.length, limit, offset },
    summary: { total: Number(summary.total || 0), profiled: Number(summary.profiled || 0), unprofiled: Number(summary.unprofiled || 0), businessZones: zones.counts, businessZoneRules: zones.rules }, facets };
}

export function getProductCenterV2SkuDetail(erpSkuId) {
  const database = getDatabase();
  const sku = database.prepare(`SELECT s.*,g.goodsCode,g.goodsName,g.shortName,g.brand erpBrand,g.category erpCategory,g.productType,
      m.id mappingId,m.productId,m.currentState mappingState,p.name productName,p.mainImage productImage,p.brand,p.category,p.ownerId,p.status lifecycleStatus,p.remark
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId WHERE s.id=?`).get(text(erpSkuId));
  if (!sku) throw new Error("ERP SKU不存在。");
  const inventory = database.prepare(`SELECT * FROM erp_sku_inventory_daily_summaries WHERE erpSkuId=? ORDER BY businessDate DESC,updatedAt DESC LIMIT 1`).get(sku.id) ?? null;
  const links = database.prepare(`SELECT m.id mappingId,m.mappingType,m.quantity,x.id salesLinkSkuId,x.platformSkuId,x.platformSkuCode,x.specificationName platformSpecification,
      l.id salesLinkId,l.platformGoodsId,l.title,s.platform,s.displayName shopName,c.id connectionId
    FROM sales_link_sku_erp_mappings m JOIN sales_link_skus x ON x.id=m.salesLinkSkuId
    JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE m.erpSkuId=? AND m.currentState='active' ORDER BY s.platform,s.displayName,l.title`).all(sku.id);
  const sales = database.prepare(`SELECT COUNT(*) factCount,MIN(periodStart) firstPeriod,MAX(periodEnd) lastPeriod,
      SUM(COALESCE(shippedQuantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
      SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts WHERE erpSkuId=?`).get(sku.id);
  const salesTrend = database.prepare(`SELECT periodStart,periodEnd,SUM(COALESCE(shippedQuantity,0)) quantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts WHERE erpSkuId=? GROUP BY periodStart,periodEnd ORDER BY periodEnd DESC LIMIT 90`).all(sku.id);
  return { sku, inventory, links, sales, salesTrend };
}

export function createProductProfileForErpSku(erpSkuId) {
  return createProductFromErpSku(text(erpSkuId));
}
