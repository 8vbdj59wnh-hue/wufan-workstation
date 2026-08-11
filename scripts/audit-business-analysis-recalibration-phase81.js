import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((value) => { const [key, ...rest] = value.split("="); return [key.replace(/^--/, ""), rest.join("=")]; }));
const project = path.resolve(args.project || ".");
const databasePath = path.resolve(args.database || "");
assert(fs.existsSync(databasePath), "数据库不存在。");
process.env.WUFAN_DB_PATH = databasePath;
const load = (relative) => import(pathToFileURL(path.join(project, relative)).href);
const { getDatabase, closeDatabase } = await load("server/db.js");
const { queryDailySalesSummary, queryDailySalesTrend, queryDailySalesBySku } = await load("server/capabilities/queryDailySales.js");
const { getProductDailySalesPerformance } = await load("server/productDailySalesService.js");
const { getSalesBusinessDashboard } = await load("server/salesBusinessDashboardService.js");
const { queryBusinessAnomalies } = await load("server/capabilities/queryBusinessAnomalies.js");
const { querySalesDailyDataQuality } = await load("server/salesDailyDataQualityService.js");

const round = (value) => Number(Number(value || 0).toFixed(4));
const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const db = getDatabase();
try {
  const facts = db.prepare(`SELECT COUNT(*) rows,COUNT(DISTINCT salesLinkId) salesLinks,COUNT(DISTINCT salesLinkSkuId) salesLinkSkus,
    COUNT(DISTINCT erpSkuId) erpSkus,MIN(saleDate) dateStart,MAX(saleDate) dateEnd,SUM(quantity) quantity,
    SUM(salesAmount) salesAmount,SUM(costAmount) costAmount,SUM(profitAmount) profitAmount FROM connection_sku_sales_daily_facts`).get();
  Object.assign(facts, { quantity: round(facts.quantity), salesAmount: round(facts.salesAmount), costAmount: round(facts.costAmount), profitAmount: round(facts.profitAmount) });
  const fullSummary = queryDailySalesSummary({ dimension: "company", targetId: "", startDate: facts.dateStart, endDate: facts.dateEnd }, { database: db });
  const fullTrend = queryDailySalesTrend({ dimension: "company", targetId: "", startDate: facts.dateStart, endDate: facts.dateEnd }, { database: db });
  assert.equal(fullSummary.dataCount, facts.rows);
  assert.equal(round(fullSummary.salesAmount), facts.salesAmount);
  assert.equal(round(fullSummary.profitAmount), facts.profitAmount);

  const topLink = db.prepare(`SELECT salesLinkId,SUM(salesAmount) salesAmount FROM connection_sku_sales_daily_facts GROUP BY salesLinkId ORDER BY salesAmount DESC LIMIT 1`).get();
  const linkSummary = queryDailySalesSummary({ dimension: "salesLink", targetId: topLink.salesLinkId, startDate: facts.dateStart, endDate: facts.dateEnd }, { database: db });
  const linkBySku = queryDailySalesBySku({ salesLinkId: topLink.salesLinkId, startDate: facts.dateStart, endDate: facts.dateEnd }, { database: db });
  const linkSkuTotals = linkBySku.items.reduce((total, item) => ({ quantity: total.quantity + item.quantity, salesAmount: total.salesAmount + item.salesAmount, profitAmount: total.profitAmount + item.profitAmount }), { quantity: 0, salesAmount: 0, profitAmount: 0 });
  assert.equal(round(linkSkuTotals.salesAmount), round(linkSummary.salesAmount));
  assert.equal(round(linkSkuTotals.profitAmount), round(linkSummary.profitAmount));
  const combo = db.prepare(`SELECT COUNT(*) rows,COUNT(DISTINCT salesLinkId) salesLinks,COUNT(DISTINCT salesLinkSkuId) salesLinkSkus,
    COUNT(DISTINCT erpSkuId) erpSkus,SUM(quantity) quantity,SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts WHERE factType='combo_component'`).get();
  Object.assign(combo, { quantity: round(combo.quantity), salesAmount: round(combo.salesAmount), profitAmount: round(combo.profitAmount) });

  const productCoverage = db.prepare(`SELECT COUNT(*) factRows,COUNT(DISTINCT pem.productId) products,SUM(f.quantity) quantity,
    SUM(f.salesAmount) salesAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active'`).get();
  Object.assign(productCoverage, { quantity: round(productCoverage.quantity), salesAmount: round(productCoverage.salesAmount), profitAmount: round(productCoverage.profitAmount) });
  const unmappedProductFacts = db.prepare(`SELECT COUNT(*) rows,COUNT(DISTINCT f.erpSkuId) erpSkus,SUM(f.salesAmount) salesAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f LEFT JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active' WHERE pem.id IS NULL`).get();
  Object.assign(unmappedProductFacts, { salesAmount: round(unmappedProductFacts.salesAmount), profitAmount: round(unmappedProductFacts.profitAmount) });
  const comboProduct = db.prepare(`SELECT COUNT(*) rows,COUNT(DISTINCT pem.productId) products,SUM(f.salesAmount) salesAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f LEFT JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active' WHERE f.factType='combo_component'`).get();
  Object.assign(comboProduct, { salesAmount: round(comboProduct.salesAmount), profitAmount: round(comboProduct.profitAmount) });
  const topProduct = db.prepare(`SELECT pem.productId,SUM(f.salesAmount) salesAmount FROM connection_sku_sales_daily_facts f
    JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active' GROUP BY pem.productId ORDER BY salesAmount DESC LIMIT 1`).get();
  const productView = getProductDailySalesPerformance({ productId: topProduct.productId, startDate: facts.dateStart, endDate: facts.dateEnd }, { database: db });
  const contributionTotals = productView.contributions.reduce((total, item) => ({ salesAmount: total.salesAmount + item.salesAmount, profitAmount: total.profitAmount + item.profitAmount }), { salesAmount: 0, profitAmount: 0 });
  assert.equal(round(contributionTotals.salesAmount), round(productView.summary.salesAmount));
  assert.equal(round(contributionTotals.profitAmount), round(productView.summary.profitAmount));

  const dashboards = Object.fromEntries(["7d", "30d"].map((preset) => {
    const value = getSalesBusinessDashboard({ preset }, { database: db });
    return [preset, {
      startDate: value.startDate, endDate: value.endDate, salesAmount: round(value.summary.salesAmount), profitAmount: round(value.summary.profitAmount),
      quantity: round(value.summary.quantity), profitMargin: value.summary.profitMargin, dataDays: value.summary.coverage.dataDays,
      noDataDays: value.trend.items.filter((item) => item.noData).length, productRankingCount: value.products.items.length,
      linkRankingCount: value.links.items.length, topProduct: value.products.items[0] || null, topLink: value.links.items[0] || null,
    }];
  }));
  const anomalies = queryBusinessAnomalies({}, { database: db });
  const anomalyTypes = Object.fromEntries(["sales_drop", "profit_drop", "sales_gap", "data_quality_issue"].map((type) => [type, anomalies.items.filter((item) => item.anomalyType === type).length]));
  const quality = querySalesDailyDataQuality({ database: db });
  const persistedRowNumbers = new Set(db.prepare("SELECT sourceRowNumber FROM connection_sku_sales_daily_facts WHERE sourceBatchId=?").all(quality.batch.id).map((row) => row.sourceRowNumber));
  const actualUnwrittenRows = db.prepare("SELECT rowNumber,normalizedDataJson FROM connection_import_rows WHERE batchId=? AND status<>'excluded'").all(quality.batch.id)
    .filter((row) => !persistedRowNumbers.has(row.rowNumber));
  const actualUnwritten = actualUnwrittenRows.reduce((result, row) => {
    const data = JSON.parse(row.normalizedDataJson || "{}"); result.rows += 1; result.salesAmount += Number(data.salesAmount || 0); return result;
  }, { rows: 0, salesAmount: 0 });
  const protectedCounts = {
    facts: facts.rows,
    activeMappings: db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total,
    structures: db.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures").get().total,
    structureComponents: db.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structure_components").get().total,
    erpSkus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
  };
  console.log(JSON.stringify({
    facts,
    company: { summary: { quantity: fullSummary.quantity, salesAmount: round(fullSummary.salesAmount), profitAmount: round(fullSummary.profitAmount), dataCount: fullSummary.dataCount, source: fullSummary.source }, trend: { days: fullTrend.items.length, dataDays: fullTrend.coverage.dataDays, noDataDays: fullTrend.items.filter((item) => item.noData).length } },
    linkCenter: { topLinkId: topLink.salesLinkId, summary: { quantity: linkSummary.quantity, salesAmount: round(linkSummary.salesAmount), profitAmount: round(linkSummary.profitAmount) }, skuItems: linkBySku.items.length, skuTotals: { quantity: round(linkSkuTotals.quantity), salesAmount: round(linkSkuTotals.salesAmount), profitAmount: round(linkSkuTotals.profitAmount) }, combo },
    productCenter: { mapped: productCoverage, unmapped: unmappedProductFacts, combo: comboProduct, topProductId: topProduct.productId, topProductSummary: { quantity: productView.summary.quantity, salesAmount: round(productView.summary.salesAmount), profitAmount: round(productView.summary.profitAmount) }, contributionCount: productView.contributions.length, contributionTotals: { salesAmount: round(contributionTotals.salesAmount), profitAmount: round(contributionTotals.profitAmount) } },
    dashboards,
    anomalies: { summary: anomalies.summary, types: anomalyTypes, periods: anomalies.periods },
    quality: { health: quality.health, coverage: quality.coverage, amounts: quality.amounts, governance: quality.governance, actualUnwritten: { rows: actualUnwritten.rows, salesAmount: round(actualUnwritten.salesAmount) } },
    protectedCounts,
    integrityCheck: db.pragma("integrity_check", { simple: true }),
    foreignKeyErrors: db.pragma("foreign_key_check").length,
  }, null, 2));
} finally { closeDatabase(); }
