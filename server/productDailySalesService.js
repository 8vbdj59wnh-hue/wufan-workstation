import { getDatabase } from "./db.js";
import { queryDailySalesSummary, queryDailySalesTrend } from "./capabilities/queryDailySales.js";

const clean = (value) => String(value ?? "").trim();
const placeholders = (values) => values.map(() => "?").join(",");

function normalizeRange(input = {}) {
  const endDate = clean(input.endDate) || new Date().toISOString().slice(0, 10);
  const startDate = clean(input.startDate) || (() => { const date = new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 29); return date.toISOString().slice(0, 10); })();
  return { startDate, endDate };
}

export function getProductDailySalesPerformance(input = {}, options = {}) {
  const productId = clean(input.productId);
  if (!productId) throw new Error("产品不能为空。");
  const database = options.database || getDatabase();
  if (!database.prepare("SELECT 1 FROM products WHERE id=?").get(productId)) throw new Error("产品不存在。");
  const range = normalizeRange(input);
  const summary = queryDailySalesSummary({ dimension: "product", targetId: productId, includeSalesLinkBreakdown: true, ...range }, { database });
  const trend = queryDailySalesTrend({ dimension: "product", targetId: productId, ...range }, { database });
  const salesLinkIds = summary.salesLinkBreakdown.map((item) => item.salesLinkId);
  const links = salesLinkIds.length
    ? database.prepare(`SELECT l.id,l.title,l.platformGoodsId,s.platform,s.displayName,s.shopName
      FROM sales_links l JOIN sales_shops s ON s.id=l.shopId WHERE l.id IN (${placeholders(salesLinkIds)})`).all(...salesLinkIds)
    : [];
  const linksById = new Map(links.map((item) => [item.id, item]));
  const contributions = summary.salesLinkBreakdown.map((item) => {
    const link = linksById.get(item.salesLinkId);
    return { ...item, linkName: link?.title || link?.platformGoodsId || "未命名链接", platform: link?.platform || null, shopName: link?.displayName || link?.shopName || null };
  });
  const profitMargin = summary.hasData && summary.salesAmount !== 0 ? summary.profitAmount / summary.salesAmount : summary.hasData && summary.salesAmount === 0 ? 0 : null;
  return { productId, range, summary: { ...summary, salesLinkBreakdown: undefined, profitMargin }, trend, contributions };
}

export default getProductDailySalesPerformance;
