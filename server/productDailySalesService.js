import { getDatabase } from "./db.js";
import { queryDailySalesSummary, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { queryProductContribution } from "./productContributionReadModel.js";

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
  const contributionResult = queryProductContribution(productId, { periodStart: range.startDate, periodEnd: range.endDate }, { database });
  const contribution = contributionResult.item;
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
  const directProfitMargin = contribution.directSalesAmount !== null && contribution.directSalesAmount !== 0
    ? Number(contribution.directProfit || 0) / Number(contribution.directSalesAmount) : contribution.directSalesAmount === 0 ? 0 : null;
  const dailyContribution = new Map(contributionResult.dailyItems.filter((item) => item.productId === productId).map((item) => [item.date, item]));
  const physicalTrend = { ...trend, contractVersion: "product-contribution-v1", items: trend.items.map((item) => {
    const metric = dailyContribution.get(item.date);
    return { date: item.date, noData: !metric || metric.totalPhysicalContribution === null,
      directSalesQuantity: metric?.directSalesQuantity ?? null, bundleContributionQuantity: metric?.bundleContributionQuantity ?? null,
      totalPhysicalContribution: metric?.totalPhysicalContribution ?? null, directSalesAmount: metric?.directSalesAmount ?? null,
      directProfit: metric?.directProfit ?? null, bomEvidenceLevel: metric?.bomEvidenceLevel ?? null };
  }) };
  return {
    productId, range,
    summary: { ...summary, salesLinkBreakdown: undefined, profitMargin, legacy: { quantity: summary.quantity, salesAmount: summary.salesAmount, costAmount: summary.costAmount, profitAmount: summary.profitAmount, profitMargin },
      directSalesQuantity: contribution.directSalesQuantity, bundleContributionQuantity: contribution.bundleContributionQuantity,
      totalPhysicalContribution: contribution.totalPhysicalContribution, directSalesAmount: contribution.directSalesAmount,
      directCost: contribution.directCost, directProfit: contribution.directProfit, directProfitMargin,
      bundleParticipationCount: contribution.bundleParticipationCount, contributingBundleCount: contribution.contributingBundleCount,
      bomEvidenceLevel: contribution.bomEvidenceLevel, bomEvidence: contribution.bomEvidence,
      economicAllocation: "single_direct_only", hasContributionData: contribution.totalPhysicalContribution !== null },
    trend, physicalTrend, contributions, directLinks: contribution.directLinks,
    bundleParticipations: contribution.contributingBundles,
    unallocatedContribution: contributionResult.unallocatedContribution,
    definitions: contributionResult.definitions,
  };
}

export default getProductDailySalesPerformance;
