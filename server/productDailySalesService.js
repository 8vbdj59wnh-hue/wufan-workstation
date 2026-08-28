import { getDatabase } from "./db.js";
import { queryDailySalesSummary, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { queryErpSkuContribution } from "./productContributionReadModel.js";

const clean = (value) => String(value ?? "").trim();
const placeholders = (values) => values.map(() => "?").join(",");

function normalizeRange(input = {}) {
  const endDate = clean(input.endDate) || new Date().toISOString().slice(0, 10);
  const startDate = clean(input.startDate) || (() => { const date = new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 29); return date.toISOString().slice(0, 10); })();
  return { startDate, endDate };
}

export function getProductDailySalesPerformance(input = {}, options = {}) {
  const requestedId = clean(input.erpSkuId || input.productId);
  if (!requestedId) throw new Error("ERP SKU不能为空。");
  const database = options.database || getDatabase();
  const erpSkuId = database.prepare("SELECT id FROM erp_skus WHERE id=?").get(requestedId)?.id
    || database.prepare("SELECT erpSkuId FROM product_erp_mappings WHERE productId=? AND currentState='active' ORDER BY updatedAt DESC,id DESC LIMIT 1").get(requestedId)?.erpSkuId;
  if (!erpSkuId) throw new Error("ERP SKU不存在。");
  const productId = database.prepare("SELECT productId FROM product_erp_mappings WHERE erpSkuId=? AND currentState='active' ORDER BY updatedAt DESC,id DESC LIMIT 1").get(erpSkuId)?.productId || null;
  const range = normalizeRange(input);
  const summary = queryDailySalesSummary({ dimension: "erpSku", targetId: erpSkuId, ...range }, { database });
  const trend = queryDailySalesTrend({ dimension: "erpSku", targetId: erpSkuId, ...range }, { database });
  const contributionResult = queryErpSkuContribution(erpSkuId, { periodStart: range.startDate, periodEnd: range.endDate }, { database });
  const contribution = contributionResult.item;
  const salesLinkIds = contribution.directLinks.map((item) => item.salesLinkId);
  const links = salesLinkIds.length
    ? database.prepare(`SELECT l.id,l.title,l.platformGoodsId,s.platform,s.displayName,s.shopName
      FROM sales_links l JOIN sales_shops s ON s.id=l.shopId WHERE l.id IN (${placeholders(salesLinkIds)})`).all(...salesLinkIds)
    : [];
  const linksById = new Map(links.map((item) => [item.id, item]));
  const contributions = contribution.directLinks.map((item) => {
    const link = linksById.get(item.salesLinkId);
    return { ...item, linkName: link?.title || link?.platformGoodsId || "未命名链接", platform: link?.platform || null, shopName: link?.displayName || link?.shopName || null };
  });
  const profitMargin = summary.hasData && summary.salesAmount !== 0 ? summary.profitAmount / summary.salesAmount : summary.hasData && summary.salesAmount === 0 ? 0 : null;
  const directProfitMargin = contribution.directSalesAmount !== null && contribution.directSalesAmount !== 0
    ? Number(contribution.directProfit || 0) / Number(contribution.directSalesAmount) : contribution.directSalesAmount === 0 ? 0 : null;
  const dailyContribution = new Map(contributionResult.dailyItems.filter((item) => item.erpSkuId === erpSkuId).map((item) => [item.date, item]));
  const physicalTrend = { ...trend, contractVersion: "erp-sku-contribution-v2", items: trend.items.map((item) => {
    const metric = dailyContribution.get(item.date);
    return { date: item.date, noData: !metric || metric.totalPhysicalContribution === null,
      directSalesQuantity: metric?.directSalesQuantity ?? null, bundleContributionQuantity: metric?.bundleContributionQuantity ?? null,
      totalPhysicalContribution: metric?.totalPhysicalContribution ?? null, directSalesAmount: metric?.directSalesAmount ?? null,
      directProfit: metric?.directProfit ?? null, bomEvidenceLevel: metric?.bomEvidenceLevel ?? null };
  }) };
  return {
    erpSkuId, productId, range,
    summary: { ...summary, profitMargin, legacy: { quantity: summary.quantity, salesAmount: summary.salesAmount, costAmount: summary.costAmount, profitAmount: summary.profitAmount, profitMargin },
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
