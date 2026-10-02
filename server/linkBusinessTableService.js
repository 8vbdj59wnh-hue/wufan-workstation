import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalysesByConnectionIds } from "./connectionGrowthService.js";
import { resolveConnectionGrowthDirection } from "./connectionService.js";
import { buildLinkOperatingScope, getLinkOperatingSummary } from "./linkOperatingSetService.js";
import { resolveLinkSalesDateRanges } from "./linkSalesRankingService.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";

export const LINK_BUSINESS_FIELDS = new Set([
  "image", "name", "platform", "shop", "goodsId", "owner", "url", "category", "platformStatus", "periodStart", "periodEnd",
  "statisticsDate", "productType", "productStatus", "productTags",
  "salesAmount", "quantity", "payAmount", "payQuantity", "payBuyerCount", "refundAmount",
  "costAmount", "profitAmount", "profitMargin", "viewCount", "visitorCount", "clickCount", "averageStayDuration", "bounceRate",
  "favoriteCount", "cartCount", "cartBuyerCount", "orderBuyerCount", "orderQuantity", "orderAmount", "orderConversionRate",
  "conversionRate", "payNewBuyerCount", "payOldBuyerCount", "oldBuyerPayAmount", "juHuaSuanPayAmount", "visitorValue",
  "competitionScore", "annualPayAmount", "monthlyPayAmount", "monthlyPayQuantity", "searchPayConversionRate",
  "searchVisitorCount", "searchPayBuyerCount", "structuredDetailConversionRate", "structuredDetailTransactionShare",
  "growthStatus", "archiveStatus",
]);

const scopes = new Set(["mine", "company"]);
const sortFields = new Set([
  "default", "name", "platform", "shop", "owner", "category", "platformStatus", "periodStart", "periodEnd",
  "statisticsDate", "productType", "productStatus", "productTags",
  "salesAmount", "quantity", "payAmount", "payQuantity", "payBuyerCount", "refundAmount",
  "costAmount", "profitAmount", "profitMargin", "viewCount", "visitorCount", "clickCount", "averageStayDuration", "bounceRate",
  "favoriteCount", "cartCount", "cartBuyerCount", "orderBuyerCount", "orderQuantity", "orderAmount", "orderConversionRate",
  "conversionRate", "payNewBuyerCount", "payOldBuyerCount", "oldBuyerPayAmount", "juHuaSuanPayAmount", "visitorValue",
  "competitionScore", "annualPayAmount", "monthlyPayAmount", "monthlyPayQuantity", "searchPayConversionRate",
  "searchVisitorCount", "searchPayBuyerCount", "structuredDetailConversionRate", "structuredDetailTransactionShare",
  "growthStatus", "archiveStatus",
]);

function text(value) { return String(value ?? "").trim(); }
function finite(value) { const parsed = Number(value); return value !== "" && value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null; }
function metric(value, count) {
  const hasData = Number(count || 0) > 0;
  return { value: hasData && value !== null && value !== undefined ? Number(value) : null, hasData, noData: !hasData };
}
function jsonMetricSql(key, { percent = false } = {}) {
  const value = `CAST(NULLIF(NULLIF(REPLACE(REPLACE(TRIM(json_extract(metricsJson,'$."${key}"')),',',''),'%',''),''),'-') AS REAL)`;
  return percent ? `(${value}/100.0)` : value;
}
function jsonTextSql(key) {
  return `NULLIF(NULLIF(TRIM(json_extract(metricsJson,'$."${key}"')),''),'-')`;
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
    category: item.category, platformStatus: item.platformStatus, periodStart: item.platformPeriodStart, periodEnd: item.platformPeriodEnd,
    statisticsDate: item.platformMetrics.statisticsDate, productType: item.platformMetrics.productType,
    productStatus: item.platformMetrics.productStatus, productTags: item.platformMetrics.productTags,
    salesAmount: item.erp.salesAmount.value, quantity: item.erp.quantity.value,
    costAmount: item.erp.costAmount.value, profitAmount: item.erp.profitAmount.value, profitMargin: item.erp.profitMargin.value,
    payAmount: item.platformMetrics.payAmount.value, payQuantity: item.platformMetrics.payQuantity.value,
    payBuyerCount: item.platformMetrics.payBuyerCount.value, refundAmount: item.platformMetrics.refundAmount.value,
    viewCount: item.platformMetrics.viewCount.value, visitorCount: item.platformMetrics.visitorCount.value,
    clickCount: item.platformMetrics.clickCount.value, averageStayDuration: item.platformMetrics.averageStayDuration.value,
    bounceRate: item.platformMetrics.bounceRate.value, favoriteCount: item.platformMetrics.favoriteCount.value,
    cartCount: item.platformMetrics.cartCount.value, cartBuyerCount: item.platformMetrics.cartBuyerCount.value,
    orderBuyerCount: item.platformMetrics.orderBuyerCount.value, orderQuantity: item.platformMetrics.orderQuantity.value,
    orderAmount: item.platformMetrics.orderAmount.value, orderConversionRate: item.platformMetrics.orderConversionRate.value,
    conversionRate: item.platformMetrics.conversionRate.value, payNewBuyerCount: item.platformMetrics.payNewBuyerCount.value,
    payOldBuyerCount: item.platformMetrics.payOldBuyerCount.value, oldBuyerPayAmount: item.platformMetrics.oldBuyerPayAmount.value,
    juHuaSuanPayAmount: item.platformMetrics.juHuaSuanPayAmount.value, visitorValue: item.platformMetrics.visitorValue.value,
    competitionScore: item.platformMetrics.competitionScore.value, annualPayAmount: item.platformMetrics.annualPayAmount.value,
    monthlyPayAmount: item.platformMetrics.monthlyPayAmount.value, monthlyPayQuantity: item.platformMetrics.monthlyPayQuantity.value,
    searchPayConversionRate: item.platformMetrics.searchPayConversionRate.value,
    searchVisitorCount: item.platformMetrics.searchVisitorCount.value, searchPayBuyerCount: item.platformMetrics.searchPayBuyerCount.value,
    structuredDetailConversionRate: item.platformMetrics.structuredDetailConversionRate.value,
    structuredDetailTransactionShare: item.platformMetrics.structuredDetailTransactionShare.value,
    growthStatus: item.growthRate,
    archiveStatus: item.archiveStatus,
  })[field];
}

export function queryLinkBusinessTable(raw = {}, userId = "", isAdmin = false) {
  const options = normalize(raw);
  if (options.scope === "company" && !isAdmin) {
    const error = new Error("只有管理员可以查看公司全部链接经营分析。"); error.statusCode = 403; throw error;
  }
  const personId = text(userId);
  if (options.scope === "mine" && !personId) throw new Error("无法识别当前登录人员。");
  const database = getDatabase();
  const ranges = dateRanges(options);
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "linkBusinessOperating" });
  const includeHistorical = [true, 1, "1", "true"].includes(options.includeHistorical);
  const where = includeHistorical ? ["1=1"] : [operatingScope.predicate];
  const params = { ...operatingScope.params, startDate: ranges.selected.startDate, endDate: ranges.selected.endDate };
  if (options.scope === "mine") { where.push("c.ownerId=@scopeOwnerId"); params.scopeOwnerId = personId; }
  if (text(options.keyword)) { where.push("(COALESCE(c.name,'') LIKE @keyword OR COALESCE(l.title,'') LIKE @keyword OR l.platformGoodsId LIKE @keyword)"); params.keyword = `%${text(options.keyword)}%`; }
  for (const [key, column] of [["platform", "sh.platform"], ["shopId", "sh.id"], ["ownerId", "c.ownerId"], ["archiveStatus", "c.status"]]) {
    if (text(options[key])) { where.push(`${column}=@${key}`); params[key] = text(options[key]); }
  }
  const minSales = finite(options.minSales); const maxSales = finite(options.maxSales);
  const minProfit = finite(options.minProfit); const maxProfit = finite(options.maxProfit);
  const minProfitMargin = finite(options.minProfitMargin); const maxProfitMargin = finite(options.maxProfitMargin);
  if (minSales !== null) { where.push("fa.salesCount>0 AND fa.salesAmount>=@minSales"); params.minSales = minSales; }
  if (maxSales !== null) { where.push("fa.salesCount>0 AND fa.salesAmount<=@maxSales"); params.maxSales = maxSales; }
  if (minProfit !== null) { where.push("fa.profitCount>0 AND fa.profitAmount>=@minProfit"); params.minProfit = minProfit; }
  if (maxProfit !== null) { where.push("fa.profitCount>0 AND fa.profitAmount<=@maxProfit"); params.maxProfit = maxProfit; }
  if (minProfitMargin !== null) {
    where.push("fa.salesCount>0 AND fa.profitCount>0 AND fa.salesAmount<>0 AND 1.0*fa.profitAmount/fa.salesAmount>=@minProfitMargin");
    params.minProfitMargin = minProfitMargin / 100;
  }
  if (maxProfitMargin !== null) {
    where.push("fa.salesCount>0 AND fa.profitCount>0 AND fa.salesAmount<>0 AND 1.0*fa.profitAmount/fa.salesAmount<=@maxProfitMargin");
    params.maxProfitMargin = maxProfitMargin / 100;
  }
  const rows = database.prepare(`
    WITH fact_aggregate AS (
      SELECT salesLinkId,SUM(salesAmount) salesAmount,COUNT(salesAmount) salesCount,
        SUM(quantity) quantity,COUNT(quantity) quantityCount,
        SUM(costAmount) costAmount,COUNT(costAmount) costCount,
        SUM(profitAmount) profitAmount,COUNT(profitAmount) profitCount
      FROM connection_sku_sales_daily_facts
      WHERE saleDate BETWEEN @startDate AND @endDate GROUP BY salesLinkId
    ), platform_source AS (
      SELECT salesLinkId,periodStart,periodEnd,visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,
        conversionRate,payAmount,payQuantity,refundAmount,
        ${jsonTextSql("统计日期")} statisticsDate,
        ${jsonTextSql("商品类型")} productType,
        ${jsonTextSql("商品状态")} productStatus,
        ${jsonTextSql("商品标签")} productTags,
        COALESCE(json_extract(metricsJson,'$.clickCount'),${jsonMetricSql("点击量")}) clickCount,
        COALESCE(json_extract(metricsJson,'$.favoriteCount'),${jsonMetricSql("商品收藏人数")}) favoriteCount,
        ${jsonMetricSql("平均停留时长")} averageStayDuration,
        ${jsonMetricSql("商品详情页跳出率", { percent: true })} bounceRate,
        ${jsonMetricSql("商品加购人数")} cartBuyerCount,
        ${jsonMetricSql("下单件数")} orderQuantity,
        ${jsonMetricSql("下单金额")} orderAmount,
        ${jsonMetricSql("下单转化率", { percent: true })} orderConversionRate,
        ${jsonMetricSql("支付新买家数")} payNewBuyerCount,
        ${jsonMetricSql("支付老买家数")} payOldBuyerCount,
        ${jsonMetricSql("老买家支付金额")} oldBuyerPayAmount,
        ${jsonMetricSql("聚划算支付金额")} juHuaSuanPayAmount,
        ${jsonMetricSql("访客平均价值")} visitorValue,
        COALESCE(competitionScore,${jsonMetricSql("竞争力评分")}) competitionScore,
        ${jsonMetricSql("年累计支付金额")} annualPayAmount,
        ${jsonMetricSql("月累计支付金额")} monthlyPayAmount,
        ${jsonMetricSql("月累计支付件数")} monthlyPayQuantity,
        ${jsonMetricSql("搜索引导支付转化率", { percent: true })} searchPayConversionRate,
        ${jsonMetricSql("搜索引导访客数")} searchVisitorCount,
        ${jsonMetricSql("搜索引导支付买家数")} searchPayBuyerCount,
        ${jsonMetricSql("结构化详情引导转化率", { percent: true })} structuredDetailConversionRate,
        ${jsonMetricSql("结构化详情引导成交占比", { percent: true })} structuredDetailTransactionShare
      FROM connection_period_snapshots
      WHERE substr(periodStart,1,10)>=@startDate AND substr(periodEnd,1,10)<=@endDate
    ), platform_aggregate AS (
      SELECT salesLinkId,MIN(substr(periodStart,1,10)) periodStart,MAX(substr(periodEnd,1,10)) periodEnd,
        MAX(statisticsDate) statisticsDate,GROUP_CONCAT(DISTINCT productType) productType,
        GROUP_CONCAT(DISTINCT productStatus) productStatus,GROUP_CONCAT(DISTINCT productTags) productTags,
        SUM(payAmount) payAmount,COUNT(payAmount) payAmountCount,
        SUM(payQuantity) payQuantity,COUNT(payQuantity) payQuantityCount,
        SUM(payBuyerCount) payBuyerCount,COUNT(payBuyerCount) payBuyerCountRows,
        SUM(refundAmount) refundAmount,COUNT(refundAmount) refundAmountCount,
        SUM(viewCount) viewCount,COUNT(viewCount) viewCountRows,SUM(visitorCount) visitorCount,COUNT(visitorCount) visitorCountRows,
        SUM(cartCount) cartCount,COUNT(cartCount) cartCountRows,
        SUM(orderBuyerCount) orderBuyerCount,COUNT(orderBuyerCount) orderBuyerCountRows,
        SUM(clickCount) clickCount,COUNT(clickCount) clickCountRows,
        SUM(favoriteCount) favoriteCount,COUNT(favoriteCount) favoriteCountRows,
        AVG(averageStayDuration) averageStayDuration,COUNT(averageStayDuration) averageStayDurationRows,
        AVG(bounceRate) bounceRate,COUNT(bounceRate) bounceRateRows,
        SUM(cartBuyerCount) cartBuyerCount,COUNT(cartBuyerCount) cartBuyerCountRows,
        SUM(orderQuantity) orderQuantity,COUNT(orderQuantity) orderQuantityRows,
        SUM(orderAmount) orderAmount,COUNT(orderAmount) orderAmountRows,
        AVG(orderConversionRate) orderConversionRate,COUNT(orderConversionRate) orderConversionRateRows,
        SUM(payNewBuyerCount) payNewBuyerCount,COUNT(payNewBuyerCount) payNewBuyerCountRows,
        SUM(payOldBuyerCount) payOldBuyerCount,COUNT(payOldBuyerCount) payOldBuyerCountRows,
        SUM(oldBuyerPayAmount) oldBuyerPayAmount,COUNT(oldBuyerPayAmount) oldBuyerPayAmountRows,
        SUM(juHuaSuanPayAmount) juHuaSuanPayAmount,COUNT(juHuaSuanPayAmount) juHuaSuanPayAmountRows,
        AVG(visitorValue) visitorValue,COUNT(visitorValue) visitorValueRows,
        AVG(competitionScore) competitionScore,COUNT(competitionScore) competitionScoreRows,
        MAX(annualPayAmount) annualPayAmount,COUNT(annualPayAmount) annualPayAmountRows,
        MAX(monthlyPayAmount) monthlyPayAmount,COUNT(monthlyPayAmount) monthlyPayAmountRows,
        MAX(monthlyPayQuantity) monthlyPayQuantity,COUNT(monthlyPayQuantity) monthlyPayQuantityRows,
        AVG(searchPayConversionRate) searchPayConversionRate,COUNT(searchPayConversionRate) searchPayConversionRateRows,
        SUM(searchVisitorCount) searchVisitorCount,COUNT(searchVisitorCount) searchVisitorCountRows,
        SUM(searchPayBuyerCount) searchPayBuyerCount,COUNT(searchPayBuyerCount) searchPayBuyerCountRows,
        AVG(structuredDetailConversionRate) structuredDetailConversionRate,
        COUNT(structuredDetailConversionRate) structuredDetailConversionRateRows,
        AVG(structuredDetailTransactionShare) structuredDetailTransactionShare,
        COUNT(structuredDetailTransactionShare) structuredDetailTransactionShareRows,
        CASE WHEN SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN visitorCount END)>0
          THEN SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN conversionRate*visitorCount END)
            / SUM(CASE WHEN conversionRate IS NOT NULL AND visitorCount IS NOT NULL THEN visitorCount END) END conversionRate,
        COUNT(conversionRate) conversionCount
      FROM platform_source GROUP BY salesLinkId
    )
    SELECT COALESCE(c.id,l.id) id,c.id connectionProfileId,l.id salesLinkId,
      COALESCE(NULLIF(c.name,''),NULLIF(l.title,''),l.platformGoodsId) name,c.mainImage,c.ownerId,
      COALESCE(c.status,l.currentState,'active') archiveStatus,
      CASE WHEN ${operatingScope.predicate} THEN 'operating' ELSE 'historical' END operatingState,
      COALESCE(c.updatedAt,l.updatedAt) updatedAt,
      l.platformGoodsId,l.canonicalUrl,l.category,l.status platformStatus,sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName,p.name ownerName,
      cr.grade contributionGrade,cr.error contributionError,
      fa.salesAmount,fa.salesCount,fa.quantity,fa.quantityCount,fa.costAmount,fa.costCount,fa.profitAmount,fa.profitCount,
      pa.periodStart,pa.periodEnd,pa.statisticsDate,pa.productType,pa.productStatus,pa.productTags,
      pa.payAmount,pa.payAmountCount,pa.payQuantity,pa.payQuantityCount,
      pa.payBuyerCount,pa.payBuyerCountRows,pa.refundAmount,pa.refundAmountCount,pa.viewCount,pa.viewCountRows,
      pa.visitorCount,pa.visitorCountRows,pa.clickCount,pa.clickCountRows,pa.favoriteCount,pa.favoriteCountRows,
      pa.averageStayDuration,pa.averageStayDurationRows,pa.bounceRate,pa.bounceRateRows,
      pa.cartCount,pa.cartCountRows,pa.cartBuyerCount,pa.cartBuyerCountRows,
      pa.orderBuyerCount,pa.orderBuyerCountRows,pa.orderQuantity,pa.orderQuantityRows,pa.orderAmount,pa.orderAmountRows,
      pa.orderConversionRate,pa.orderConversionRateRows,pa.conversionRate,pa.conversionCount,
      pa.payNewBuyerCount,pa.payNewBuyerCountRows,pa.payOldBuyerCount,pa.payOldBuyerCountRows,
      pa.oldBuyerPayAmount,pa.oldBuyerPayAmountRows,pa.juHuaSuanPayAmount,pa.juHuaSuanPayAmountRows,
      pa.visitorValue,pa.visitorValueRows,pa.competitionScore,pa.competitionScoreRows,
      pa.annualPayAmount,pa.annualPayAmountRows,pa.monthlyPayAmount,pa.monthlyPayAmountRows,
      pa.monthlyPayQuantity,pa.monthlyPayQuantityRows,pa.searchPayConversionRate,pa.searchPayConversionRateRows,
      pa.searchVisitorCount,pa.searchVisitorCountRows,pa.searchPayBuyerCount,pa.searchPayBuyerCountRows,
      pa.structuredDetailConversionRate,pa.structuredDetailConversionRateRows,
      pa.structuredDetailTransactionShare,pa.structuredDetailTransactionShareRows
    FROM sales_links l JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id
    LEFT JOIN persons p ON p.id=c.ownerId LEFT JOIN fact_aggregate fa ON fa.salesLinkId=l.id
    LEFT JOIN link_contribution_results cr ON cr.salesLinkId=l.id
      AND cr.runId=(SELECT id FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1)
    LEFT JOIN platform_aggregate pa ON pa.salesLinkId=l.id WHERE ${where.join(" AND ")}
  `).all(params);
  const ids = rows.map((row) => row.connectionProfileId).filter(Boolean);
  const analyses = new Map(listConnectionGrowthAnalysesByConnectionIds(ids).map((item) => [item.connectionId, item]));
  let items = rows.map((row) => {
    const analysis = (row.connectionProfileId ? analyses.get(row.connectionProfileId) : null) ?? { comparable: false, salesGrowth: null };
    const profitMargin = Number(row.salesCount || 0) > 0 && Number(row.salesAmount) !== 0
      ? metric(Number(row.profitAmount || 0) / Number(row.salesAmount), 1) : metric(null, 0);
    return {
      id: row.id, salesLinkId: row.salesLinkId, name: row.name, mainImage: row.mainImage, ownerId: row.ownerId,
      contributionGrade: row.contributionGrade || null, contributionError: row.contributionError || null,
      ownerName: row.ownerName, platform: row.platform, shopId: row.shopId, shopName: row.shopName,
      platformGoodsId: row.platformGoodsId, canonicalUrl: row.canonicalUrl, category: row.category, platformStatus: row.platformStatus,
      platformPeriodStart: row.periodStart, platformPeriodEnd: row.periodEnd,
      operatingState: row.operatingState, archiveStatus: row.operatingState === "historical" ? "historical" : row.archiveStatus, updatedAt: row.updatedAt,
      erp: { salesAmount: metric(row.salesAmount, row.salesCount), quantity: metric(row.quantity, row.quantityCount),
        costAmount: metric(row.costAmount, row.costCount), profitAmount: metric(row.profitAmount, row.profitCount), profitMargin },
      platformMetrics: { statisticsDate: row.statisticsDate, productType: row.productType, productStatus: row.productStatus, productTags: row.productTags,
        payAmount: metric(row.payAmount, row.payAmountCount), payQuantity: metric(row.payQuantity, row.payQuantityCount),
        payBuyerCount: metric(row.payBuyerCount, row.payBuyerCountRows), refundAmount: metric(row.refundAmount, row.refundAmountCount),
        viewCount: metric(row.viewCount, row.viewCountRows), visitorCount: metric(row.visitorCount, row.visitorCountRows),
        clickCount: metric(row.clickCount, row.clickCountRows), averageStayDuration: metric(row.averageStayDuration, row.averageStayDurationRows),
        bounceRate: metric(row.bounceRate, row.bounceRateRows), favoriteCount: metric(row.favoriteCount, row.favoriteCountRows),
        cartCount: metric(row.cartCount, row.cartCountRows), cartBuyerCount: metric(row.cartBuyerCount, row.cartBuyerCountRows),
        orderBuyerCount: metric(row.orderBuyerCount, row.orderBuyerCountRows), orderQuantity: metric(row.orderQuantity, row.orderQuantityRows),
        orderAmount: metric(row.orderAmount, row.orderAmountRows), orderConversionRate: metric(row.orderConversionRate, row.orderConversionRateRows),
        conversionRate: metric(row.conversionRate, row.conversionCount), payNewBuyerCount: metric(row.payNewBuyerCount, row.payNewBuyerCountRows),
        payOldBuyerCount: metric(row.payOldBuyerCount, row.payOldBuyerCountRows),
        oldBuyerPayAmount: metric(row.oldBuyerPayAmount, row.oldBuyerPayAmountRows),
        juHuaSuanPayAmount: metric(row.juHuaSuanPayAmount, row.juHuaSuanPayAmountRows),
        visitorValue: metric(row.visitorValue, row.visitorValueRows), competitionScore: metric(row.competitionScore, row.competitionScoreRows),
        annualPayAmount: metric(row.annualPayAmount, row.annualPayAmountRows),
        monthlyPayAmount: metric(row.monthlyPayAmount, row.monthlyPayAmountRows),
        monthlyPayQuantity: metric(row.monthlyPayQuantity, row.monthlyPayQuantityRows),
        searchPayConversionRate: metric(row.searchPayConversionRate, row.searchPayConversionRateRows),
        searchVisitorCount: metric(row.searchVisitorCount, row.searchVisitorCountRows),
        searchPayBuyerCount: metric(row.searchPayBuyerCount, row.searchPayBuyerCountRows),
        structuredDetailConversionRate: metric(row.structuredDetailConversionRate, row.structuredDetailConversionRateRows),
        structuredDetailTransactionShare: metric(row.structuredDetailTransactionShare, row.structuredDetailTransactionShareRows) },
      growthStatus: analysis.comparable ? resolveConnectionGrowthDirection(analysis) : "no_data", growthRate: analysis.salesGrowth ?? null,
      hasBusinessProfile: Boolean(row.connectionProfileId),
    };
  });
  if (text(options.growthStatus)) items = items.filter((item) => item.growthStatus === text(options.growthStatus));
  items.sort((left, right) => compareNullable(sortValue(left, options.sortField), sortValue(right, options.sortField), options.sortDirection)
    || left.id.localeCompare(right.id));
  const total = items.length;
  items = items.slice((options.page - 1) * options.pageSize, options.page * options.pageSize);
  const optionScope = includeHistorical ? "1=1" : operatingScope.predicate;
  const optionWhere = options.scope === "mine" ? `WHERE ${optionScope} AND c.ownerId=@scopeOwnerId` : `WHERE ${optionScope}`;
  const optionRows = database.prepare(`SELECT DISTINCT sh.id shopId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName
    FROM sales_links l JOIN sales_shops sh ON sh.id=l.shopId LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id ${optionWhere}
    ORDER BY sh.platform,shopName,sh.id`).all(params);
  const owners = database.prepare(`SELECT DISTINCT p.id,p.name FROM ${LINK_ASSET_SELECT_SQL} c JOIN persons p ON p.id=c.ownerId
    ${options.scope === "mine" ? "WHERE c.ownerId=@scopeOwnerId" : ""} ORDER BY p.name,p.id`).all(params);
  const sources = {
    erp: database.prepare("SELECT MIN(saleDate) minDate,MAX(saleDate) maxDate FROM connection_sku_sales_daily_facts").get(),
    platform: database.prepare("SELECT MIN(substr(periodStart,1,10)) minDate,MAX(substr(periodEnd,1,10)) maxDate FROM connection_period_snapshots").get(),
  };
  return { scope: options.scope, range: ranges.selected, fields: options.fields, items,
    operatingSummary: getLinkOperatingSummary({ database }),
    pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) },
    sort: { field: options.sortField, direction: options.sortDirection }, dataSources: sources,
    filterOptions: { platforms: [...new Set(optionRows.map((item) => item.platform).filter(Boolean))],
      shops: optionRows.map((item) => ({ id: item.shopId, name: item.shopName, platform: item.platform })), owners },
  };
}
