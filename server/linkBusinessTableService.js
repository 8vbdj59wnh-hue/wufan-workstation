import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalysesByConnectionIds } from "./connectionGrowthService.js";
import { getConnectionHospitalStages } from "./connectionHospitalService.js";
import { resolveConnectionGrowthDirection } from "./connectionService.js";
import { resolveLinkSalesDateRanges } from "./linkSalesRankingService.js";

export const LINK_BUSINESS_FIELDS = new Set([
  "image", "name", "platform", "shop", "goodsId", "owner",
  "salesAmount", "quantity", "payQuantity", "payBuyerCount",
  "costAmount", "profitAmount", "profitMargin", "viewCount", "visitorCount", "favoriteCount", "cartCount", "conversionRate",
  "growthStatus", "healthStatus", "hospitalStatus", "archiveStatus",
]);

const scopes = new Set(["mine", "company"]);
const sortFields = new Set([
  "default", "name", "platform", "shop", "owner", "salesAmount", "quantity", "payQuantity", "payBuyerCount",
  "costAmount", "profitAmount", "profitMargin", "viewCount", "visitorCount", "favoriteCount", "cartCount", "conversionRate",
  "growthStatus", "healthStatus", "hospitalStatus", "archiveStatus",
]);

function text(value) { return String(value ?? "").trim(); }
function finite(value) { const parsed = Number(value); return value !== "" && value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null; }
function metric(value, count) {
  const hasData = Number(count || 0) > 0;
  return { value: hasData && value !== null && value !== undefined ? Number(value) : null, hasData, noData: !hasData };
}
function dateRanges(raw = {}) {
  const preset = text(raw.preset || raw.dateRange || "7d");
  if (preset === "yesterday") {
    const ranges = resolveLinkSalesDateRanges({ preset: "7d" });
    return { ...ranges, selected: { ...ranges.yesterday, preset: "yesterday" } };
  }
  return resolveLinkSalesDateRanges({ preset, startDate: raw.startDate, endDate: raw.endDate });
}
function normalize(raw = {}) {
  const scope = text(raw.scope || "company");
  if (!scopes.has(scope)) throw new Error("链接经营分析范围无效。");
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(200, Math.max(20, Number(raw.pageSize) || 50));
  const requested = text(raw.fields).split(",").map(text).filter((field) => LINK_BUSINESS_FIELDS.has(field));
  return {
    ...raw, scope, page, pageSize,
    fields: requested.length ? requested : [...LINK_BUSINESS_FIELDS],
    sortField: sortFields.has(text(raw.sortField)) ? text(raw.sortField) : "salesAmount",
    sortDirection: text(raw.sortDirection).toLowerCase() === "asc" ? "asc" : "desc",
  };
}
function compareNullable(left, right, direction = "desc") {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (leftMissing) return 0;
  const result = typeof left === "string" ? left.localeCompare(String(right), "zh-CN") : Number(left) - Number(right);
  return direction === "asc" ? result : -result;
}
function sortValue(item, field) {
  return ({
    default: item.updatedAt, name: item.name, platform: item.platform, shop: item.shopName, owner: item.ownerName,
    salesAmount: item.erp.salesAmount.value, quantity: item.erp.quantity.value,
    costAmount: item.erp.costAmount.value, profitAmount: item.erp.profitAmount.value, profitMargin: item.erp.profitMargin.value,
    payQuantity: item.platformMetrics.payQuantity.value, payBuyerCount: item.platformMetrics.payBuyerCount.value,
    viewCount: item.platformMetrics.viewCount.value, visitorCount: item.platformMetrics.visitorCount.value,
    favoriteCount: item.platformMetrics.favoriteCount.value, cartCount: item.platformMetrics.cartCount.value,
    conversionRate: item.platformMetrics.conversionRate.value, growthStatus: item.growthRate,
    healthStatus: item.healthScore, hospitalStatus: item.hospitalStatus, archiveStatus: item.archiveStatus,
  })[field];
}

export function queryLinkBusinessTable(raw = {}, userId = "", isAdmin = false) {
  const options = normalize(raw);
  if (options.scope === "company" && !isAdmin) {
    const error = new Error("只有管理员可以查看公司全部链接经营分析。"); error.statusCode = 403; throw error;
  }
  const personId = text(userId);
  if (options.scope === "mine" && !personId) throw new Error("无法识别当前登录人员。");
  const ranges = dateRanges(options);
  const where = ["1=1"];
  const params = { startDate: ranges.selected.startDate, endDate: ranges.selected.endDate };
  if (options.scope === "mine") { where.push("c.ownerId=@scopeOwnerId"); params.scopeOwnerId = personId; }
  if (text(options.keyword)) { where.push("(c.name LIKE @keyword OR l.title LIKE @keyword OR l.platformGoodsId LIKE @keyword)"); params.keyword = `%${text(options.keyword)}%`; }
  for (const [key, column] of [["platform", "sh.platform"], ["shopId", "sh.id"], ["ownerId", "c.ownerId"], ["archiveStatus", "c.status"]]) {
    if (text(options[key])) { where.push(`${column}=@${key}`); params[key] = text(options[key]); }
  }
  const minSales = finite(options.minSales); const maxSales = finite(options.maxSales);
  const minProfit = finite(options.minProfit); const maxProfit = finite(options.maxProfit);
  if (minSales !== null) { where.push("fa.salesCount>0 AND fa.salesAmount>=@minSales"); params.minSales = minSales; }
  if (maxSales !== null) { where.push("fa.salesCount>0 AND fa.salesAmount<=@maxSales"); params.maxSales = maxSales; }
  if (minProfit !== null) { where.push("fa.profitCount>0 AND fa.profitAmount>=@minProfit"); params.minProfit = minProfit; }
  if (maxProfit !== null) { where.push("fa.profitCount>0 AND fa.profitAmount<=@maxProfit"); params.maxProfit = maxProfit; }
  const database = getDatabase();
  const rows = database.prepare(`
    WITH fact_aggregate AS (
      SELECT salesLinkId,SUM(salesAmount) salesAmount,COUNT(salesAmount) salesCount,
        SUM(quantity) quantity,COUNT(quantity) quantityCount,
        SUM(costAmount) costAmount,COUNT(costAmount) costCount,
        SUM(profitAmount) profitAmount,COUNT(profitAmount) profitCount
      FROM connection_sku_sales_daily_facts
      WHERE saleDate BETWEEN @startDate AND @endDate GROUP BY salesLinkId
    ), platform_aggregate AS (
      SELECT salesLinkId,SUM(payQuantity) payQuantity,COUNT(payQuantity) payQuantityCount,
        SUM(payBuyerCount) payBuyerCount,COUNT(payBuyerCount) payBuyerCountRows,
        SUM(viewCount) viewCount,COUNT(viewCount) viewCountRows,SUM(visitorCount) visitorCount,COUNT(visitorCount) visitorCountRows,
        SUM(cartCount) cartCount,COUNT(cartCount) cartCountRows,
        SUM(json_extract(metricsJson,'$.favoriteCount')) favoriteCount,
        COUNT(json_extract(metricsJson,'$.favoriteCount')) favoriteCountRows,
        CASE WHEN SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN visitorCount END)>0
          THEN SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN conversionRate*visitorCount END)
            / SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN visitorCount END) END conversionRate,
        COUNT(conversionRate) conversionCount
      FROM connection_period_snapshots
      WHERE substr(periodStart,1,10)>=@startDate AND substr(periodEnd,1,10)<=@endDate GROUP BY salesLinkId
    )
    SELECT c.id,c.salesLinkId,c.name,c.mainImage,c.ownerId,c.status archiveStatus,c.updatedAt,
      l.platformGoodsId,l.canonicalUrl,sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName,p.name ownerName,
      fa.salesAmount,fa.salesCount,fa.quantity,fa.quantityCount,fa.costAmount,fa.costCount,fa.profitAmount,fa.profitCount,
      pa.payQuantity,pa.payQuantityCount,pa.payBuyerCount,pa.payBuyerCountRows,pa.viewCount,pa.viewCountRows,
      pa.visitorCount,pa.visitorCountRows,pa.favoriteCount,pa.favoriteCountRows,pa.cartCount,pa.cartCountRows,
      pa.conversionRate,pa.conversionCount
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId LEFT JOIN fact_aggregate fa ON fa.salesLinkId=c.salesLinkId
    LEFT JOIN platform_aggregate pa ON pa.salesLinkId=c.salesLinkId WHERE ${where.join(" AND ")}
  `).all(params);
  const ids = rows.map((row) => row.id);
  const analyses = new Map(listConnectionGrowthAnalysesByConnectionIds(ids).map((item) => [item.connectionId, item]));
  const hospitals = getConnectionHospitalStages(ids);
  let items = rows.map((row) => {
    const analysis = analyses.get(row.id) ?? { comparable: false, healthStatus: "no_data", healthScore: null, salesGrowth: null };
    const profitMargin = Number(row.salesCount || 0) > 0 && Number(row.salesAmount) !== 0
      ? metric(Number(row.profitAmount || 0) / Number(row.salesAmount), 1) : metric(null, 0);
    return {
      id: row.id, salesLinkId: row.salesLinkId, name: row.name, mainImage: row.mainImage, ownerId: row.ownerId,
      ownerName: row.ownerName, platform: row.platform, shopId: row.shopId, shopName: row.shopName,
      platformGoodsId: row.platformGoodsId, canonicalUrl: row.canonicalUrl, archiveStatus: row.archiveStatus, updatedAt: row.updatedAt,
      erp: { salesAmount: metric(row.salesAmount, row.salesCount), quantity: metric(row.quantity, row.quantityCount),
        costAmount: metric(row.costAmount, row.costCount), profitAmount: metric(row.profitAmount, row.profitCount), profitMargin },
      platformMetrics: { payQuantity: metric(row.payQuantity, row.payQuantityCount), payBuyerCount: metric(row.payBuyerCount, row.payBuyerCountRows),
        viewCount: metric(row.viewCount, row.viewCountRows), visitorCount: metric(row.visitorCount, row.visitorCountRows),
        favoriteCount: metric(row.favoriteCount, row.favoriteCountRows), cartCount: metric(row.cartCount, row.cartCountRows),
        conversionRate: metric(row.conversionRate, row.conversionCount) },
      growthStatus: analysis.comparable ? resolveConnectionGrowthDirection(analysis) : "no_data", growthRate: analysis.salesGrowth ?? null,
      healthStatus: analysis.healthStatus || "no_data", healthScore: analysis.healthScore ?? null,
      hospitalStatus: hospitals.get(row.id) || "none",
    };
  });
  if (text(options.growthStatus)) items = items.filter((item) => item.growthStatus === text(options.growthStatus));
  if (text(options.healthStatus)) items = items.filter((item) => item.healthStatus === text(options.healthStatus));
  if (text(options.hospitalStatus)) items = items.filter((item) => item.hospitalStatus === text(options.hospitalStatus));
  items.sort((left, right) => compareNullable(sortValue(left, options.sortField), sortValue(right, options.sortField), options.sortDirection)
    || left.id.localeCompare(right.id));
  const total = items.length;
  items = items.slice((options.page - 1) * options.pageSize, options.page * options.pageSize);
  const optionWhere = options.scope === "mine" ? "WHERE c.ownerId=@scopeOwnerId" : "";
  const optionRows = database.prepare(`SELECT DISTINCT sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId ${optionWhere}
    ORDER BY sh.platform,shopName,sh.id`).all(params);
  const owners = database.prepare(`SELECT DISTINCT p.id,p.name FROM connection_profiles c JOIN persons p ON p.id=c.ownerId
    ${options.scope === "mine" ? "WHERE c.ownerId=@scopeOwnerId" : ""} ORDER BY p.name,p.id`).all(params);
  const sources = {
    erp: database.prepare("SELECT MIN(saleDate) minDate,MAX(saleDate) maxDate FROM connection_sku_sales_daily_facts").get(),
    platform: database.prepare("SELECT MIN(substr(periodStart,1,10)) minDate,MAX(substr(periodEnd,1,10)) maxDate FROM connection_period_snapshots").get(),
  };
  return { scope: options.scope, range: ranges.selected, fields: options.fields, items,
    pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) },
    sort: { field: options.sortField, direction: options.sortDirection }, dataSources: sources,
    filterOptions: { platforms: [...new Set(optionRows.map((item) => item.platform).filter(Boolean))],
      shops: optionRows.map((item) => ({ id: item.shopId, name: item.shopName, platform: item.platform })), owners },
  };
}
