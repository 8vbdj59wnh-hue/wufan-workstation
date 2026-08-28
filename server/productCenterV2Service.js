import { createProductFromErpSku } from "./erpSkuService.js";
import { getDatabase } from "./db.js";
import { resolveErpSkuSalesObjectLinks } from "./capabilities/resolveLinkSkuRelationRead.js";
import { classifyErpSkuUsages } from "./erpSkuUsageProfileService.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";
import { getProductBusinessReadModel } from "./productBusinessReadModel.js";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const newProductCycleDays = 30;
const businessZones = ["new", "hit", "active", "clearance"];
const explicitNewStatuses = new Set(["新品", "开发中", "待上架", "上架"]);
const clearanceStatuses = new Set(["风险期", "淘汰", "清仓", "停售"]);
const includeUnarchived = (value) => value === true || text(value).toLowerCase() === "true" || text(value) === "1";
const operatingLifecycleStatuses = ["active", "active_dependency", "sales_active"];
const includeHistorical = (value) => value === true || text(value).toLowerCase() === "true" || text(value) === "1";

function operatingLifecycleReady(database) {
  return Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL").get()?.total || 0) > 0;
}

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
const productListPageCache = new Map();
const productListPageCacheTtlMs = 10_000;

function productListPageCacheKey(options) {
  return JSON.stringify(Object.keys(options).sort().map((key) => [key, options[key]]));
}

function rememberProductListPage(key, value) {
  productListPageCache.set(key, { value, expiresAt: Date.now() + productListPageCacheTtlMs });
  while (productListPageCache.size > 30) productListPageCache.delete(productListPageCache.keys().next().value);
  return value;
}

function salesObjectLinkContext(database, erpSkuIds) {
  const reverse = resolveErpSkuSalesObjectLinks({ erpSkuIds }, { database, scope: "productAssociations", salesObjectOnly: true }).results;
  const linkSkuIds = [...new Set(Object.values(reverse).flatMap((relations) => relations.map((relation) => relation.salesLinkSkuId)))];
  const identities = linkSkuIds.length ? database.prepare(`SELECT x.id salesLinkSkuId,x.salesLinkId,x.platformSkuId,x.platformSkuCode,x.specificationName platformSpecification,
      l.platformGoodsId,l.title,sh.platform,sh.displayName shopName,c.id connectionId
    FROM sales_link_skus x JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id WHERE x.id IN (${linkSkuIds.map(() => "?").join(",")})`).all(...linkSkuIds) : [];
  const identityBySku = new Map(identities.map((row) => [row.salesLinkSkuId, row]));
  return new Map(erpSkuIds.map((erpSkuId) => [erpSkuId, (reverse[erpSkuId] || []).map((relation) => ({ ...identityBySku.get(relation.salesLinkSkuId), relation })).filter((row) => row.salesLinkSkuId)]));
}

function productListMetadata(database) {
  if (productListMetadataCache?.expiresAt > Date.now()) return productListMetadataCache.value;
  const lifecycleReady = operatingLifecycleReady(database);
  const lifecycleJoin = lifecycleReady ? "JOIN operating_erp_set_members om ON om.erpSkuId=s.id" : "";
  const lifecycleWhere = lifecycleReady ? "AND om.lifecycleStatus IN ('active','active_dependency','sales_active')" : "";
  const rows = database.prepare(`SELECT s.id erpSkuId,COALESCE(profile.lifecycle,p.status) lifecycleStatus,
      COALESCE(f.quantity,0) quantity,COALESCE(f.salesAmount,0) salesAmount,f.firstPeriod,
      COALESCE(i.salesMonth,0) salesMonth,COALESCE(i.stockNum,0) stockNum
    FROM erp_skus s ${lifecycleJoin} LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    LEFT JOIN erp_sku_inventory_daily_summaries i ON i.erpSkuId=s.id
    LEFT JOIN (SELECT erpSkuId,SUM(quantity) quantity,SUM(salesAmount) salesAmount,MIN(saleDate) firstPeriod FROM connection_sku_sales_daily_facts WHERE erpSkuId IS NOT NULL GROUP BY erpSkuId) f ON f.erpSkuId=s.id
    WHERE s.currentState='active' ${lifecycleWhere}`).all().map((row) => ({ ...row, salesMetric: Number(row.quantity || 0) > 0 ? Number(row.quantity) : Number(row.salesMonth || 0) }));
  const zones = classifyBusinessZones(rows);
  const summary = database.prepare(`SELECT COUNT(*) total,SUM(profile.id IS NOT NULL) profiled,SUM(profile.id IS NULL) unprofiled
    FROM erp_skus s ${lifecycleJoin} LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    WHERE s.currentState='active' ${lifecycleWhere}`).get();
  const distinct = (sql) => database.prepare(sql).all().map((row) => text(row.value)).filter(Boolean);
  const facets = {
    brands: distinct(`SELECT DISTINCT COALESCE(NULLIF(profile.brandOverride,''),NULLIF(p.brand,''),g.brand) value FROM erp_skus s ${lifecycleJoin} JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id WHERE s.currentState='active' ${lifecycleWhere} ORDER BY value`),
    categories: distinct(`SELECT DISTINCT COALESCE(NULLIF(profile.categoryOverride,''),NULLIF(p.category,''),g.category) value FROM erp_skus s ${lifecycleJoin} JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id WHERE s.currentState='active' ${lifecycleWhere} ORDER BY value`),
    lifecycleStatuses: distinct(`SELECT DISTINCT COALESCE(profile.lifecycle,p.status) value FROM erp_skus s ${lifecycleJoin} LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id WHERE s.currentState='active' ${lifecycleWhere} ORDER BY value`),
    operatingLifecycleStatuses: lifecycleReady ? database.prepare("SELECT lifecycleStatus value,COUNT(*) total FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL GROUP BY lifecycleStatus ORDER BY CASE lifecycleStatus WHEN 'active' THEN 0 WHEN 'active_dependency' THEN 1 WHEN 'sales_active' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END").all() : [],
    platforms: distinct(`SELECT DISTINCT sh.platform value FROM sales_link_sku_sales_object_relations r
      JOIN sales_link_skus x ON x.id=r.linkSkuId JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
      WHERE r.status='active' ORDER BY sh.platform`),
    shops: database.prepare(`SELECT DISTINCT sh.id,sh.displayName,sh.platform FROM sales_link_sku_sales_object_relations r
      JOIN sales_link_skus x ON x.id=r.linkSkuId JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
      WHERE r.status='active' ORDER BY sh.platform,sh.displayName`).all(),
  };
  const historical = lifecycleReady ? Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL AND lifecycleStatus IN ('archived','external_unused')").get()?.total || 0) : 0;
  const value = { summary: { total: Number(summary.total || 0), profiled: Number(summary.profiled || 0), unprofiled: Number(summary.unprofiled || 0), historical,
    lifecycleReady, businessZones: zones.counts, businessZoneRules: zones.rules }, zoneById: new Map(zones.items.map((row) => [row.erpSkuId, row.businessZone])), facets };
  productListMetadataCache = { expiresAt: Date.now() + 30_000, value }; return value;
}

export function getProductCenterV2Metadata() {
  const { summary, facets } = productListMetadata(getDatabase());
  return { summary, facets };
}

export function listActionProductOptions({ search = "", limit = 100 } = {}) {
  const database = getDatabase();
  const query = text(search);
  const boundedLimit = Math.min(200, Math.max(20, number(limit, 100)));
  const params = { query, like: `%${query}%`, limit: boundedLimit };
  const rows = database.prepare(`
    SELECT s.id erpSkuId,s.merchantSkuCode,s.specificationName,s.erpStatus,s.currentState,
      g.goodsCode,g.goodsName,
      COALESCE(NULLIF(profile.displayNameOverride,''),NULLIF(p.name,''),NULLIF(g.goodsName,''),s.merchantSkuCode) name,
      COALESCE(NULLIF(s.mainImage,''),NULLIF(p.mainImage,'')) mainImage,
      profile.id businessProfileId,profile.businessStatus,
      m.productId,p.status legacyProductStatus
    FROM erp_skus s
    JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.id=(
      SELECT value.id FROM product_erp_mappings value
      WHERE value.erpSkuId=s.id AND value.currentState='active'
      ORDER BY value.updatedAt DESC,value.id DESC LIMIT 1
    )
    LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    WHERE (@query='' OR s.merchantSkuCode LIKE @like OR COALESCE(g.goodsName,'') LIKE @like
      OR COALESCE(g.goodsCode,'') LIKE @like OR COALESCE(s.specificationName,'') LIKE @like
      OR COALESCE(profile.displayNameOverride,'') LIKE @like)
    ORDER BY CASE WHEN lower(s.merchantSkuCode)=lower(@query) THEN 0 ELSE 1 END,
      CASE s.currentState WHEN 'active' THEN 0 ELSE 1 END,
      lower(s.merchantSkuCode),s.id
    LIMIT @limit
  `).all(params);
  return {
    rows: rows.map((row) => ({
      ...row,
      id: row.erpSkuId,
      skuCode: row.merchantSkuCode,
      erpSkuCode: row.merchantSkuCode,
      status: row.businessStatus || (row.businessProfileId ? "active" : "unmaintained"),
      hasBusinessProfile: Boolean(row.businessProfileId),
      hasProductProfile: Boolean(row.businessProfileId),
    })),
    query,
    limit: boundedLimit,
  };
}

export function resolveActionProductOptions(relations = [], { database = getDatabase() } = {}) {
  const erpSkuIds = [...new Set(relations.map((item) => text(item.erpSkuId)).filter(Boolean))];
  const productIds = [...new Set(relations.map((item) => text(item.productId)).filter(Boolean))];
  if (!erpSkuIds.length && !productIds.length) return [];
  const erpMarks = erpSkuIds.map(() => "?").join(",");
  const productMarks = productIds.map(() => "?").join(",");
  const predicates = [];
  if (erpSkuIds.length) predicates.push(`s.id IN (${erpMarks})`);
  if (productIds.length) predicates.push(`m.productId IN (${productMarks})`);
  return database.prepare(`
    SELECT s.id erpSkuId,s.merchantSkuCode skuCode,
      COALESCE(NULLIF(profile.displayNameOverride,''),NULLIF(p.name,''),NULLIF(g.goodsName,''),s.merchantSkuCode) name,
      COALESCE(NULLIF(s.mainImage,''),NULLIF(p.mainImage,'')) mainImage,
      profile.id businessProfileId,profile.businessStatus,m.productId
    FROM erp_skus s
    JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.id=(
      SELECT candidate.id FROM product_erp_mappings candidate
      WHERE candidate.erpSkuId=s.id AND candidate.currentState='active'
      ORDER BY candidate.updatedAt DESC,candidate.id DESC LIMIT 1
    )
    LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    WHERE ${predicates.join(" OR ")}
    ORDER BY s.merchantSkuCode,s.id
  `).all(...erpSkuIds, ...productIds).map((row) => ({
    ...row,
    id: row.erpSkuId,
    status: row.businessStatus || (row.businessProfileId ? "active" : "unmaintained"),
  }));
}

export function listProductCenterV2Skus(options = {}) {
  const cacheKey = productListPageCacheKey(options);
  const cached = productListPageCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;
  if (cached) productListPageCache.delete(cacheKey);
  const database = getDatabase(); const limit = Math.min(200, Math.max(20, number(options.limit, 50))); const offset = Math.max(0, number(options.offset, 0));
  const lifecycleReady = operatingLifecycleReady(database);
  const metadata = text(options.businessZone) && options.businessZone !== "all" ? productListMetadata(database) : null; const conditions = ["s.currentState='active'"]; const params = {};
  if (lifecycleReady && !includeHistorical(options.includeHistorical)) conditions.push("om.lifecycleStatus IN ('active','active_dependency','sales_active')");
  if (lifecycleReady && text(options.operatingLifecycleStatus)) { conditions.push("om.lifecycleStatus=@operatingLifecycleStatus"); params.operatingLifecycleStatus = text(options.operatingLifecycleStatus); }
  if (text(options.search)) { conditions.push("(s.merchantSkuCode LIKE @search OR COALESCE(s.specificationName,'') LIKE @search OR COALESCE(g.goodsName,'') LIKE @search OR COALESCE(g.goodsCode,'') LIKE @search OR COALESCE(profile.displayNameOverride,'') LIKE @search OR COALESCE(p.name,'') LIKE @search)"); params.search = `%${text(options.search)}%`; }
  if (options.profileStatus === "profiled") conditions.push("profile.id IS NOT NULL");
  else if (options.profileStatus === "unprofiled") conditions.push("profile.id IS NULL");
  for (const [key, expression] of [["erpStatus", "s.erpStatus"], ["brand", "COALESCE(NULLIF(profile.brandOverride,''),NULLIF(p.brand,''),g.brand)"], ["category", "COALESCE(NULLIF(profile.categoryOverride,''),NULLIF(p.category,''),g.category)"], ["lifecycleStatus", "COALESCE(NULLIF(profile.lifecycle,''),p.status)"], ["ownerId", "COALESCE(profile.ownerId,p.ownerId)"]]) if (text(options[key])) { conditions.push(`${expression}=@${key}`); params[key] = text(options[key]); }
  if (text(options.platform)) {
    conditions.push(`EXISTS (SELECT 1 FROM sales_object_structure_components pc
      JOIN sales_object_structures ps ON ps.id=pc.structureId AND ps.status='active'
      JOIN sales_link_sku_sales_object_relations pr ON pr.salesObjectId=ps.salesObjectId AND pr.status='active'
      JOIN sales_link_skus px ON px.id=pr.linkSkuId JOIN sales_links pl ON pl.id=px.salesLinkId JOIN sales_shops psh ON psh.id=pl.shopId
      WHERE pc.status='active' AND pc.erpSkuId=s.id AND psh.platform=@platform)`);
    params.platform = text(options.platform);
  }
  const inventoryExpression = `(SELECT COALESCE(i.stockNum,0) FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1)`;
  if (options.stockStatus === "available") conditions.push(`${inventoryExpression}>10`);
  if (options.stockStatus === "low") conditions.push(`${inventoryExpression}>0 AND ${inventoryExpression}<=10`);
  if (options.stockStatus === "empty") conditions.push(`COALESCE(${inventoryExpression},0)<=0`);
  if (text(options.businessZone) && options.businessZone !== "all") {
    const ids = [...metadata.zoneById].filter(([, zone]) => zone === options.businessZone).map(([id]) => id);
    if (!ids.length) conditions.push("0"); else { conditions.push(`s.id IN (${ids.map(() => "?").join(",")})`); params.zoneIds = ids; }
  }
  const from = `FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId ${lifecycleReady ? "JOIN operating_erp_set_members om ON om.erpSkuId=s.id" : "LEFT JOIN operating_erp_set_members om ON om.erpSkuId=s.id"} LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id`;
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
      profile.id businessProfileId,profile.businessStatus,profile.lifecycle businessLifecycle,profile.ownerId businessOwnerId,
      profile.brandOverride,profile.categoryOverride,profile.businessRole,profile.displayNameOverride,
      om.lifecycleStatus operatingLifecycleStatus,om.sourceCount operatingSourceCount,om.firstSeenAt operatingFirstSeenAt,om.lastSeenAt operatingLastSeenAt,
      CASE WHEN profile.id IS NULL THEN 'unprofiled' ELSE 'profiled' END profileStatus,
      (SELECT i.businessDate FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) inventoryDate,
      ${inventoryExpression} stockNum,(SELECT i.availableSendStock FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) availableSendStock,
      (SELECT i.costPrice FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) costPrice,
      (SELECT i.inventoryCostAmount FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) inventoryCostAmount,
      (SELECT i.salesMonth FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC,i.updatedAt DESC LIMIT 1) salesMonth,
      COALESCE((SELECT SUM(f.quantity) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) quantity,
      COALESCE((SELECT SUM(f.salesAmount) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) salesAmount,
      COALESCE((SELECT SUM(f.profitAmount) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),0) profitAmount,
      COALESCE((SELECT SUM(f.quantity) FROM connection_sku_sales_daily_facts f WHERE f.erpSkuId=s.id),(SELECT i.salesMonth FROM erp_sku_inventory_daily_summaries i WHERE i.erpSkuId=s.id ORDER BY i.businessDate DESC LIMIT 1),0) salesMetric
    FROM candidates q JOIN erp_skus s ON s.id=q.id JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN operating_erp_set_members om ON om.erpSkuId=s.id
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    ORDER BY ${order},s.id`).all(...positional, { ...bindParams, limit, offset });
  const relationContext = salesObjectLinkContext(database, rows.map((row) => row.erpSkuId));
  const usageById = new Map(classifyErpSkuUsages({ erpSkuIds: rows.map((row) => row.erpSkuId) }, { database }).map((item) => [item.erpSkuId,item]));
  const hydrated = rows.map((row) => { const links = relationContext.get(row.erpSkuId) || []; const usage = usageById.get(row.erpSkuId); return { ...row,
    productName: text(row.displayNameOverride) || text(row.productName), ownerId: row.businessOwnerId || row.ownerId,
    lifecycleStatus: text(row.businessLifecycle) || text(row.lifecycleStatus),
    linkCount: new Set(links.map((item) => item.salesLinkId)).size, platformSkuCount: links.length,
    displayBrand: text(row.brandOverride) || text(row.brand) || text(row.erpBrand), displayCategory: text(row.categoryOverride) || text(row.category) || text(row.erpCategory), platforms: [...new Set(links.map((item) => item.platform).filter(Boolean))], businessZone: metadata?.zoneById.get(row.erpSkuId) || "",
    erpUsage: usage ? { primaryUsage: usage.primaryUsage, saleGoods: usage.saleGoods, bundleComponent: usage.bundleComponent,
      classificationStatus: usage.classificationStatus, confidence: usage.confidence, usageConflict: usage.usageConflict } : null }; });
  const profileCounts = database.prepare(`SELECT COUNT(*) total,SUM(profile.id IS NOT NULL) profiled,SUM(profile.id IS NULL) unprofiled ${from} WHERE s.currentState='active' ${lifecycleReady ? "AND om.lifecycleStatus IN ('active','active_dependency','sales_active')" : ""}`).get();
  const historical = lifecycleReady ? Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL AND lifecycleStatus IN ('archived','external_unused')").get()?.total || 0) : 0;
  return rememberProductListPage(cacheKey, { rows: hydrated, pagination: { total, limit, offset }, summary: { total: Number(profileCounts.total || 0), profiled: Number(profileCounts.profiled || 0), unprofiled: Number(profileCounts.unprofiled || 0), historical, lifecycleReady } });
}

export function getProductCenterV2SkuDetail(erpSkuId, { scope = "full" } = {}) {
  const database = getDatabase();
  const sku = database.prepare(`SELECT s.*,g.goodsCode,g.goodsName,g.shortName,g.brand erpBrand,g.category erpCategory,g.productType,
      m.id mappingId,m.productId,m.currentState mappingState,p.name productName,p.mainImage productImage,p.galleryImages,p.brand,p.category,p.ownerId,p.status lifecycleStatus,p.remark,
      profile.id businessProfileId,profile.businessStatus,profile.lifecycle businessLifecycle,profile.ownerId businessOwnerId,
      profile.brandOverride,profile.categoryOverride,profile.businessRole,profile.displayNameOverride,profile.createdAt businessProfileCreatedAt,profile.updatedAt businessProfileUpdatedAt,
      om.lifecycleStatus operatingLifecycleStatus,om.sourceCount operatingSourceCount,om.firstSeenAt operatingFirstSeenAt,om.lastSeenAt operatingLastSeenAt,om.calculatedAt operatingCalculatedAt
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN operating_erp_set_members om ON om.erpSkuId=s.id
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id WHERE s.id=?`).get(text(erpSkuId));
  if (!sku) throw new Error("ERP SKU不存在。");
  const resolvedLinks = () => (salesObjectLinkContext(database, [sku.id]).get(sku.id) || []).map((row) => ({ mappingId: null, mappingType: row.relation.relationshipShape, quantity: row.relation.mappings.find((item) => item.erpSkuId === sku.id)?.quantity ?? null, ...row }));
  if (scope === "links") {
    const links = resolvedLinks();
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
    return { operations: database.prepare("SELECT * FROM product_lifecycle_events WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?) ORDER BY changedAt DESC LIMIT 100").all(sku.id, sku.productId) };
  }
  const inventory = database.prepare(`SELECT * FROM erp_sku_inventory_daily_summaries WHERE erpSkuId=? ORDER BY businessDate DESC,updatedAt DESC LIMIT 1`).get(sku.id) ?? null;
  const sales = database.prepare(`SELECT COUNT(*) factCount,MIN(saleDate) firstPeriod,MAX(saleDate) lastPeriod,
      SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
      SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE erpSkuId=?`).get(sku.id);
  const operatingEvidence = database.prepare("SELECT sourceType,sourceObjectType,sourceObjectId,sourceBatchId,firstSeenAt,lastSeenAt,active FROM operating_erp_set_evidence WHERE normalizedCode=lower(trim(?)) ORDER BY active DESC,sourceType,firstSeenAt").all(sku.merchantSkuCode);
  const operatingLifecycleEvents = database.prepare("SELECT fromStatus,toStatus,sourceTypesJson,reason,calculatedAt FROM operating_erp_lifecycle_events WHERE normalizedCode=lower(trim(?)) ORDER BY calculatedAt DESC LIMIT 100").all(sku.merchantSkuCode).map((item) => ({ ...item, sourceTypes: JSON.parse(item.sourceTypesJson || "[]") }));
  const erpUsage = classifyErpSkuUsages({ erpSkuIds: [sku.id] }, { database })[0] || null;
  if (scope === "summary") {
    const businessRead = getProductBusinessReadModel({ range: "30d", erpSkuId: sku.id, includeHistorical: true, page: 1, pageSize: 1 }, { database, includeInventoryCost: false });
    return {
      sku, inventory, sales, operatingEvidence, operatingLifecycleEvents, erpUsage,
      business: businessRead.items[0] ?? null,
      extensionAvailability: {
        status: sku.businessProfileId || businessRead.items[0]?.extensionStatus === "maintained" ? "maintained" : "unmaintained",
        legacyProductId: sku.productId || null,
        erpSkuId: sku.id,
        completeness: businessRead.items[0]?.operatingCompleteness || { basic: false, strategy: false, marketing: false, insight: false },
        message: sku.businessProfileId || businessRead.items[0]?.extensionStatus === "maintained" ? "经营资料已维护。" : "经营资料未维护，可直接开始维护。",
      },
    };
  }
  const links = resolvedLinks();
  const salesTrend = database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(COALESCE(quantity,0)) quantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE erpSkuId=? GROUP BY saleDate ORDER BY saleDate DESC LIMIT 90`).all(sku.id);
  return { sku, inventory, links, sales, salesTrend, operatingEvidence, operatingLifecycleEvents, erpUsage };
}

export function createProductProfileForErpSku(erpSkuId) {
  productListPageCache.clear();
  productListMetadataCache = null;
  return createProductFromErpSku(text(erpSkuId));
}
