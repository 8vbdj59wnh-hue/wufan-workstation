import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { getDatabase } from "../server/db.js";
import { listProductCenterV2Skus, getProductCenterV2Metadata } from "../server/productCenterV2Service.js";
import { resolveErpSkuSalesObjectLinks } from "../server/capabilities/resolveLinkSkuRelationRead.js";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH必须指向隔离验证数据库。");

const database = getDatabase();
const timed = (read) => {
  const startedAt = performance.now();
  const value = read();
  return { value, milliseconds: performance.now() - startedAt };
};
const percentile = (values, ratio) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const measure = (name, options) => {
  const samples = [];
  let result;
  for (let index = 0; index < 7; index += 1) {
    const measured = timed(() => listProductCenterV2Skus(options));
    result = measured.value;
    samples.push(measured.milliseconds);
  }
  return { name, options, result, samples, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
};

const scenarios = [
  measure("default", { limit: 50, offset: 0, sort: "updated-desc" }),
  measure("search", { limit: 50, offset: 0, search: "HP0910", sort: "updated-desc" }),
  measure("platform", { limit: 50, offset: 0, platform: "天猫", sort: "updated-desc" }),
  measure("sales-sort", { limit: 50, offset: 0, sort: "sales-desc" }),
  measure("stock-sort", { limit: 50, offset: 0, sort: "stock-desc" }),
  measure("page-2", { limit: 50, offset: 50, sort: "updated-desc" }),
];

for (const scenario of scenarios) {
  assert.ok(scenario.result.rows.length <= 50, `${scenario.name}返回页大小异常`);
  assert.ok(scenario.p50 < 500, `${scenario.name} P50应小于500ms，实际${scenario.p50.toFixed(1)}ms`);
  assert.ok(scenario.p95 < 1000, `${scenario.name} P95应小于1s，实际${scenario.p95.toFixed(1)}ms`);
}

const defaultPage = scenarios[0].result;
assert.equal(defaultPage.rows.length, 50);
assert.equal(scenarios[5].result.rows.length, 50);
assert.equal(new Set([...defaultPage.rows, ...scenarios[5].result.rows].map((row) => row.erpSkuId)).size, 100, "翻页不应重复SKU");
assert.ok(scenarios[1].result.rows.every((row) => JSON.stringify(row).toLowerCase().includes("hp0910")), "搜索结果应匹配关键词");
assert.ok(scenarios[2].result.rows.every((row) => row.platforms.includes("天猫")), "平台筛选结果应全部属于天猫");
assert.ok(scenarios[3].result.rows.every((row, index, rows) => index === 0 || Number(rows[index - 1].salesMetric) >= Number(row.salesMetric)), "销售排序应保持降序");
assert.ok(scenarios[4].result.rows.every((row, index, rows) => index === 0 || Number(rows[index - 1].stockNum) >= Number(row.stockNum)), "库存排序应保持降序");

let oldQueries = 0;
let newQueries = 0;
const pageIds = defaultPage.rows.map((row) => row.erpSkuId);
const pageRelations = resolveErpSkuSalesObjectLinks({ erpSkuIds: pageIds }, {
  database,
  scope: "productAssociations",
  salesObjectOnly: true,
  onOldQuery: () => { oldQueries += 1; },
  onNewQuery: () => { newQueries += 1; },
});
assert.equal(oldQueries, 0, "产品列表Sales Object路径不应执行Legacy Resolver查询");
assert.ok(newQueries > 0, "产品列表应执行Sales Object Resolver查询");
for (const row of defaultPage.rows) {
  const expected = database.prepare(`SELECT COUNT(DISTINCT r.linkSkuId) platformSkuCount,COUNT(DISTINCT x.salesLinkId) linkCount
    FROM sales_object_structure_components c JOIN sales_object_structures s ON s.id=c.structureId AND s.status='active'
    JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=s.salesObjectId AND r.status='active'
    JOIN sales_link_skus x ON x.id=r.linkSkuId WHERE c.status='active' AND c.erpSkuId=?`).get(row.erpSkuId);
  assert.equal(row.platformSkuCount, Number(expected.platformSkuCount), `SKU ${row.erpSkuId}的链接SKU计数应与Sales Object关系一致`);
  assert.equal(row.linkCount, Number(expected.linkCount), `SKU ${row.erpSkuId}的链接计数应与Sales Object关系一致`);
}

const metadata = timed(() => getProductCenterV2Metadata());
assert.ok(metadata.milliseconds < 500, `Metadata冷/热读应小于500ms，实际${metadata.milliseconds.toFixed(1)}ms`);
assert.ok(metadata.value.facets.platforms.length > 0);
assert.ok(metadata.value.facets.shops.length > 0);

console.log(JSON.stringify({
  success: true,
  scenarios: scenarios.map(({ name, samples, p50, p95, result }) => ({
    name,
    rows: result.rows.length,
    total: result.pagination.total,
    p50: Number(p50.toFixed(1)),
    p95: Number(p95.toFixed(1)),
    samples: samples.map((value) => Number(value.toFixed(1))),
  })),
  metadataMilliseconds: Number(metadata.milliseconds.toFixed(1)),
  resolverQueries: { legacy: oldQueries, salesObject: newQueries },
}, null, 2));
