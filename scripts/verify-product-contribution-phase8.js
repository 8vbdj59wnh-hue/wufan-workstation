import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { queryProductContribution, queryProductContributions } from "../server/productContributionReadModel.js";
import { getSalesBusinessDashboard } from "../server/salesBusinessDashboardService.js";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("请提供隔离数据库路径。");
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
database.pragma("query_only = ON");

const baseline = () => database.prepare(`SELECT COUNT(*) factCount,MIN(saleDate) periodStart,MAX(saleDate) periodEnd,
  SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
  FROM connection_sku_sales_daily_facts`).get();
const before = baseline();

const startedAt = performance.now();
const first = queryProductContributions({ periodStart: before.periodStart, periodEnd: before.periodEnd }, { database });
const firstMs = performance.now() - startedAt;
const repeatedAt = performance.now();
const second = queryProductContributions({ periodStart: before.periodStart, periodEnd: before.periodEnd }, { database });
const secondMs = performance.now() - repeatedAt;
const after = baseline();

assert.deepEqual(after, before, "读模型不得改变Daily Facts");
assert.deepEqual(second, first, "重复计算必须幂等");
assert.equal(first.companyFacts.factCount, Number(before.factCount));
for (const field of ["salesAmount", "costAmount", "profitAmount"])
  assert.ok(Math.abs(Number(first.companyFacts[field]) - Number(before[field])) < 0.000001, `${field}必须与原始公司事实一致`);

const items = first.items.filter((item) => item.totalPhysicalContribution !== null);
const bundleFacts = database.prepare(`SELECT COUNT(*) count FROM connection_sku_sales_daily_facts f
  JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=f.salesLinkSkuId AND r.status='active'
  JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active' WHERE o.objectType='bundle'`).get().count;
const evidence = items.reduce((total, item) => {
  for (const [key, value] of Object.entries(item.bomEvidence)) total[key] = (total[key] || 0) + Number(value || 0);
  return total;
}, {});
const totals = {
  productsWithDirectSales: items.filter((item) => Number(item.directSalesQuantity || 0) !== 0).length,
  productsWithBundleContribution: items.filter((item) => Number(item.bundleContributionQuantity || 0) !== 0).length,
  productsWithBoth: items.filter((item) => Number(item.directSalesQuantity || 0) !== 0 && Number(item.bundleContributionQuantity || 0) !== 0).length,
  productsBundleOnly: items.filter((item) => !Number(item.directSalesQuantity || 0) && Number(item.bundleContributionQuantity || 0) !== 0).length,
  totalDirectSalesQuantity: items.reduce((sum, item) => sum + Number(item.directSalesQuantity || 0), 0),
  totalBundleContributionQuantity: items.reduce((sum, item) => sum + Number(item.bundleContributionQuantity || 0), 0),
  totalPhysicalContribution: items.reduce((sum, item) => sum + Number(item.totalPhysicalContribution || 0), 0),
  unallocatedContribution: first.unallocatedContribution.contributionQuantity,
  bundleSalesFacts: Number(bundleFacts),
  bomExplainableFacts: Number(bundleFacts) - Number(first.unallocatedContribution.structureUnknownFactCount),
};
const detailProductId = items.find((item) => Number(item.directSalesQuantity || 0) && Number(item.bundleContributionQuantity || 0))?.productId;
const detailStartedAt = performance.now();
const detailResult = detailProductId ? queryProductContribution(detailProductId, { periodStart: before.periodStart, periodEnd: before.periodEnd }, { database }) : null;
const detailMs = performance.now() - detailStartedAt;
const dashboard = getSalesBusinessDashboard({ preset: "30d" }, { database });
assert.ok(dashboard.products.items.every((item) => item.metricContract === "product-contribution-v1" && item.bundleAllocation === "none"));

const sampleSql = ({ type, shape = "" }) => database.prepare(`WITH component_shape AS (
  SELECT s.salesObjectId,COUNT(*) componentRows,COUNT(DISTINCT c.erpSkuId) distinctComponents,SUM(c.quantity) componentQuantity
  FROM sales_object_structures s JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
  WHERE s.status='active' GROUP BY s.salesObjectId
)
SELECT f.id factId,f.saleDate,f.quantity salesQuantity,o.objectCode,o.objectType,c.erpSkuId,c.quantity componentQuantity,
  p.id productId,p.name productName,(f.quantity*c.quantity) contributionQuantity
FROM connection_sku_sales_daily_facts f
JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=f.salesLinkSkuId AND r.status='active'
JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active'
JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active'
JOIN products p ON p.id=pm.productId
JOIN component_shape shape ON shape.salesObjectId=o.id
WHERE o.objectType=? ${shape}
ORDER BY f.saleDate,f.id,c.sortOrder LIMIT 200`).all(type);
const firstDistinct = (rows, limit) => {
  const seen = new Set(); const result = [];
  for (const row of rows) { const key = `${row.factId}|${row.productId}`; if (seen.has(key)) continue; seen.add(key); result.push(row); if (result.length >= limit) break; }
  return result;
};
const samples = {
  single: firstDistinct(sampleSql({ type: "single" }), 20),
  singleComponentMultiple: firstDistinct(sampleSql({ type: "bundle", shape: "AND shape.distinctComponents=1 AND shape.componentQuantity>1" }), 20),
  multiComponentBundle: firstDistinct(sampleSql({ type: "bundle", shape: "AND shape.distinctComponents>1" }), 20),
  directAndBundleProducts: items.filter((item) => Number(item.directSalesQuantity || 0) !== 0 && Number(item.bundleContributionQuantity || 0) !== 0).slice(0, 10)
    .map((item) => ({ productId: item.productId, directSalesQuantity: item.directSalesQuantity, bundleContributionQuantity: item.bundleContributionQuantity, totalPhysicalContribution: item.totalPhysicalContribution, contributingBundleCount: item.contributingBundleCount, bomEvidenceLevel: item.bomEvidenceLevel })),
};

const result = {
  databasePath, period: { start: before.periodStart, end: before.periodEnd },
  companyFacts: { before, readModel: first.companyFacts, after, unchanged: true },
  totals, evidence, unallocated: first.unallocatedContribution,
  samples, performance: { fullPeriodFirstRunMs: Number(firstMs.toFixed(3)), fullPeriodRepeatedRunMs: Number(secondMs.toFixed(3)), productDetailMs: Number(detailMs.toFixed(3)), detailProductId, detailFactCount: detailResult?.companyFacts?.factCount ?? 0 },
  dashboard: { productRankingContract: dashboard.products.contractVersion, productItems: dashboard.products.items.length, bundleAllocation: "none" },
  integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyViolations: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify(result, null, 2));
database.close();
