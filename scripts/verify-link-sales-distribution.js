import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "link-sales-distribution-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { getLinkSalesDistribution } = await import("../server/linkSalesDistributionService.js");
const { queryLinkDataTable } = await import("../server/linkDataTableService.js");
const date = (offset) => { const value = new Date(); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };

try {
  initializeDatabase({ reset: true });
  const db = getDatabase(); const now = new Date().toISOString();
  const people = db.prepare("SELECT id FROM persons WHERE status='active' LIMIT 2").all();
  const [mine, other] = people;
  db.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('distribution-shop','天猫','分布测试店','分布测试店','分布测试店','active',?,?)`).run(now, now);
  db.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,fileName,fileHash,businessDate,status,createdAt,updatedAt) VALUES ('distribution-batch','excel','distribution.xlsx','distribution-hash',?,'completed',?,?)`).run(date(-1), now, now);
  const insertLink = db.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,canonicalUrl,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES (?,'distribution-shop',?,?,?,'strong','test','complete','active',?,?)`);
  const insertProfile = db.prepare(`INSERT INTO connection_profiles
    (id,salesLinkId,name,mainImage,ownerId,status,level,originSource,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'active','new','test',?,?)`);
  const insertSku = db.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,specificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES (?,?,?,?,'matched','active',?,?)`);
  const insertFact = db.prepare(`INSERT INTO connection_sku_sales_facts
    (id,batchId,salesLinkId,salesLinkSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,rawDataJson,createdAt)
    VALUES (?,'distribution-batch',?,?,?,?,?,?,?,?,?,?,'{}',?)`);
  for (let index = 1; index <= 4345; index += 1) {
    const link = `distribution-link-${index}`; const profile = `distribution-profile-${index}`; const sku = `distribution-sku-${index}`;
    insertLink.run(link, `goods-${index}`, `分布链接${index}`, `https://example.com/${index}`, now, now);
    insertProfile.run(profile, link, `分布链接${index}`, index === 1 ? "/uploads/first.jpg" : null, index <= 2200 ? mine.id : other.id, now, now);
    insertSku.run(sku, link, `platform-sku-${index}`, `规格${index}`, now, now);
    if (index <= 4325) insertFact.run(`distribution-fact-${index}`, link, sku, `goods-${index}`, `SKU-${index}`, date(-1), date(-1), 1, 10000 - index, 1, 1, now);
  }

  const queryStarted = performance.now();
  const company = getLinkSalesDistribution({ scope: "company", preset: "7d" }, mine.id, true);
  const queryMs = performance.now() - queryStarted;
  assert.equal(company.items.length, 4345); assert.equal(company.summary.groupCount, 44);
  assert.equal(company.summary.linksWithData, 4325); assert.equal(company.summary.linksWithoutData, 20);
  assert.equal(company.items[0].rank, 1); assert.equal(company.items[0].groupIndex, 1);
  assert.equal(company.items[99].groupIndex, 1); assert.equal(company.items[100].groupIndex, 2); assert.equal(company.items[200].groupIndex, 3);
  assert.ok(company.items.every((item, index, list) => index === 0 || (item.salesAmount ?? -Infinity) <= (list[index - 1].salesAmount ?? -Infinity)));
  assert.equal(company.items.at(-1).salesAmount, null); assert.equal(company.items.at(-1).noData, true);
  assert.ok(Math.abs(company.items.filter((item) => item.hasData).reduce((sum, item) => sum + item.salesPercentage, 0) - 1) < 0.000001);
  const mineOnly = getLinkSalesDistribution({ scope: "mine", preset: "30d" }, mine.id, false);
  assert.equal(mineOnly.items.length, 2200); assert.equal(mineOnly.summary.groupCount, 22);
  assert.throws(() => getLinkSalesDistribution({ scope: "company" }, mine.id, false), /只有管理员/);
  const custom = getLinkSalesDistribution({ scope: "company", preset: "custom", startDate: date(-20), endDate: date(-10) }, mine.id, true);
  assert.equal(custom.summary.noData, true); assert.equal(custom.items[0].salesAmount, null);

  const ids = company.items.slice(100, 110).map((item) => item.linkId);
  const drill = queryLinkDataTable({ scope: "company", preset: "7d", connectionIds: ids.join(","), pageSize: 20, sortField: "selectedSales" }, mine.id, true);
  assert.equal(drill.pagination.total, 10); assert.deepEqual(new Set(drill.items.map((item) => item.id)), new Set(ids));

  await import("../src/uiModules/linkImage.js"); await import("../src/uiModules/linkDataTable.js");
  const { renderLinkSalesDistribution } = await import("../src/uiModules/linkSalesDistribution.js");
  const renderStarted = performance.now();
  const allHtml = renderLinkSalesDistribution({ state: company, canViewCompany: true });
  const renderMs = performance.now() - renderStarted;
  assert.equal((allHtml.match(/<rect /g) || []).length, 4345, "每个链接必须对应一个柱子");
  assert.match(allHtml, /data-distribution-group="3"/);
  const groupHtml = renderLinkSalesDistribution({ state: { ...company, selectedGroup: 2 }, canViewCompany: true });
  assert.equal((groupHtml.match(/<rect /g) || []).length, 100); assert.match(groupHtml, /data-distribution-range="101-110"/);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(db.pragma("foreign_key_check"), []);
  console.log(JSON.stringify({ company: company.summary, mine: mineOnly.summary, custom: custom.summary,
    bars: 4345, groupBars: 100, drillRows: drill.pagination.total, queryMs: Number(queryMs.toFixed(2)),
    renderMs: Number(renderMs.toFixed(2)), payloadBytes: Buffer.byteLength(JSON.stringify(company)), integrity: "ok", foreignKeys: 0 }, null, 2));
} finally {
  closeDatabase(); fs.rmSync(root, { recursive: true, force: true });
}
