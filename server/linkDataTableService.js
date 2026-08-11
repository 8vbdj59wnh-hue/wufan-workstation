import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalysesByConnectionIds } from "./connectionGrowthService.js";
import { getConnectionHospitalStages } from "./connectionHospitalService.js";
import { readConnectionV3MetricsMap } from "./connectionV3MetricsService.js";
import { resolveLinkSalesDateRanges } from "./linkSalesRankingService.js";
import { resolveConnectionGrowthDirection } from "./connectionService.js";

const scopes = new Set(["mine", "company"]);
const sortColumns = {
  default: "c.updatedAt",
  name: "c.name",
  platform: "sh.platform",
  shop: "COALESCE(sh.displayName,sh.shopName)",
  yesterdaySales: "COALESCE(sa.yesterdaySales,0)",
  sales7d: "COALESCE(sa.sales7d,0)",
  sales30d: "COALESCE(sa.sales30d,0)",
  selectedSales: "COALESCE(sa.selectedSales,0)",
  archiveStatus: "c.status",
};
const allowedFields = new Set([
  "image", "name", "platform", "shop", "goodsId", "owner", "yesterdaySales", "sales7d", "sales30d",
  "selectedSales", "growthStatus", "healthStatus", "hospitalStatus", "archiveStatus",
]);

function text(value) { return String(value ?? "").trim(); }
function metric(value, count) {
  const hasData = Number(count || 0) > 0;
  return { value: hasData ? Number(value || 0) : null, hasData, noData: !hasData };
}
function normalizeInput(raw = {}) {
  const scope = text(raw.scope || "mine");
  if (!scopes.has(scope)) throw new Error("链接数据表范围无效。");
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(200, Math.max(20, Number(raw.pageSize) || 50));
  const sortField = sortColumns[text(raw.sortField)] ? text(raw.sortField) : "default";
  const sortDirection = text(raw.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const requestedFields = text(raw.fields).split(",").map(text).filter((field) => allowedFields.has(field));
  const connectionIds = [...new Set(text(raw.connectionIds).split(",").map(text).filter(Boolean))].slice(0, 100);
  return { ...raw, scope, page, pageSize, offset: (page - 1) * pageSize, sortField, sortDirection,
    fields: requestedFields.length ? requestedFields : [...allowedFields], connectionIds };
}

export function queryLinkDataTable(raw = {}, userId = "", isAdmin = false) {
  const options = normalizeInput(raw);
  if (options.scope === "company" && !isAdmin) {
    const error = new Error("只有管理员可以查看公司全部链接数据。"); error.statusCode = 403; throw error;
  }
  const personId = text(userId);
  if (options.scope === "mine" && !personId) throw new Error("无法识别当前登录人员。");
  const ranges = resolveLinkSalesDateRanges({ preset: options.preset || "7d", startDate: options.startDate, endDate: options.endDate });
  const where = ["1=1"];
  const params = {
    yesterdayStart: ranges.yesterday.startDate, yesterdayEnd: ranges.yesterday.endDate,
    sevenStart: ranges.sevenDays.startDate, sevenEnd: ranges.sevenDays.endDate,
    thirtyStart: ranges.thirtyDays.startDate, thirtyEnd: ranges.thirtyDays.endDate,
    selectedStart: ranges.selected.startDate, selectedEnd: ranges.selected.endDate,
  };
  if (options.scope === "mine") { where.push("c.ownerId=@ownerId"); params.ownerId = personId; }
  if (text(options.keyword)) { where.push("(c.name LIKE @keyword OR l.title LIKE @keyword OR l.platformGoodsId LIKE @keyword)"); params.keyword = `%${text(options.keyword)}%`; }
  if (text(options.platform)) { where.push("sh.platform=@platform"); params.platform = text(options.platform); }
  if (text(options.shopId)) { where.push("sh.id=@shopId"); params.shopId = text(options.shopId); }
  if (text(options.archiveStatus)) { where.push("c.status=@archiveStatus"); params.archiveStatus = text(options.archiveStatus); }
  if (options.connectionIds.length) {
    const placeholders = options.connectionIds.map((id, index) => { params[`connectionId${index}`] = id; return `@connectionId${index}`; });
    where.push(`c.id IN (${placeholders.join(",")})`);
  }
  const whereSql = where.join(" AND ");
  const salesAggregate = `
    SELECT salesLinkId,
      SUM(CASE WHEN saleDate BETWEEN @yesterdayStart AND @yesterdayEnd THEN COALESCE(salesAmount,0) END) yesterdaySales,
      COUNT(CASE WHEN saleDate BETWEEN @yesterdayStart AND @yesterdayEnd THEN 1 END) yesterdayCount,
      SUM(CASE WHEN saleDate BETWEEN @sevenStart AND @sevenEnd THEN COALESCE(salesAmount,0) END) sales7d,
      COUNT(CASE WHEN saleDate BETWEEN @sevenStart AND @sevenEnd THEN 1 END) count7d,
      SUM(CASE WHEN saleDate BETWEEN @thirtyStart AND @thirtyEnd THEN COALESCE(salesAmount,0) END) sales30d,
      COUNT(CASE WHEN saleDate BETWEEN @thirtyStart AND @thirtyEnd THEN 1 END) count30d,
      SUM(CASE WHEN saleDate BETWEEN @selectedStart AND @selectedEnd THEN COALESCE(salesAmount,0) END) selectedSales,
      COUNT(CASE WHEN saleDate BETWEEN @selectedStart AND @selectedEnd THEN 1 END) selectedCount
    FROM connection_sku_sales_daily_facts
    WHERE saleDate>=MIN(@thirtyStart,@selectedStart,@yesterdayStart)
      AND saleDate<=MAX(@thirtyEnd,@selectedEnd,@yesterdayEnd)
    GROUP BY salesLinkId`;
  const database = getDatabase();
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM connection_profiles c
    JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId WHERE ${whereSql}`).get(params)?.count || 0);
  const orderBy = sortColumns[options.sortField];
  const rows = database.prepare(`WITH sales_aggregate AS (${salesAggregate})
    SELECT c.id,c.salesLinkId,c.name,c.mainImage,c.ownerId,c.status archiveStatus,c.level,
      l.platformGoodsId,l.canonicalUrl,sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName,
      p.name ownerName,sa.yesterdaySales,sa.yesterdayCount,sa.sales7d,sa.count7d,sa.sales30d,sa.count30d,sa.selectedSales,sa.selectedCount
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId LEFT JOIN sales_aggregate sa ON sa.salesLinkId=c.salesLinkId
    WHERE ${whereSql} ORDER BY ${orderBy} ${options.sortDirection},c.id ${options.sortDirection}
    LIMIT @limit OFFSET @offset`).all({ ...params, limit: options.pageSize, offset: options.offset });
  const connectionIds = rows.map((item) => item.id);
  const analyses = new Map(listConnectionGrowthAnalysesByConnectionIds(connectionIds).map((item) => [item.connectionId, item]));
  const v3 = readConnectionV3MetricsMap(rows.map((item) => item.salesLinkId));
  const hospital = getConnectionHospitalStages(connectionIds);
  const items = rows.map((row) => {
    const baseAnalysis = analyses.get(row.id) ?? { comparable: false, healthStatus: "no_data", healthScore: null };
    const v3Metric = v3.get(row.salesLinkId);
    const analysis = { ...baseAnalysis, salesGrowth: v3Metric?.salesGrowth ?? baseAnalysis.salesGrowth,
      profitGrowth: v3Metric?.profitGrowth ?? baseAnalysis.profitGrowth };
    return { id: row.id, salesLinkId: row.salesLinkId, name: row.name, mainImage: row.mainImage,
      platform: row.platform, shopId: row.shopId, shopName: row.shopName, platformGoodsId: row.platformGoodsId,
      canonicalUrl: row.canonicalUrl, ownerId: row.ownerId, ownerName: row.ownerName,
      sales: { yesterday: metric(row.yesterdaySales, row.yesterdayCount), sevenDays: metric(row.sales7d, row.count7d),
        thirtyDays: metric(row.sales30d, row.count30d), selected: metric(row.selectedSales, row.selectedCount) },
      growthStatus: analysis.comparable ? resolveConnectionGrowthDirection(analysis) : "no_data",
      growthRate: analysis.salesGrowth ?? null,
      healthStatus: analysis.healthStatus || "no_data", healthScore: analysis.healthScore ?? null,
      hospitalStatus: hospital.get(row.id) || "none", archiveStatus: row.archiveStatus,
    };
  });
  const sourceDate = database.prepare(`SELECT MIN(saleDate) minDate,MAX(saleDate) maxDate
    FROM connection_sku_sales_daily_facts`).get();
  const optionWhere = options.scope === "mine" ? "WHERE c.ownerId=@ownerId" : "";
  const filterRows = database.prepare(`SELECT DISTINCT sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    ${optionWhere} ORDER BY sh.platform,shopName,sh.id`).all(params);
  return { scope: options.scope, range: ranges.selected, ranges, fields: options.fields, items,
    pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) },
    dataSource: { type: "connection_sku_sales_daily_facts", minDate: sourceDate?.minDate ?? null, maxDate: sourceDate?.maxDate ?? null,
      noData: !sourceDate?.maxDate },
    filterOptions: { platforms: [...new Set(filterRows.map((item) => item.platform).filter(Boolean))],
      shops: filterRows.map((item) => ({ id: item.shopId, name: item.shopName, platform: item.platform })) },
  };
}
