import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { buildLinkOperatingScope, getLinkOperatingSummary } from "../server/linkOperatingSetService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE erp_import_batches(id TEXT,importType TEXT,status TEXT,importMode TEXT,businessDate TEXT,completedAt TEXT,createdAt TEXT,originalFilename TEXT);
    CREATE TABLE data_sync_tasks(id TEXT,taskCode TEXT);
    CREATE TABLE data_sync_batches(id TEXT,taskId TEXT,status TEXT,syncMode TEXT,periodEnd TEXT,completedAt TEXT,createdAt TEXT,fileName TEXT,fileHash TEXT,totalCount INTEGER,scopeJson TEXT);
    CREATE TABLE platform_goods_excel_import_rows(batchId TEXT,rowNumber INTEGER,salesLinkId TEXT,salesLinkSkuId TEXT,PRIMARY KEY(batchId,rowNumber));
    CREATE TABLE sales_links(id TEXT PRIMARY KEY,lastSeenBatchId TEXT,currentState TEXT);
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT,lastSeenBatchId TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesLinkId TEXT,salesLinkSkuId TEXT,erpSkuId TEXT,saleDate TEXT,sourceBatchId TEXT);
    INSERT INTO data_sync_tasks VALUES('platform-task','platform_goods_excel_import');
    INSERT INTO data_sync_batches VALUES('latest-batch','platform-task','succeeded','full','2026-08-19','2026-08-19T12:00:00Z','2026-08-19T11:00:00Z','8.19平台货品.xlsx','hash',2,'{"platformSnapshotMode":"full"}');
    INSERT INTO sales_links VALUES('platform-link','latest-batch','active');
    INSERT INTO sales_links VALUES('recent-sales-link','older-batch','active');
    INSERT INTO sales_links VALUES('historical-link','older-batch','missing');
    INSERT INTO sales_link_skus VALUES('platform-sku','platform-link','latest-batch');
    INSERT INTO platform_goods_excel_import_rows VALUES('latest-batch',1,'platform-link','platform-sku');
    INSERT INTO connection_sku_sales_daily_facts VALUES('recent-fact','recent-sales-link','recent-sku','erp-recent','2026-08-17','sales-batch-latest');
    INSERT INTO connection_sku_sales_daily_facts VALUES('old-fact','historical-link','old-sku','erp-old','2026-07-01','sales-batch-old');
  `);
  return database;
}

test("Link Operating Set严格等于Link自身active状态", () => {
  const database = fixture();
  const summary = getLinkOperatingSummary({ database });
  assert.deepEqual({
    historicalAssetCount: summary.historicalAssetCount,
    platformActiveCount: summary.platformActiveCount,
    operatingCount: summary.operatingCount,
    historicalCount: summary.historicalCount,
  }, { historicalAssetCount: 3, platformActiveCount: 1, operatingCount: 2, historicalCount: 1 });
  const scope = buildLinkOperatingScope(database, { alias: "l", prefix: "testOperating" });
  assert.deepEqual(database.prepare(`SELECT id FROM sales_links l WHERE ${scope.predicate} ORDER BY id`).all(scope.params).map((row) => row.id),
    ["platform-link", "recent-sales-link"]);
  assert.equal(scope.predicate.includes("lastSeenBatchId"), false, "平台批次不得作为Link有效性判断");
  assert.match(scope.predicate, /currentState/u);
  assert.equal(scope.predicate.includes("connection_sku_sales_daily_facts"), false, "利润表不得参与Link经营状态判断");
  database.close();
});

test("历史Link只有明确恢复active后才重新进入默认范围且重复计算幂等", () => {
  const database = fixture();
  database.prepare("UPDATE sales_links SET currentState='active' WHERE id='historical-link'").run();
  database.prepare("INSERT INTO sales_link_skus VALUES('historical-sku','historical-link','latest-batch')").run();
  const first = getLinkOperatingSummary({ database });
  const second = getLinkOperatingSummary({ database });
  assert.equal(first.operatingCount, 3);
  assert.equal(first.historicalCount, 0);
  assert.deepEqual(second, first);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, 2, "经营范围读取不得修改历史销售事实");
  database.close();
});

test("preview、partial和单店批次不能替换最新完整平台批次", () => {
  const database = fixture();
  database.prepare("INSERT INTO data_sync_batches VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    "partial-batch", "platform-task", "partial", "full", "2026-08-20", "2026-08-20T12:00:00Z", "2026-08-20T11:00:00Z",
    "单店平台货品.xlsx", "partial-hash", 1, JSON.stringify({ platformSnapshotMode: "partial", sourceShopNames: ["测试店"] }),
  );
  database.prepare("UPDATE sales_links SET lastSeenBatchId='partial-batch' WHERE id='recent-sales-link'").run();
  const summary = getLinkOperatingSummary({ database });
  assert.equal(summary.platformBatch.id, "latest-batch");
  assert.equal(summary.operatingCount, 2, "partial批次和lastSeenBatchId变化不得隐藏active Link");
  database.close();
});

test("批次高度分散时默认范围仍不得出现active Link断崖下降", () => {
  const database = fixture();
  const insert = database.prepare("INSERT INTO sales_links VALUES(?,?, 'active')");
  for (let index = 0; index < 100; index += 1) insert.run(`active-${index}`, `source-${index}`);
  const activeCount = database.prepare("SELECT COUNT(*) total FROM sales_links WHERE currentState='active'").get().total;
  const scope = buildLinkOperatingScope(database, { alias: "l" });
  const visibleCount = database.prepare(`SELECT COUNT(*) total FROM sales_links l WHERE ${scope.predicate}`).get(scope.params).total;
  assert.equal(visibleCount, activeCount);
  assert.equal(visibleCount, 102);
  database.close();
});

test("驾驶舱、链接列表与经营分析复用统一规则，历史筛选保留", () => {
  for (const file of [
    "server/connectionBusinessCockpitService.js",
    "server/connectionCorePageService.js",
    "server/linkBusinessTableService.js",
    "server/linkDataTableService.js",
    "server/linkSalesDistributionService.js",
    "server/connectionGoalCockpitService.js",
    "server/connectionGoalWorkbenchService.js",
    "server/connectionGrowthService.js",
  ]) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /buildLinkOperatingScope/u, `${file} 应复用Link Operating Set`);
  const page = fs.readFileSync(path.join(root, "src/connectionCenterPage.js"), "utf8");
  const businessToolbar = fs.readFileSync(path.join(root, "src/uiModules/linkBusinessToolbar.js"), "utf8");
  assert.match(page, /includeHistorical/u);
  assert.match(page, /显示历史\/退出经营链接/u);
  assert.match(page, /当前经营 Link/u);
  assert.match(page, /invalidateLinkOperatingViews\(committed\.operatingSet\)/u, "平台完整批次提交后应立即失效页面经营范围缓存");
  assert.match(businessToolbar, /name="includeHistorical"/u);
});
