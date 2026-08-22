import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { readShopOperations } from "../server/connectionBusinessCockpitService.js";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE sales_shops(id TEXT PRIMARY KEY,platform TEXT,shopName TEXT,displayName TEXT,status TEXT);
    CREATE TABLE sales_links(id TEXT PRIMARY KEY,shopId TEXT,lastSeenBatchId TEXT);
    CREATE TABLE connection_profiles(id TEXT PRIMARY KEY,salesLinkId TEXT,ownerId TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,salesLinkId TEXT,saleDate TEXT,salesAmount REAL,profitAmount REAL);
    CREATE TABLE connection_goal_plans(id TEXT PRIMARY KEY,connectionId TEXT,status TEXT);
    CREATE TABLE connection_goal_evaluations(id TEXT PRIMARY KEY,goalPlanId TEXT,evaluationStatus TEXT,grade TEXT);

    INSERT INTO sales_shops VALUES('shop-a','天猫','甲店','甲店','active');
    INSERT INTO sales_shops VALUES('shop-b','京东','乙店','乙店','active');
    INSERT INTO sales_shops VALUES('shop-c','小红书','丙店','丙店','active');
    INSERT INTO sales_shops VALUES('shop-inactive','淘宝','停用店','停用店','inactive');

    INSERT INTO sales_links VALUES('link-a1','shop-a','latest-batch');
    INSERT INTO sales_links VALUES('link-a2','shop-a','latest-batch');
    INSERT INTO sales_links VALUES('link-a3','shop-a','latest-batch');
    INSERT INTO sales_links VALUES('link-a4','shop-a','latest-batch');
    INSERT INTO sales_links VALUES('link-b1','shop-b','latest-batch');
    INSERT INTO sales_links VALUES('link-historical','shop-a','older-batch');

    INSERT INTO connection_profiles VALUES('profile-a1','link-a1','owner-a');
    INSERT INTO connection_profiles VALUES('profile-a2','link-a2','owner-a');
    INSERT INTO connection_profiles VALUES('profile-a3','link-a3','owner-a');
    INSERT INTO connection_profiles VALUES('profile-a4','link-a4','owner-a');
    INSERT INTO connection_profiles VALUES('profile-b1','link-b1','owner-b');
    INSERT INTO connection_profiles VALUES('profile-history','link-historical','owner-a');

    INSERT INTO connection_sku_sales_daily_facts VALUES('current-a','link-a1','2026-08-20',300,90);
    INSERT INTO connection_sku_sales_daily_facts VALUES('previous-a','link-a1','2026-07-20',150,50);
    INSERT INTO connection_sku_sales_daily_facts VALUES('historical-current','link-historical','2026-08-20',999,999);

    INSERT INTO connection_goal_plans VALUES('plan-a1','profile-a1','active');
    INSERT INTO connection_goal_plans VALUES('plan-a2','profile-a2','active');
    INSERT INTO connection_goal_plans VALUES('plan-a3','profile-a3','active');
    INSERT INTO connection_goal_plans VALUES('plan-a4','profile-a4','active');
    INSERT INTO connection_goal_evaluations VALUES('evaluation-a1','plan-a1','evaluated','excellent');
    INSERT INTO connection_goal_evaluations VALUES('evaluation-a2','plan-a2','evaluated','good');
    INSERT INTO connection_goal_evaluations VALUES('evaluation-a3','plan-a3','evaluated','on_target');
    INSERT INTO connection_goal_evaluations VALUES('evaluation-a4','plan-a4','evaluated','underperforming');
  `);
  return database;
}

const window = {
  periodStart: "2026-07-22",
  periodEnd: "2026-08-20",
  previousStart: "2026-06-22",
  previousEnd: "2026-07-21",
  previousPeriodComplete: true,
};
const operatingScope = { predicate: "l.lastSeenBatchId=@testBatchId", params: { testBatchId: "latest-batch" } };

test("店铺经营一次聚合覆盖有效店铺并与当前经营Link对账", () => {
  const database = fixture();
  const shops = readShopOperations(database, window, operatingScope, "", true);
  assert.equal(shops.length, 3, "停用店铺不能进入卡片，有效无销售店铺必须保留");
  assert.equal(shops.reduce((sum, shop) => sum + shop.totalLinks, 0), 5);
  assert.equal(shops.reduce((sum, shop) => sum + shop.salesAmount, 0), 300);
  assert.equal(shops.reduce((sum, shop) => sum + shop.profitAmount, 0), 90);

  const shopA = shops.find((shop) => shop.shopId === "shop-a");
  assert.deepEqual({
    totalLinks: shopA.totalLinks,
    salesAmount: shopA.salesAmount,
    profitAmount: shopA.profitAmount,
    profitMargin: shopA.profitMargin,
    previousSalesAmount: shopA.previousSalesAmount,
    salesTrend: shopA.salesTrend,
    evaluatedLinks: shopA.evaluatedLinks,
    gradeSum: shopA.excellentLinks + shopA.goodLinks + shopA.onTargetLinks + shopA.underperformingLinks,
  }, { totalLinks: 4, salesAmount: 300, profitAmount: 90, profitMargin: 0.3, previousSalesAmount: 150, salesTrend: 1, evaluatedLinks: 4, gradeSum: 4 });

  assert.deepEqual(shops.find((shop) => shop.shopId === "shop-b"), {
    shopId: "shop-b", platform: "京东", shopName: "乙店", salesAmount: 0, profitAmount: 0, profitMargin: null,
    previousSalesAmount: 0, totalLinks: 1, excellentLinks: 0, goodLinks: 0, onTargetLinks: 0,
    underperformingLinks: 0, evaluatedLinks: 0, salesTrend: null,
  });
  assert.equal(shops.find((shop) => shop.shopId === "shop-c").totalLinks, 0);
  database.close();
});

test("负责人只看到权限范围内店铺，趋势数据不足时不误判", () => {
  const database = fixture();
  const shops = readShopOperations(database, { ...window, previousPeriodComplete: false }, operatingScope, "owner-a", false);
  assert.deepEqual(shops.map((shop) => shop.shopId), ["shop-a"]);
  assert.equal(shops[0].totalLinks, 4);
  assert.equal(shops[0].salesTrend, null);
  database.close();
});
