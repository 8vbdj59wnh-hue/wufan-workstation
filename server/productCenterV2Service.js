import { createProductFromErpSku } from "./erpSkuService.js";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const newProductCycleDays = 30;
const businessZones = ["new", "hit", "active", "clearance"];
const explicitNewStatuses = new Set(["新品", "开发中", "待上架", "上架"]);
const clearanceStatuses = new Set(["风险期", "淘汰", "清仓", "停售"]);
const includeUnarchived = (value) => value === true || text(value).toLowerCase() === "true" || text(value) === "1";

function whereClause({ search = "", profileStatus = "all", includeUnarchived: includeUnarchivedValue = false, erpStatus = "" } = {}) {
  const conditions = ["s.currentState='active'"];
  const params = {};
  if (text(search)) {
    params.search = `%${text(search)}%`;
    conditions.push("(s.merchantSkuCode LIKE @search OR COALESCE(s.specificationName,'') LIKE @search OR COALESCE(g.goodsName,'') LIKE @search OR COALESCE(g.goodsCode,'') LIKE @search OR COALESCE(p.name,'') LIKE @search)");
  }
  if (!includeUnarchived(includeUnarchivedValue)) conditions.push("p.id IS NOT NULL");
  else if (profileStatus === "profiled") conditions.push("p.id IS NOT NULL");
  else if (profileStatus === "unprofiled") conditions.push("p.id IS NULL");
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
      SELECT erpSkuId,SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
        SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount,
        MIN(saleDate) firstPeriod,MAX(saleDate) lastPeriod
      FROM connection_sku_sales_daily_facts WHERE erpSkuId IS NOT NULL GROUP BY erpSkuId
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
      && (includeUnarchived(options.includeUnarchived) || row.profileStatus === "profiled")
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

let productListMetadataCache = null;

function productListMetadata(database) {
  if (productListMetadataCache?.expiresAt > Date.now()) return productListMetadataCache.value;
  const rows = database.prepare(`SELECT s.id erpSkuId,p.status lifecycleStatus,
      COALESCE(f.quantity,0) quantity,COALESCE(f.salesAmount,0) salesAmount,f.firstPeriod,
      COALESCE(i.salesMonth,0) salesMonth,COALESCE(i.stockNum,0) stockNum
    FROM erp_skus s LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN erp_sku_inventory_daily_summaries i ON i.erpSkuId=s.id
    LEFT JOIN (SELECT erpSkuId,SUM(quantity) quantity,SUM(salesAmount) salesAmount,MIN(saleDate) firstPeriod FROM connection_sku_sales_daily_facts WHERE erpSkuId IS NOT NULL GROUP BY erpSkuId) f ON f.erpSkuId=s.id
    WHERE s.currentState='active'`).all().map((row) => ({ ...row, salesMetric: Number(row.quantity || 0) > 0 ? Number(row.quantity) : Number(row.salesMonth || 0) }));
  const zones = classifyBusinessZones(rows);
  const summary = database.prepare(`SELECT COUNT(*) total,SUM(p.id IS NOT NULL) profiled,SUM(p.id IS NULL) unprofiled
    FROM erp_skus s LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId WHERE s.currentState='active'`).get();
  const distinct = (sql) => database.prepare(sql).all().map((row) => text(row.value)).filter(Boolean);
  const facets = {
    brands: distinct(`SELECT DISTINCT COALESCE(NULLIF(p.brand,''),g.brand) value FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId WHERE s.currentState='active' ORDER BY value`),
    categories: distinct(`SELECT DISTINCT COALESCE(NULLIF(p.category,''),g.category) value FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId WHERE s.currentState='active' ORDER BY value`),
    lifecycleStatuses: distinct(`SELECT DISTINCT p.status value FROM erp_skus s LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId WHERE s.currentState='active' ORDER BY value`),
    platforms: distinct(`SELECT DISTINCT sh.platform value FROM sales_link_sku_erp_mappings lm JOIN sales_link_skus lx ON lx.id=lm.salesLinkSkuId JOIN sales_links l ON l.id=lx.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId WHERE lm.currentState='active' ORDER BY value`),
  };
  const value = { summary: { total: Number(summary.total || 0), profiled: Number(summary.profiled || 0), unprofiled: Number(summary.unprofiled || 0), businessZones: zones.counts, businessZoneRules: zones.rules }, zoneById: new Map(zones.items.map((row) => [row.erpSkuId, row.businessZone])), facets };
  productListMetadataCache = { expiresAt: Date.now() + 30_000, value }; return value;
}

export function getProductCenterV2Metadata() {
  const { summary, facets } = productListMetadata(getDatabase());
  return { summary, facets };
}

export function listProductCenterV2Skus(options = {}) {
  const database = getDatabase(); const limit = Math.min(200, Math.max(20, number(options.limit, 50))); const offset = Math.max(0, number(options.offset, 0));
  const metadata = text(options.businessZone) && options.businessZone !== "all" ? productListMetadata(database) : null; const conditions = ["s.currentState='active'"]; const params = {};
  if (text(options.search)) { conditions.push("(s.merchantSkuCode LIKE @search OR COALESCE(s.specificationName,'') LIKE @search OR COALESCE(g.goodsName,'') LIKE @search OR COALESCE(g.goodsCode,'') LIKE @search OR COALESCE(p.name,'') LIKE @search)"); params.search = `%${text(options.search)}%`; }
  if (!includeUnarchived(options.includeUnarchived)) conditions.push("p.id IS NOT NULL");
  else if (options.profileStatus === "profiled") conditions.push("p.id IS NOT NULL");
  else if (options.profileStatus === "unprofiled") conditions.push("p.id IS NULL");
  for (const [key, expression] of [["erpStatus", "s.erpStatus"], ["brand", "COALESCE(NULLIF(p.brand,''),g.brand)"], ["category", "COALESCE(NULLIF(p.category,''),g.category)"], ["lifecycleStatus", "p.status"], ["ownerId", "p.ownerId"]]) if (text(options[key])) { conditions.push(`${expression}=@${key}`); params[key] = text(options[key]); }
  if (text(options.platform)) { conditions.push(`EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings lm JOIN sales_link_skus lx ON lx.id=lm.salesLinkSkuId JOIN sales_links ll ON ll.id=lx.salesLinkId JOIN sales_shops ls ON ls.id=ll.shopId WHERE lm.erpSkuId=s.id AND lm.currentState='active' AND ls.platform=@platform)`); params.platform = text(options.platform); }
  const inventoryExpression = `(SELECT COALESCE(i.stockNum,0) FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1)`;
  if (options.stockStatus === "available") conditions.push(`${inventoryExpression}>10`);
  if (options.stockStatus === "low") conditions.push(`${inventoryExpression}>0 AND ${inventoryExpression}<=10`);
  if (options.stockStatus === "empty") conditions.push(`COALESCE(${inventoryExpression},0)<=0`);
  if (text(options.businessZone) && options.businessZone !== "all") {
    const ids = [...metadata.zoneById].filter(([, zone]) => zone === options.businessZone).map(([id]) => id);
    if (!ids.length) conditions.push("0"); else { conditions.push(`s.id IN (${ids.map(() => "?").join(",")})`); params.zoneIds = ids; }
  }
  const from = `FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId`;
  const bindParams = { ...params }; const zoneIds = bindParams.zoneIds || []; delete bindParams.zoneIds; const positional = [...zoneIds];
  const whereSql = conditions.join(" AND ");
  const total = Number(database.prepare(`SELECT COUNT(*) count ${from} WHERE ${whereSql}`).get(...positional, bindParams)?.count || 0);
  const salesSort = `COALESCE((SELECT SUM(fx.quantity) FROM connection_sku_sales_daily_facts fx WHERE fx.erpSkuId=s.id),(SELECT ix.salesMonth FROM erp_sku_inventory_daily_summaries ix WHERE ix.erpSkuId=s.id ORDER BY ix.businessDate DESC LIMIT 1),0)`;
  const capitalSort = `(SELECT ix.inventoryCostAmount FROM erp_sku_inventory_daily_summaries ix WHERE ix.erpSkuId=s.id ORDER BY ix.businessDate DESC,ix.updatedAt DESC LIMIT 1)`;
  const sortExpressions = { "updated-desc": "s.updatedAt DESC", "updated-asc": "s.updatedAt ASC", "created-desc": "s.createdAt DESC", "sales-desc": `${salesSort} DESC`, "sales-asc": `${salesSort} ASC`, "stock-desc": `${inventoryExpression} DESC`, "stock-asc": `${inventoryExpression} ASC`, "capital-desc": `${capitalSort} DESC`, "capital-asc": `${capitalSort} ASC` };
  const order = sortExpressions[text(options.sort)] || sortExpressions["updated-desc"];
  const rows = database.prepare(`WITH candidates AS (SELECT s.id ${from} WHERE ${whereSql} ORDER BY ${order},s.id LIMIT @limit OFFSET @offset)
    SELECT s.id erpSkuId,s.merchantSkuCode,s.erpGoodsId,s.specificationName,s.barcode,s.unit,s.erpStatus,s.mainImage skuImage,s.sourceUpdatedAt,s.createdAt skuCreatedAt,s.updatedAt skuUpdatedAt,
      g.goodsCode,g.goodsName,g.brand erpBrand,g.category erpCategory,p.id productId,p.name productName,p.mainImage productImage,p.brand,p.category,p.ownerId,p.status lifecycleStatus,
      CASE WHEN p.id IS NULL THEN 'unprofiled' ELSE 'profiled' END profileStatus,
      (SELECT i.businessDate FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) inventoryDate,
      ${inventoryExpression} stockNum,(SELECT i.availableSendStock FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) availableSendStock,
      (SELECT i.costPrice FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) costPrice,
      (SELECT i.inventoryCostAmount FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) inventoryCostAmount,
      (SELECT i.salesMonth FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) salesMonth,
      (SELECT COUNT(DISTINCT lx.salesLinkId) FROM sales_link_sku_erp_mappings lm JOIN sales_link_skus lx ON lx.id=lm.salesLinkSkuId WHERE lm.erpSkuId=s.id AND lm.currentState='active') linkCount,
      (SELECT COUNT(*) FROM sales_link_sku_erp_mappings lm WHERE lm.erpSkuId=s.id AND lm.currentState='active') platformSkuCount,
      (SELECT json_group_array(DISTINCT sh.platform) FROM sales_link_sku_erp_mappings lm JOIN sales_link_skus lx ON lx.id=lm.salesLinkSkuId JOIN sales_links ll ON ll.id=lx.salesLinkId JOIN sales_shops sh ON sh.id=ll.shopId WHERE lm.erpSkuId=s.id AND lm.currentState='active') platformsJson,
      COALESCE((SELECT SUM(f.quantity) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) quantity,
      COALESCE((SELECT SUM(f.salesAmount) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) salesAmount,
      COALESCE((SELECT SUM(f.profitAmount) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) profitAmount,
      COALESCE((SELECT SUM(f.quantity) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),(SELECT i.salesMonth FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC LIMIT 1),0) salesMetric
    FROM candidates q JOIN erp_skus s ON s.id=q.id JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId
    ORDER BY ${order},s.id`).all(...positional, { ...bindParams, limit, offset });
  const hydrated = rows.map((row) => ({ ...row, displayBrand: text(row.brand) || text(row.erpBrand), displayCategory: text(row.category) || text(row.erpCategory), platforms: parsePlatforms(row.platformsJson), businessZone: metadata?.zoneById.get(row.erpSkuId) || "" }));
  const profileCounts = database.prepare(`SELECT COUNT(*) total,SUM(p.id IS NOT NULL) profiled,SUM(p.id IS NULL) unprofiled ${from} WHERE s.currentState='active'`).get();
  return { rows: hydrated, pagination: { total, limit, offset }, summary: { total: Number(profileCounts.total || 0), profiled: Number(profileCounts.profiled || 0), unprofiled: Number(profileCounts.unprofiled || 0) } };
}

export function getProductCenterV2SkuDetail(erpSkuId, { scope = "full" } = {}) {
  const database = getDatabase();
  const sku = database.prepare(`SELECT s.*,g.goodsCode,g.goodsName,g.shortName,g.brand erpBrand,g.category erpCategory,g.productType,
      m.id mappingId,m.productId,m.currentState mappingState,p.name productName,p.mainImage productImage,p.galleryImages,p.brand,p.category,p.ownerId,p.status lifecycleStatus,p.remark
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId WHERE s.id=?`).get(text(erpSkuId));
  if (!sku) throw new Error("ERP SKU不存在。");
  if (scope === "links") {
    const links = database.prepare(`SELECT m.id mappingId,m.mappingType,m.quantity,x.id salesLinkSkuId,x.platformSkuId,x.platformSkuCode,x.specificationName platformSpecification,
        l.id salesLinkId,l.platformGoodsId,l.title,s.platform,s.displayName shopName,c.id connectionId
      FROM sales_link_sku_erp_mappings m JOIN sales_link_skus x ON x.id=m.salesLinkSkuId
      JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops s ON s.id=l.shopId
      LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
      WHERE m.erpSkuId=? AND m.currentState='active' ORDER BY s.platform,s.displayName,l.title`).all(sku.id);
    return { links };
  }
  if (scope === "inventory") {
    return { inventoryRecords: database.prepare(`SELECT * FROM erp_sku_inventory_daily_summaries WHERE erpSkuId=? ORDER BY businessDate DESC,updatedAt DESC LIMIT 120`).all(sku.id) };
  }
  if (scope === "sales") {
    return { salesTrend: database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(COALESCE(quantity,0)) quantity,
        SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
      FROM connection_sku_sales_daily_facts WHERE erpSkuId=? GROUP BY saleDate ORDER BY saleDate DESC LIMIT 90`).all(sku.id) };
  }
  if (scope === "operations") {
    return { operations: sku.productId ? database.prepare("SELECT * FROM product_lifecycle_events WHERE productId=? ORDER BY changedAt DESC LIMIT 100").all(sku.productId) : [] };
  }
  const inventory = database.prepare(`SELECT * FROM erp_sku_inventory_daily_summaries WHERE erpSkuId=? ORDER BY businessDate DESC,updatedAt DESC LIMIT 1`).get(sku.id) ?? null;
  const sales = database.prepare(`SELECT COUNT(*) factCount,MIN(saleDate) firstPeriod,MAX(saleDate) lastPeriod,
      SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
      SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE erpSkuId=?`).get(sku.id);
  if (scope === "summary") return { sku, inventory, sales };
  const links = database.prepare(`SELECT m.id mappingId,m.mappingType,m.quantity,x.id salesLinkSkuId,x.platformSkuId,x.platformSkuCode,x.specificationName platformSpecification,
      l.id salesLinkId,l.platformGoodsId,l.title,s.platform,s.displayName shopName,c.id connectionId
    FROM sales_link_sku_erp_mappings m JOIN sales_link_skus x ON x.id=m.salesLinkSkuId
    JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE m.erpSkuId=? AND m.currentState='active' ORDER BY s.platform,s.displayName,l.title`).all(sku.id);
  const salesTrend = database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(COALESCE(quantity,0)) quantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE erpSkuId=? GROUP BY saleDate ORDER BY saleDate DESC LIMIT 90`).all(sku.id);
  return { sku, inventory, links, sales, salesTrend };
}

export function createProductProfileForErpSku(erpSkuId) {
  return createProductFromErpSku(text(erpSkuId));
}
