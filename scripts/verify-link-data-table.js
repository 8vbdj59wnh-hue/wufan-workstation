import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const keepFixture = process.env.LINK_DATA_TABLE_KEEP_FIXTURE === "1";
const root = keepFixture ? path.join(os.tmpdir(), "wufan-link-data-table-browser-fixture") : fs.mkdtempSync(path.join(os.tmpdir(), "link-data-table-"));
if (keepFixture) fs.mkdirSync(root, { recursive: true });
const databasePath = path.join(root, "isolated.db");
process.env.WUFAN_DB_PATH = databasePath;
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { queryLinkDataTable } = await import("../server/linkDataTableService.js");

function isoDate(offset) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);
}

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  const people = database.prepare("SELECT id FROM persons WHERE status='active' LIMIT 2").all();
  assert.ok(people.length >= 2, "isolated seed must provide two people");
  const [owner, other] = people;
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('shop-a','天猫','测试店铺','测试店铺','测试店铺','active',?,?)`).run(now, now);
  const insertLink = database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,canonicalUrl,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES (?, 'shop-a', ?, ?, ?, 'strong','test','complete','active',?,?)`);
  const insertProfile = database.prepare(`INSERT INTO connection_profiles
    (id,salesLinkId,name,mainImage,ownerId,status,level,originSource,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'active','new','test',?,?)`);
  const insertSku = database.prepare(`INSERT INTO sales_link_skus
    (id,salesLinkId,platformSkuId,specificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES (?,?,?,?,'matched','active',?,?)`);
  for (let index = 1; index <= 25; index += 1) {
    const linkId = `link-${index}`; const profileId = `profile-${index}`;
    insertLink.run(linkId, `goods-${index}`, `测试链接${index}`, `https://example.com/${index}`, now, now);
    insertProfile.run(profileId, linkId, `测试链接${index}`, index === 1 ? "/uploads/link-1.jpg" : null, index === 2 ? other.id : owner.id, now, now);
    insertSku.run(`sku-${index}`, linkId, `platform-sku-${index}`, `规格${index}`, now, now);
  }
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,fileName,fileHash,businessDate,status,createdAt,updatedAt) VALUES ('batch-1','excel','test.xlsx','hash',?,'completed',?,?)`).run(isoDate(-1), now, now);
  const insertFact = database.prepare(`INSERT INTO connection_sku_sales_facts
    (id,batchId,salesLinkId,salesLinkSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,rawDataJson,createdAt)
    VALUES (?,'batch-1','link-1','sku-1','goods-1','SKU-1',?,?,?,?,?,?,'{}',?)`);
  insertFact.run("fact-yesterday", isoDate(-1), isoDate(-1), 2, 100, 60, 40, now);
  insertFact.run("fact-old", isoDate(-10), isoDate(-10), 1, 50, 30, 20, now);

  const mine = queryLinkDataTable({ scope: "mine", preset: "7d", page: 1, pageSize: 20, sortField: "sales30d", sortDirection: "desc" }, owner.id, false);
  assert.equal(mine.pagination.total, 24, "mine scope must only include the current owner");
  assert.equal(mine.pagination.totalPages, 2, "results must be server paged");
  assert.equal(mine.items.length, 20, "only the requested page may be returned");
  assert.equal(mine.items[0].id, "profile-1", "sales sorting must run before pagination");
  assert.deepEqual(mine.items[0].sales.yesterday, { value: 100, hasData: true, noData: false });
  assert.deepEqual(mine.items[0].sales.sevenDays, { value: 100, hasData: true, noData: false });
  assert.deepEqual(mine.items[0].sales.thirtyDays, { value: 150, hasData: true, noData: false });
  const empty = mine.items.find((item) => item.id !== "profile-1");
  assert.equal(empty.sales.sevenDays.value, null); assert.equal(empty.sales.sevenDays.noData, true);
  assert.equal(empty.healthStatus, "no_data"); assert.equal(empty.hospitalStatus, "none");
  assert.ok(mine.filterOptions.platforms.includes("天猫"));

  const custom = queryLinkDataTable({ scope: "mine", preset: "custom", startDate: isoDate(-12), endDate: isoDate(-8), keyword: "测试链接1" }, owner.id, false);
  assert.equal(custom.items.find((item) => item.id === "profile-1").sales.selected.value, 50, "custom range must use the existing sales fact");
  assert.equal(custom.range.preset, "custom");

  assert.throws(() => queryLinkDataTable({ scope: "company" }, owner.id, false), /只有管理员/);
  const company = queryLinkDataTable({ scope: "company", page: 1, pageSize: 20 }, owner.id, true);
  assert.equal(company.pagination.total, 25); assert.ok(company.items.some((item) => item.ownerId === other.id));
  const filtered = queryLinkDataTable({ scope: "mine", platform: "不存在" }, owner.id, false);
  assert.equal(filtered.pagination.total, 0);

  await import("../src/uiModules/linkImage.js");
  await import("../src/uiModules/linkColumnSetting.js");
  await import("../src/uiModules/linkDataToolbar.js");
  const { renderLinkDataTable, DEFAULT_MINE_LINK_FIELDS } = await import("../src/uiModules/linkDataTable.js");
  const html = renderLinkDataTable({ items: mine.items.slice(0, 2), pagination: mine.pagination, fields: DEFAULT_MINE_LINK_FIELDS });
  assert.match(html, /data-module-key="link_data_table"/); assert.match(html, /暂无数据/); assert.match(html, /data-module-key="link_image"/);

  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(database.pragma("foreign_key_check"), []);
  console.log(JSON.stringify({ mine: mine.pagination, company: company.pagination, customSales: custom.items.find((item) => item.id === "profile-1").sales.selected,
    noData: empty.sales.sevenDays, modules: ["link_image", "link_data_table", "link_column_setting", "link_data_toolbar"] }, null, 2));
} finally {
  closeDatabase();
  if (!keepFixture) fs.rmSync(root, { recursive: true, force: true });
}
