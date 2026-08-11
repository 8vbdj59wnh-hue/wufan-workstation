import { getDatabase } from "./db.js";

const allowedScopes = new Set(["mine", "company"]);

function text(value) { return String(value ?? "").trim(); }

function dateOnly(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error("日期格式必须为 YYYY-MM-DD。");
  }
  return normalized;
}

function defaultRange(days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function resolveLinkSalesRankingRange(input = {}) {
  const preset = text(input.preset || "7d");
  if (preset === "7d") return { preset, ...defaultRange(7) };
  if (preset === "30d") return { preset, ...defaultRange(30) };
  if (preset !== "custom") throw new Error("销售排行时间范围无效。");
  const startDate = dateOnly(input.startDate);
  const endDate = dateOnly(input.endDate);
  if (startDate > endDate) throw new Error("开始日期不能晚于结束日期。");
  return { preset, startDate, endDate };
}

export function resolveLinkSalesDateRanges(input = {}) {
  const selected = resolveLinkSalesRankingRange(input);
  return {
    yesterday: defaultRange(1),
    sevenDays: defaultRange(7),
    thirtyDays: defaultRange(30),
    selected,
  };
}

export function getLinkSalesRanking(input = {}, userId = "", isAdmin = false) {
  const scope = text(input.scope || "mine");
  if (!allowedScopes.has(scope)) throw new Error("销售排行范围无效。");
  if (scope === "company" && !isAdmin) {
    const error = new Error("只有管理员可以查看公司全部链接排行。");
    error.statusCode = 403;
    throw error;
  }
  const personId = text(userId);
  if (scope === "mine" && !personId) throw new Error("无法识别当前登录人员。");
  const range = resolveLinkSalesRankingRange(input);
  const params = [range.startDate, range.endDate];
  const ownerWhere = scope === "mine" ? "AND c.ownerId=?" : "";
  if (scope === "mine") params.push(personId);
  const rows = getDatabase().prepare(`
    SELECT c.id AS connectionId,c.salesLinkId,c.name,c.mainImage,c.ownerId,
      p.name AS ownerName,l.platformGoodsId,l.canonicalUrl,
      s.platform,s.id AS shopId,COALESCE(s.displayName,s.shopName) AS shopName,
      SUM(COALESCE(f.salesAmount,0)) AS salesAmount,
      SUM(COALESCE(f.quantity,0)) AS quantity,
      COUNT(DISTINCT f.id) AS factCount,
      MIN(f.saleDate) AS firstDataDate,
      MAX(f.saleDate) AS lastDataDate
    FROM connection_profiles c
    JOIN sales_links l ON l.id=c.salesLinkId
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId
    JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=c.salesLinkId
    WHERE f.saleDate BETWEEN ? AND ?
      ${ownerWhere}
    GROUP BY c.id,c.salesLinkId,c.name,c.mainImage,c.ownerId,p.name,l.platformGoodsId,l.canonicalUrl,s.platform,s.id,s.displayName,s.shopName
    ORDER BY salesAmount DESC,c.id ASC
  `).all(...params).map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    scope,
    range,
    items: rows,
    summary: {
      linkCount: rows.length,
      salesAmount: rows.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
      quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      hasData: rows.length > 0,
    },
  };
}
