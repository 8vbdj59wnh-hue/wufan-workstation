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
    CREATE TABLE data_sync_batches(id TEXT,taskId TEXT,status TEXT,syncMode TEXT,periodEnd TEXT,completedAt TEXT,createdAt TEXT,fileName TEXT,fileHash TEXT,totalCount INTEGER);
    CREATE TABLE sales_links(id TEXT PRIMARY KEY,lastSeenBatchId TEXT,currentState TEXT);
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT,lastSeenBatchId TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesLinkId TEXT,salesLinkSkuId TEXT,erpSkuId TEXT,saleDate TEXT,sourceBatchId TEXT);
    INSERT INTO data_sync_tasks VALUES('platform-task','platform_goods_excel_import');
    INSERT INTO data_sync_batches VALUES('latest-batch','platform-task','succeeded','full','2026-08-19','2026-08-19T12:00:00Z','2026-08-19T11:00:00Z','8.19平台货品.xlsx','hash',2);
    INSERT INTO sales_links VALUES('platform-link','latest-batch','active');
    INSERT INTO sales_links VALUES('recent-sales-link','older-batch','active');
    INSERT INTO sales_links VALUES('historical-link','older-batch','active');
    INSERT INTO sales_link_skus VALUES('platform-sku','platform-link','latest-batch');
    INSERT INTO connection_sku_sales_daily_facts VALUES('recent-fact','recent-sales-link','recent-sku','erp-recent','2026-08-17','sales-batch-latest');
    INSERT INTO connection_sku_sales_daily_facts VALUES('old-fact','historical-link','old-sku','erp-old','2026-07-01','sales-batch-old');
  `);
  return database;
}

test("Link Operating Set严格等于最新完整平台批次", () => {
  const database = fixture();
  const summary = getLinkOperatingSummary({ database });
  assert.deepEqual({
    historicalAssetCount: summary.historicalAssetCount,
    platformActiveCount: summary.platformActiveCount,
    operatingCount: summary.operatingCount,
    historicalCount: summary.historicalCount,
  }, { historicalAssetCount: 3, platformActiveCount: 1, operatingCount: 1, historicalCount: 2 });
  const scope = buildLinkOperatingScope(database, { alias: "l", prefix: "testOperating" });
  assert.deepEqual(database.prepare(`SELECT id FROM sales_links l WHERE ${scope.predicate} ORDER BY id`).all(scope.params).map((row) => row.id),
    ["platform-link"]);
  assert.equal(scope.predicate.includes("connection_sku_sales_daily_facts"), false, "利润表不得参与Link经营状态判断");
  database.close();
});

test("历史Link重新出现在完整批次后自动恢复且重复计算幂等", () => {
  const database = fixture();
  database.prepare("UPDATE sales_links SET lastSeenBatchId='latest-batch' WHERE id='historical-link'").run();
  database.prepare("INSERT INTO sales_link_skus VALUES('historical-sku','historical-link','latest-batch')").run();
  const first = getLinkOperatingSummary({ database });
  const second = getLinkOperatingSummary({ database });
  assert.equal(first.operatingCount, 2);
  assert.equal(first.historicalCount, 1);
  assert.deepEqual(second, first);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, 2, "经营范围读取不得修改历史销售事实");
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
  ]) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /buildLinkOperatingScope/u, `${file} 应复用Link Operating Set`);
  const page = fs.readFileSync(path.join(root, "src/connectionCenterPage.js"), "utf8");
  const businessToolbar = fs.readFileSync(path.join(root, "src/uiModules/linkBusinessToolbar.js"), "utf8");
  assert.match(page, /includeHistorical/u);
  assert.match(page, /显示历史\/退出经营链接/u);
  assert.match(page, /当前经营 Link/u);
  assert.match(businessToolbar, /name="includeHistorical"/u);
});
