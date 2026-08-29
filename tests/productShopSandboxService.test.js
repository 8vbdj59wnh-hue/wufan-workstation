import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getProductShopSandbox } from "../server/productShopSandboxService.js";
import { renderProductShopSandbox } from "../src/uiModules/productShopSandbox.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,skuCode TEXT,mainImage TEXT,status TEXT);
    CREATE TABLE erp_goods(id TEXT PRIMARY KEY,goodsCode TEXT,goodsName TEXT,brand TEXT,category TEXT);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,erpGoodsId TEXT,merchantSkuCode TEXT,specificationName TEXT,mainImage TEXT,currentState TEXT,rawSourceData TEXT);
    CREATE TABLE product_business_profiles(id TEXT PRIMARY KEY,erpSkuId TEXT,displayNameOverride TEXT,businessStatus TEXT);
    CREATE TABLE erp_sku_inventory_daily_summaries(erpSkuId TEXT,businessDate TEXT,stockNum REAL,availableSendStock REAL,warehouseCount INTEGER,sales7d REAL,salesMonth REAL,sales90d REAL);
    CREATE TABLE sales_shops(id TEXT PRIMARY KEY,platform TEXT,shopName TEXT,displayName TEXT,status TEXT);
    CREATE TABLE sales_links(id TEXT PRIMARY KEY,shopId TEXT,currentState TEXT);
    CREATE TABLE sales_link_skus(id TEXT PRIMARY KEY,salesLinkId TEXT,currentState TEXT,createdAt TEXT);
    CREATE TABLE product_erp_mappings(id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,currentState TEXT,updatedAt TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,saleDate TEXT,salesLinkId TEXT,salesLinkSkuId TEXT,quantity REAL,salesAmount REAL,costAmount REAL,profitAmount REAL,sourceBatchId TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,objectType TEXT,status TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,status TEXT,validityBasis TEXT,sourceType TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE sales_object_structure_effective_periods(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,validFrom TEXT,validTo TEXT,sourceState TEXT,validityBasis TEXT);
    INSERT INTO products VALUES
      ('product-a','花瓶A','HP01-2','/uploads/a.jpg','在售'),
      ('product-b','花瓶B','HP02-1','/uploads/b.jpg','在售'),
      ('product-c','花瓶C','HP01-1','/uploads/c.jpg','在售');
    INSERT INTO erp_goods VALUES('goods-a','A','花瓶A','半然','花瓶'),('goods-b','B','花瓶B','半然','花瓶'),('goods-c','C','花瓶C','半然','花瓶'),('goods-d','D','无Legacy产品','半然','花瓶'),('goods-down','DOWN','旺店通已下架产品','半然','花瓶');
    INSERT INTO erp_skus VALUES('erp-a','goods-a','A','A款','/uploads/a.jpg','active','{}'),('erp-b','goods-b','B','B款','/uploads/b.jpg','active','{}'),('erp-c','goods-c','C','C款','/uploads/c.jpg','active','{}'),('erp-d','goods-d','D','D款','','active','{}'),('erp-down','goods-down','DOWN-1','已下架规格','','active','{"goods_label":"已同步,已下架"}');
    INSERT INTO erp_sku_inventory_daily_summaries VALUES
      ('erp-a','2026-08-20',0,0,1,0,0,0),
      ('erp-b','2026-08-20',5,5,1,0,0,0),
      ('erp-c','2026-08-20',10,10,1,0,0,0),
      ('erp-d','2026-08-20',8,8,1,0,0,0),
      ('erp-down','2026-08-20',6,6,1,0,0,0);
    INSERT INTO sales_shops VALUES
      ('shop-1','tmall','店铺一','天猫店铺一','active'),
      ('shop-2','douyin','店铺二','抖音店铺二','active');
    INSERT INTO sales_links VALUES('link-1','shop-1','active'),('link-2','shop-1','active'),('link-3','shop-2','active');
    INSERT INTO sales_link_skus VALUES
      ('link-sku-a1','link-1','active','2026-08-01'),
      ('link-sku-b','link-2','active','2026-08-01'),
      ('link-sku-a2','link-3','active','2026-08-01'),
      ('link-sku-c','link-1','active','2026-08-01'),
      ('link-sku-d','link-1','active','2026-08-01'),
      ('link-sku-down','link-1','active','2026-08-01');
    INSERT INTO product_erp_mappings VALUES
      ('map-a','product-a','erp-a','active','2026-08-20'),
      ('map-b','product-b','erp-b','active','2026-08-20'),
      ('map-c','product-c','erp-c','active','2026-08-20');
    INSERT INTO sales_objects VALUES('object-a','A','single','active'),('object-b','B','single','active'),('object-c','C','single','active'),('object-d','D','single','active'),('object-down','DOWN','single','active');
    INSERT INTO sales_link_sku_sales_object_relations VALUES
      ('relation-a1','link-sku-a1','object-a','active'),
      ('relation-a2','link-sku-a2','object-a','active'),
      ('relation-b','link-sku-b','object-b','active'),
      ('relation-c','link-sku-c','object-c','active'),
      ('relation-d','link-sku-d','object-d','active'),
      ('relation-down','link-sku-down','object-down','active');
    INSERT INTO sales_object_structures VALUES
      ('structure-a','object-a',1,'active','exact','formal'),
      ('structure-b','object-b',1,'active','exact','formal'),
      ('structure-c','object-c',1,'active','exact','formal'),
      ('structure-d','object-d',1,'active','exact','formal'),
      ('structure-down','object-down',1,'active','exact','formal');
    INSERT INTO sales_object_structure_components VALUES
      ('component-a','structure-a','erp-a',1,1,'active'),
      ('component-b','structure-b','erp-b',1,1,'active'),
      ('component-c','structure-c','erp-c',1,1,'active'),
      ('component-d','structure-d','erp-d',1,1,'active'),
      ('component-down','structure-down','erp-down',1,1,'active');
    INSERT INTO connection_sku_sales_daily_facts VALUES
      ('fact-a1','2026-08-20','link-1','link-sku-a1',10,100,60,40,'batch-1'),
      ('fact-b','2026-08-20','link-2','link-sku-b',3,30,18,12,'batch-1'),
      ('fact-a2','2026-08-20','link-3','link-sku-a2',7,70,42,28,'batch-1');
  `);
  return database;
}

test("产品沙盘按店铺隔离产品销量且不修改销售事实", () => {
  const database = fixture();
  const before = database.prepare("SELECT COUNT(*) count,SUM(quantity) quantity FROM connection_sku_sales_daily_facts").get();
  const first = getProductShopSandbox({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20", shopId: "shop-1" }, { database });
  const second = getProductShopSandbox({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20", shopId: "shop-2" }, { database });
  assert.deepEqual(first.items.map((item) => [item.erpSkuId, item.salesQuantity]), [["erp-a", 10], ["erp-b", 3], ["erp-c", 0], ["erp-d", 0]]);
  assert.equal(first.items.some((item) => item.erpSkuId === "erp-down"), false);
  assert.deepEqual(second.items.map((item) => [item.erpSkuId, item.salesQuantity]), [["erp-a", 7]]);
  assert.equal(first.summary.totalSalesQuantity, 13);
  assert.equal(first.summary.productsWithoutSales, 2);
  assert.equal(first.summary.slowMovingProducts, 2);
  assert.equal(first.summary.outOfStockProducts, 1);
  assert.deepEqual(first.pagination, { total: 4, limit: 100, offset: 0, hasMore: false });
  assert.deepEqual(database.prepare("SELECT COUNT(*) count,SUM(quantity) quantity FROM connection_sku_sales_daily_facts").get(), before);
  database.close();
});

test("产品沙盘卡片只展示主图和销量角标并复用时间档位", () => {
  const database = fixture();
  const state = getProductShopSandbox({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20", shopId: "shop-1" }, { database });
  const html = renderProductShopSandbox({ state, resolveUrl: (value) => `http://127.0.0.1:3001${value}` });
  assert.match(html, /data-product-sandbox-shop="shop-1"/u);
  assert.match(html, /data-product-sandbox-preset="30d"/u);
  assert.match(html, /class="product-sandbox-card"/u);
  assert.match(html, /class="product-sandbox-quantity"/u);
  assert.doesNotMatch(html, /隐藏无销量/u);
  assert.match(html, /花瓶C，销量 0/u);
  assert.match(html, /总产品数 <strong>4<\/strong>/u);
  assert.match(html, /动销产品数 <strong>2<\/strong>/u);
  assert.match(html, /滞销产品数 <strong>2<\/strong>/u);
  assert.match(html, /无库存产品数 <strong>1<\/strong>/u);
  assert.match(html, /data-product-sandbox-segment="active"/u);
  assert.match(html, /data-product-sandbox-segment="slow"/u);
  assert.match(html, /data-product-sandbox-segment="out_of_stock"/u);
  assert.match(html, /data-product-sandbox-sort="sales"/u);
  assert.match(html, /data-product-sandbox-sort="code_group"/u);
  const groupedHtml = renderProductShopSandbox({ state: { ...state, sortMode: "code_group" }, resolveUrl: (value) => value });
  assert.ok(groupedHtml.indexOf('data-product-sandbox-product="erp-a"') < groupedHtml.indexOf('data-product-sandbox-product="erp-b"'));
  assert.ok(groupedHtml.indexOf('data-product-sandbox-product="erp-b"') < groupedHtml.indexOf('data-product-sandbox-product="erp-c"'));
  assert.ok(groupedHtml.indexOf('data-product-sandbox-product="erp-c"') < groupedHtml.indexOf('data-product-sandbox-product="erp-d"'));
  assert.match(html, /http:\/\/127\.0\.0\.1:3001\/uploads\/a\.jpg/u);
  const incrementalHtml = renderProductShopSandbox({ state: { ...state, pagination: { total: 104, limit: 100, offset: 0, hasMore: true } }, resolveUrl: (value) => value });
  assert.match(incrementalHtml, /data-product-sandbox-more/u);
  assert.match(incrementalHtml, /已显示 4\/104/u);
  database.close();
});

test("产品沙盘首屏最多渲染100张卡片并按100张增量展示", () => {
  const items = Array.from({ length: 245 }, (_, index) => ({
    erpSkuId: `erp-${index + 1}`,
    productName: `产品${index + 1}`,
    mainImage: `/uploads/${index + 1}.jpg`,
    salesQuantity: 245 - index,
    hasSales: true,
    hasInventoryData: true,
    inventoryQuantity: 1,
  }));
  const baseState = { items, shops: [{ id: "shop", name: "测试店铺" }], selectedShop: { id: "shop", name: "测试店铺" }, summary: {}, visibleCount: 100 };
  const initialHtml = renderProductShopSandbox({ state: baseState });
  assert.equal((initialHtml.match(/class="product-sandbox-card"/gu) || []).length, 100);
  assert.equal((initialHtml.match(/<img /gu) || []).length, 100);
  assert.match(initialHtml, /data-action="product-sandbox-load-more"/u);
  const nextHtml = renderProductShopSandbox({ state: { ...baseState, visibleCount: 200 } });
  assert.equal((nextHtml.match(/class="product-sandbox-card"/gu) || []).length, 200);
  assert.equal((nextHtml.match(/<img /gu) || []).length, 200);
});

test("产品中心提供产品沙盘入口和只读查询接口", () => {
  const page = fs.readFileSync(path.join(root, "src/productCenterPage.js"), "utf8");
  const appState = fs.readFileSync(path.join(root, "src/appState.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  assert.match(page, /data-view="product-sandbox"[^>]*>产品沙盘/u);
  assert.match(page, /renderUiModule\("product_shop_sandbox"/u);
  assert.match(appState, /\/api\/product-management\/shop-sandbox/u);
  assert.match(server, /app\.get\("\/api\/product-management\/shop-sandbox"/u);
});
