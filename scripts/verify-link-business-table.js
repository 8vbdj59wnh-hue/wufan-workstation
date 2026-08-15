import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

if (!process.env.WUFAN_DB_PATH) throw new Error("请通过 WUFAN_DB_PATH 指定隔离数据库。");

const [{ LINK_BUSINESS_FIELDS, queryLinkBusinessTable }, { getDatabase }, { LINK_BUSINESS_COLUMNS }] = await Promise.all([
  import("../server/linkBusinessTableService.js"), import("../server/db.js"), import("../src/uiModules/linkBusinessTable.js"),
]);

const platformImportFields = ["url", "category", "platformStatus", "periodStart", "periodEnd", "statisticsDate", "productType",
  "productStatus", "productTags", "payAmount", "payQuantity", "payBuyerCount", "refundAmount", "viewCount", "visitorCount",
  "clickCount", "averageStayDuration", "bounceRate", "favoriteCount", "cartCount", "cartBuyerCount", "orderBuyerCount",
  "orderQuantity", "orderAmount", "orderConversionRate", "conversionRate", "payNewBuyerCount", "payOldBuyerCount",
  "oldBuyerPayAmount", "juHuaSuanPayAmount", "visitorValue", "competitionScore", "annualPayAmount", "monthlyPayAmount",
  "monthlyPayQuantity", "searchPayConversionRate", "searchVisitorCount", "searchPayBuyerCount",
  "structuredDetailConversionRate", "structuredDetailTransactionShare"];
assert.ok(platformImportFields.every((field) => LINK_BUSINESS_FIELDS.has(field)));
assert.ok(LINK_BUSINESS_COLUMNS.every((column) => LINK_BUSINESS_FIELDS.has(column.key)));

const database = getDatabase();
const before = {
  profiles: database.prepare("SELECT COUNT(*) count FROM connection_profiles").get().count,
  links: database.prepare("SELECT COUNT(*) count FROM sales_links").get().count,
  facts: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_facts").get().count,
  snapshots: database.prepare("SELECT COUNT(*) count FROM connection_period_snapshots").get().count,
};
const base = { scope: "company", preset: "custom", startDate: "2026-08-01", endDate: "2026-08-02", page: 1, pageSize: 50 };
const started = performance.now();
const sales = queryLinkBusinessTable({ ...base, sortField: "salesAmount", sortDirection: "desc" }, "admin", true);
const elapsedMs = performance.now() - started;
assert.equal(sales.pagination.total, before.profiles);
assert.ok(sales.items.length <= 50);
assert.ok(sales.items.some((item) => item.erp.salesAmount.hasData));
assert.ok(sales.items.every((item, index, rows) => index === 0 || rows[index - 1].erp.salesAmount.noData
  || item.erp.salesAmount.noData || rows[index - 1].erp.salesAmount.value >= item.erp.salesAmount.value));

const noData = queryLinkBusinessTable({ ...base, sortField: "salesAmount", sortDirection: "asc", page: Math.ceil(before.profiles / 50) }, "admin", true);
assert.ok(noData.items.some((item) => item.erp.salesAmount.noData));
assert.ok(noData.items.filter((item) => item.erp.salesAmount.noData).every((item) => item.erp.salesAmount.value === null));

const profit = queryLinkBusinessTable({ ...base, minProfit: "0.01", sortField: "profitAmount", sortDirection: "desc" }, "admin", true);
assert.ok(profit.items.every((item) => item.erp.profitAmount.hasData && item.erp.profitAmount.value >= 0.01));

const platform = queryLinkBusinessTable({ scope: "company", preset: "30d", page: 1, pageSize: 50,
  sortField: "conversionRate", sortDirection: "desc" }, "admin", true);
assert.ok(platform.items.length > 0);
assert.ok(Array.isArray(platform.filterOptions.platforms));
assert.ok(platform.items.every((item) => platformImportFields.filter((field) => !["url", "category", "platformStatus", "periodStart", "periodEnd"].includes(field))
  .every((field) => Object.hasOwn(item.platformMetrics, field))));

const rawPlatform = queryLinkBusinessTable({ scope: "company", preset: "custom", startDate: "2026-06-02", endDate: "2026-07-01",
  page: 1, pageSize: 20, sortField: "orderAmount", sortDirection: "desc" }, "admin", true);
const rawPlatformItem = rawPlatform.items.find((item) => item.platformMetrics.orderAmount.hasData);
assert.ok(rawPlatformItem);
assert.ok(rawPlatformItem.platformMetrics.statisticsDate);
assert.ok(rawPlatformItem.platformMetrics.productType);
for (const field of ["averageStayDuration", "bounceRate", "orderQuantity", "orderAmount", "orderConversionRate", "visitorValue",
  "searchPayConversionRate", "searchVisitorCount", "searchPayBuyerCount"]) assert.equal(rawPlatformItem.platformMetrics[field].hasData, true);

const owner = database.prepare("SELECT ownerId FROM connection_profiles WHERE ownerId IS NOT NULL AND ownerId<>'' LIMIT 1").get()?.ownerId;
if (owner) {
  const mine = queryLinkBusinessTable({ ...base, scope: "mine" }, owner, false);
  assert.ok(mine.items.every((item) => item.ownerId === owner));
}
assert.throws(() => queryLinkBusinessTable({ ...base, scope: "company" }, owner || "user", false), (error) => error.statusCode === 403);

for (const field of ["profitAmount", "profitMargin", "quantity", "payAmount", "refundAmount", "clickCount", "averageStayDuration",
  "bounceRate", "orderBuyerCount", "orderQuantity", "orderAmount", "orderConversionRate", "conversionRate", "visitorValue",
  "competitionScore", "searchPayConversionRate", "searchVisitorCount", "periodStart", "periodEnd", "growthStatus", "healthStatus"]) {
  const sorted = queryLinkBusinessTable({ ...base, sortField: field, sortDirection: "desc", pageSize: 20 }, "admin", true);
  assert.equal(sorted.sort.field, field);
  assert.ok(sorted.items.length <= 20);
}

const after = {
  profiles: database.prepare("SELECT COUNT(*) count FROM connection_profiles").get().count,
  links: database.prepare("SELECT COUNT(*) count FROM sales_links").get().count,
  facts: database.prepare("SELECT COUNT(*) count FROM connection_sku_sales_facts").get().count,
  snapshots: database.prepare("SELECT COUNT(*) count FROM connection_period_snapshots").get().count,
};
assert.deepEqual(after, before);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({ ok: true, elapsedMs: Number(elapsedMs.toFixed(2)), pagination: sales.pagination,
  sourceDates: sales.dataSources, counts: before, mineChecked: Boolean(owner), businessFieldCount: LINK_BUSINESS_FIELDS.size }, null, 2));
