import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { queryProductContributions } from "../server/productContributionReadModel.js";
import { queryDailySalesSummary, queryDailySalesSummaryComparison, queryDailySalesSummaryRanking, queryDailySalesTrend } from "../server/capabilities/queryDailySales.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,skuCode TEXT);
    CREATE TABLE product_erp_mappings(id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,currentState TEXT,updatedAt TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,saleDate TEXT,salesLinkId TEXT,salesLinkSkuId TEXT,quantity REAL,salesAmount REAL,costAmount REAL,profitAmount REAL);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,objectType TEXT,status TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,status TEXT,validityBasis TEXT,sourceType TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE sales_object_structure_effective_periods(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,validFrom TEXT,validTo TEXT,sourceState TEXT,validityBasis TEXT);
    CREATE TABLE sales_link_sku_product_structures(id TEXT PRIMARY KEY,salesLinkSkuId TEXT,status TEXT);
    CREATE TABLE sales_link_sku_product_structure_components(id TEXT PRIMARY KEY,productStructureId TEXT,erpSkuId TEXT,quantity REAL);
  `);
  for (const [id, erp] of [["product-a","erp-a"],["product-a","erp-c"],["product-b","erp-b"]]) {
    db.prepare("INSERT OR IGNORE INTO products VALUES (?,?,?)").run(id, id, id);
    db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?,?,?)").run(`map-${erp}`, id, erp, "active", "2026");
  }
  const object = (id, code, type, components, linkSku) => {
    db.prepare("INSERT INTO sales_objects VALUES (?,?,?,'active')").run(id, code, type);
    db.prepare("INSERT INTO sales_link_sku_sales_object_relations VALUES (?,?,?,'active')").run(`relation-${id}`, linkSku, id);
    db.prepare("INSERT INTO sales_object_structures VALUES (?,?,1,'active','unknown','combo_master_excel')").run(`structure-${id}`, id);
    components.forEach(([erpSkuId, quantity], index) => db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?,?,'active')").run(`component-${id}-${erpSkuId}`, `structure-${id}`, erpSkuId, quantity, index + 1));
    db.prepare("INSERT INTO sales_link_sku_product_structures VALUES (?,?,'active')").run(`legacy-${id}`, linkSku);
    components.forEach(([erpSkuId, quantity]) => db.prepare("INSERT INTO sales_link_sku_product_structure_components VALUES (?,?,?,?)").run(`legacy-component-${id}-${erpSkuId}`, `legacy-${id}`, erpSkuId, quantity));
  };
  object("single-a", "SINGLE-A", "single", [["erp-a",1]], "link-sku-single");
  object("bundle-n", "BUNDLE-N", "bundle", [["erp-a",3]], "link-sku-bundle-n");
  object("bundle-multi", "BUNDLE-M", "bundle", [["erp-a",1],["erp-b",2],["erp-c",1]], "link-sku-bundle-m");
  object("bundle-missing", "BUNDLE-X", "bundle", [["erp-missing",2]], "link-sku-missing");
  const fact = db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?,?,?,?,?)");
  fact.run("fact-single", "2026-08-01", "link-single", "link-sku-single", 10, 100, 60, 40);
  fact.run("fact-bundle-n", "2026-08-02", "link-bundle-n", "link-sku-bundle-n", 4, 80, 50, 30);
  fact.run("fact-bundle-m", "2026-08-03", "link-bundle-m", "link-sku-bundle-m", 2, 50, 30, 20);
  fact.run("fact-bundle-missing", "2026-08-04", "link-bundle-x", "link-sku-missing", 3, 70, 40, 30);
  return db;
}

test("Product Contribution区分Single经济事实与Bundle物理贡献", () => {
  const db = fixture();
  const before = db.prepare("SELECT COUNT(*) facts,SUM(salesAmount) sales,SUM(costAmount) cost,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get();
  const result = queryProductContributions({ periodStart: "2026-08-01", periodEnd: "2026-08-31" }, { database: db });
  const a = result.items.find((item) => item.productId === "product-a");
  const b = result.items.find((item) => item.productId === "product-b");
  assert.equal(a.directSalesQuantity, 10);
  assert.equal(a.bundleContributionQuantity, 16);
  assert.equal(a.totalPhysicalContribution, 26);
  assert.equal(a.directSalesAmount, 100);
  assert.equal(a.directCost, 60);
  assert.equal(a.directProfit, 40);
  assert.equal(a.contributingBundleCount, 2);
  assert.equal(a.bomEvidenceLevel, "legacy_evidence");
  assert.equal(a.contributingBundles.find((item) => item.bundleCode === "BUNDLE-N").componentQuantity, 3);
  assert.equal(a.contributingBundles.find((item) => item.bundleCode === "BUNDLE-M").componentQuantity, 2);
  assert.equal(b.directSalesQuantity, null);
  assert.equal(b.bundleContributionQuantity, 4);
  assert.equal(b.totalPhysicalContribution, 4);
  assert.equal(b.directSalesAmount, null);
  assert.equal(result.unallocatedContribution.contributionQuantity, 6);
  assert.equal(result.unallocatedContribution.productMappingMissingCount, 1);
  assert.deepEqual(result.companyFacts, { factCount: 4, salesAmount: 300, costAmount: 180, profitAmount: 120 });
  assert.deepEqual(db.prepare("SELECT COUNT(*) facts,SUM(salesAmount) sales,SUM(costAmount) cost,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get(), before);
});

test("Product Contribution重复计算幂等且不拆分Bundle金额", () => {
  const db = fixture();
  const first = queryProductContributions({ periodStart: "2026-08-01", periodEnd: "2026-08-31" }, { database: db });
  const second = queryProductContributions({ periodStart: "2026-08-01", periodEnd: "2026-08-31" }, { database: db });
  assert.deepEqual(second, first);
  const productEconomics = first.items.reduce((total, item) => total + Number(item.directSalesAmount || 0), 0);
  assert.equal(productEconomics, 100);
  assert.equal(first.companyFacts.salesAmount, 300);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, 4);
});

test("Single×N仍是Bundle贡献，不冒充直接销量", () => {
  const result = queryProductContributions({ periodStart: "2026-08-02", periodEnd: "2026-08-02" }, { database: fixture() });
  const item = result.items.find((row) => row.productId === "product-a");
  assert.equal(item.directSalesQuantity, null);
  assert.equal(item.bundleContributionQuantity, 12);
  assert.equal(item.directSalesAmount, null);
  assert.equal(result.companyFacts.salesAmount, 80);
});

test("多组件Bundle按组件数量独立展开", () => {
  const result = queryProductContributions({ periodStart: "2026-08-03", periodEnd: "2026-08-03" }, { database: fixture() });
  assert.equal(result.items.find((row) => row.productId === "product-a").bundleContributionQuantity, 4);
  assert.equal(result.items.find((row) => row.productId === "product-b").bundleContributionQuantity, 4);
});

test("多ERP SKU映射同一Product后合并贡献", () => {
  const item = queryProductContributions({ periodStart: "2026-08-03", periodEnd: "2026-08-03" }, { database: fixture() }).items.find((row) => row.productId === "product-a");
  assert.deepEqual(item.contributingBundles[0].componentErpSkuIds.sort(), ["erp-a", "erp-c"]);
  assert.equal(item.contributingBundles[0].componentQuantity, 2);
  assert.equal(item.contributingBundles[0].contributionQuantity, 4);
});

test("Product Mapping缺失只进未分配贡献，不丢失Bundle事实", () => {
  const result = queryProductContributions({ periodStart: "2026-08-04", periodEnd: "2026-08-04" }, { database: fixture() });
  assert.equal(result.unallocatedContribution.contributionQuantity, 6);
  assert.equal(result.unallocatedContribution.records[0].reason, "product_mapping_missing");
  assert.deepEqual(result.companyFacts, { factCount: 1, salesAmount: 70, costAmount: 40, profitAmount: 30 });
});

test("有效期BOM版本按销售日期选择并保留exact证据", () => {
  const db = fixture();
  db.prepare("INSERT INTO sales_object_structure_effective_periods VALUES (?,?,?,?,?,?,?)")
    .run("period-bundle-n", "structure-bundle-n", "bundle-n", "2026-08-01", "2026-09-01", "active", "exact");
  const item = queryProductContributions({ periodStart: "2026-08-02", periodEnd: "2026-08-02" }, { database: db }).items.find((row) => row.productId === "product-a");
  assert.equal(item.bomEvidenceLevel, "exact");
  assert.equal(item.bomEvidence.exact, 1);
});

test("无历史有效期证据的当前旺店通BOM标记inferred", () => {
  const db = fixture();
  db.prepare("UPDATE sales_object_structures SET sourceType='wangdian_suite_api' WHERE id='structure-bundle-n'").run();
  const item = queryProductContributions({ periodStart: "2026-08-02", periodEnd: "2026-08-02" }, { database: db }).items.find((row) => row.productId === "product-a");
  assert.equal(item.bomEvidenceLevel, "inferred");
});

test("日趋势分开直接、Bundle贡献和实际出货", () => {
  const result = queryProductContributions({ periodStart: "2026-08-01", periodEnd: "2026-08-03" }, { database: fixture() });
  const rows = result.dailyItems.filter((item) => item.productId === "product-a");
  assert.deepEqual(rows.map((item) => [item.date, item.directSalesQuantity, item.bundleContributionQuantity, item.totalPhysicalContribution]), [
    ["2026-08-01", 10, null, 10], ["2026-08-02", null, 12, 12], ["2026-08-03", null, 4, 4],
  ]);
});

test("产品筛选不影响公司事实保护数", () => {
  const result = queryProductContributions({ periodStart: "2026-08-01", periodEnd: "2026-08-31", productIds: ["product-a"] }, { database: fixture() });
  assert.deepEqual(result.items.map((item) => item.productId), ["product-a"]);
  assert.equal(result.companyFacts.factCount, 3);
  assert.equal(result.companyFacts.profitAmount, 90);
});

test("非法日期范围被拒绝", () => {
  assert.throws(() => queryProductContributions({ periodStart: "2026-08-31", periodEnd: "2026-08-01" }, { database: fixture() }), /日期范围无效/);
});

test("通用Product销售摘要统一返回直接经济事实和实际出货", () => {
  const summary = queryDailySalesSummary({ dimension: "product", targetId: "product-a", startDate: "2026-08-01", endDate: "2026-08-04" }, { database: fixture() });
  assert.equal(summary.contractVersion, "2.0");
  assert.equal(summary.quantity, 26);
  assert.equal(summary.salesAmount, 100);
  assert.equal(summary.profitAmount, 40);
  assert.equal(summary.bundleAllocation, "none");
});

test("通用Product趋势、排行和对比均使用Contribution契约", () => {
  const db = fixture();
  const trend = queryDailySalesTrend({ dimension: "product", targetId: "product-a", startDate: "2026-08-01", endDate: "2026-08-04" }, { database: db });
  const ranking = queryDailySalesSummaryRanking({ dimension: "product", startDate: "2026-08-01", endDate: "2026-08-04", limit: 10 }, { database: db });
  const comparison = queryDailySalesSummaryComparison({ dimension: "product", currentStart: "2026-08-03", currentEnd: "2026-08-04", compareStart: "2026-08-01", compareEnd: "2026-08-02" }, { database: db });
  assert.equal(trend.items.find((item) => item.date === "2026-08-02").quantity, 12);
  assert.ok(ranking.items.every((item) => item.metricContract === "product-contribution-v1"));
  assert.ok(comparison.items.every((item) => item.bundleAllocation === "none"));
});
