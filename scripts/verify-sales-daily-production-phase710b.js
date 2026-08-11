import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((value) => { const [key, ...rest] = value.split("="); return [key.replace(/^--/, ""), rest.join("=")]; }));
const project = path.resolve(args.project || ".");
const databasePath = path.resolve(args.database || "");
assert(fs.existsSync(databasePath));
process.env.WUFAN_DB_PATH = databasePath;
const load = (relative) => import(pathToFileURL(path.join(project, relative)).href);
const { getDatabase, closeDatabase } = await load("server/db.js");
const { getConnectionDailySalesPerformance } = await load("server/connectionDailySalesService.js");
const { getProductDailySalesPerformance } = await load("server/productDailySalesService.js");
const { getSalesBusinessDashboard } = await load("server/salesBusinessDashboardService.js");
const { commitSalesDailyFacts } = await load("server/salesDailyFactPreviewService.js");

const db = getDatabase();
try {
  const totals = db.prepare(`SELECT COUNT(*) count,ROUND(SUM(salesAmount),4) salesAmount,ROUND(SUM(profitAmount),4) profitAmount,
    MIN(saleDate) dateStart,MAX(saleDate) dateEnd FROM connection_sku_sales_daily_facts`).get();
  assert.ok(totals.count > 0, "生产日报事实不得为空");
  assert.ok(totals.dateStart && totals.dateEnd && totals.dateStart <= totals.dateEnd, "日报事实日期范围无效");
  const connection = db.prepare(`SELECT cp.id FROM connection_profiles cp JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=cp.salesLinkId
    GROUP BY cp.id ORDER BY SUM(f.salesAmount) DESC LIMIT 1`).get();
  const product = db.prepare(`SELECT pem.productId id FROM product_erp_mappings pem JOIN connection_sku_sales_daily_facts f ON f.erpSkuId=pem.erpSkuId
    WHERE pem.currentState='active' GROUP BY pem.productId ORDER BY SUM(f.salesAmount) DESC LIMIT 1`).get();
  assert(connection?.id && product?.id);
  const range = { startDate: totals.dateStart, endDate: totals.dateEnd };
  const linkView = getConnectionDailySalesPerformance({ connectionId: connection.id, ...range }, { database: db });
  const productView = getProductDailySalesPerformance({ productId: product.id, ...range }, { database: db });
  const dashboard = getSalesBusinessDashboard({ preset: "30d" }, { database: db });
  const reviewer = db.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
  const repeatedCommit = args.verifyCommit === "true"
    ? commitSalesDailyFacts("sales-daily-preview-24b80f89-78b6-4cdb-bc2d-6a35fe02607f", { confirmedBy: reviewer.id, database: db }).result
    : null;
  assert.equal(linkView.summary.source, "daily_fact_v1");
  assert.equal(productView.summary.source, "daily_fact_v1");
  assert(dashboard.sources.includes("QueryDailySalesSummary"));
  assert.equal(dashboard.summary.source, "daily_fact_v1");
  const companySummary = db.prepare(`SELECT ROUND(SUM(salesAmount),4) salesAmount,ROUND(SUM(profitAmount),4) profitAmount
    FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?`).get(range.startDate, range.endDate);
  assert.equal(Number(companySummary.salesAmount), Number(totals.salesAmount), "经营查询周期销售额必须与日报事实守恒");
  assert.equal(Number(companySummary.profitAmount), Number(totals.profitAmount), "经营查询周期利润必须与日报事实守恒");
  console.log(JSON.stringify({
    totals,
    linkCenter: { connectionId: connection.id, hasData: linkView.summary.hasData, source: linkView.summary.source, salesAmount: linkView.summary.salesAmount },
    productCenter: { productId: product.id, hasData: productView.summary.hasData, source: productView.summary.source, salesAmount: productView.summary.salesAmount },
    dashboard: { hasData: dashboard.hasData, source: dashboard.summary.source, productRanking: dashboard.products.items.length, linkRanking: dashboard.links.items.length },
    repeatedCommit: repeatedCommit ? { insertedCount: repeatedCommit.insertedCount, skippedCount: repeatedCommit.skippedCount, updatePendingCount: repeatedCommit.updatePendingCount, idempotent: repeatedCommit.idempotent } : null,
    integrityCheck: db.pragma("integrity_check", { simple: true }),
    foreignKeyErrors: db.pragma("foreign_key_check").length,
  }, null, 2));
} finally { closeDatabase(); }
