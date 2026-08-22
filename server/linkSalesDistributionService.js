import { getDatabase } from "./db.js";
import { resolveLinkSalesRankingRange } from "./linkSalesRankingService.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";
import { latestCompleteSalesDate } from "./connectionCockpitDateRange.js";

const scopes = new Set(["mine", "company"]);
const text = (value) => String(value ?? "").trim();

export function getLinkSalesDistribution(input = {}, userId = "", isAdmin = false) {
  const scope = text(input.scope || "company");
  if (!scopes.has(scope)) throw new Error("销售分布范围无效。");
  if (scope === "company" && !isAdmin) {
    const error = new Error("只有管理员可以查看公司全部链接销售分布。");
    error.statusCode = 403;
    throw error;
  }
  const ownerId = text(userId);
  if (scope === "mine" && !ownerId) throw new Error("无法识别当前登录人员。");
  const database = getDatabase();
  const range = resolveLinkSalesRankingRange(input, latestCompleteSalesDate(database));
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "linkDistributionOperating" });
  const ownerWhere = scope === "mine" ? "AND c.ownerId=@ownerId" : "";
  const rows = database.prepare(`
    WITH selected_sales AS (
      SELECT salesLinkId,SUM(COALESCE(salesAmount,0)) salesAmount,COUNT(id) factCount
      FROM connection_sku_sales_daily_facts
      WHERE saleDate BETWEEN @startDate AND @endDate
      GROUP BY salesLinkId
    )
    SELECT l.id linkId,COALESCE(NULLIF(c.name,''),NULLIF(l.title,''),l.platformGoodsId) linkName,
      c.mainImage,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName,selected_sales.salesAmount,
      COALESCE(selected_sales.factCount,0) factCount
    FROM sales_links l
    JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    LEFT JOIN selected_sales ON selected_sales.salesLinkId=l.id
    WHERE ${operatingScope.predicate} ${ownerWhere}
    ORDER BY CASE WHEN selected_sales.factCount IS NULL THEN 1 ELSE 0 END,
      selected_sales.salesAmount DESC,l.id ASC
  `).all({ ...operatingScope.params, startDate: range.startDate, endDate: range.endDate, ownerId });
  const totalSalesAmount = rows.reduce((sum, row) => sum + (Number(row.factCount) > 0 ? Number(row.salesAmount || 0) : 0), 0);
  const items = rows.map((row, index) => {
    const hasData = Number(row.factCount) > 0;
    const salesAmount = hasData ? Number(row.salesAmount || 0) : null;
    return {
      linkId: row.linkId, linkName: row.linkName, mainImage: row.mainImage || "",
      platform: row.platform || "", shopName: row.shopName || "", salesAmount,
      salesPercentage: hasData && totalSalesAmount > 0 ? salesAmount / totalSalesAmount : (hasData ? 0 : null),
      rank: index + 1, groupIndex: Math.floor(index / 100) + 1, hasData, noData: !hasData,
    };
  });
  const linksWithData = items.filter((item) => item.hasData).length;
  return { scope, range, items, summary: { totalLinks: items.length, linksWithData,
    linksWithoutData: items.length - linksWithData, totalSalesAmount,
    groupCount: Math.ceil(items.length / 100), hasData: linksWithData > 0, noData: linksWithData === 0 } };
}
