import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { prefetchSalesDailyIdentityCache } from "../server/salesDailyFactPreviewService.js";

function uniqueResult(rows) {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  return { row: unique.length === 1 ? unique[0] : null, count: unique.length };
}

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE sales_shops (id TEXT,shopName TEXT,displayName TEXT,platform TEXT);
    CREATE TABLE sales_shop_aliases (id TEXT,shopId TEXT,rawName TEXT);
    CREATE TABLE sales_links (id TEXT,shopId TEXT,platformGoodsId TEXT,title TEXT);
    CREATE TABLE sales_link_skus (id TEXT,salesLinkId TEXT,platformSkuId TEXT,systemGoodsType TEXT);
    CREATE TABLE erp_skus (id TEXT,merchantSkuCode TEXT);
    INSERT INTO sales_shops VALUES
      ('shop-1','Alpha','旗舰店','tmall'),
      ('shop-2','Beta','重复店','jd'),
      ('shop-3','Gamma','重复店','douyin');
    INSERT INTO sales_shop_aliases VALUES
      ('alias-1','shop-1','A店'),
      ('alias-2','shop-1','Alpha');
    INSERT INTO sales_links VALUES
      ('link-1','shop-1','goods-1','商品一'),
      ('link-2','shop-1','goods-duplicate','重复一'),
      ('link-3','shop-1','goods-duplicate','重复二');
    INSERT INTO sales_link_skus VALUES
      ('sku-1','link-1','spec-1','normal'),
      ('sku-2','link-1','spec-duplicate','normal'),
      ('sku-3','link-1','spec-duplicate','normal');
    INSERT INTO erp_skus VALUES
      ('erp-1','ERP-1'),
      ('erp-2','DUP'),
      ('erp-3','dup');
  `);
  return database;
}

function legacy(database, item) {
  const shopName = item.normalized.shopName;
  const shop = uniqueResult(database.prepare(`SELECT DISTINCT s.id,s.shopName,s.displayName,s.platform
    FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
    WHERE LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)`).all(shopName, shopName, shopName));
  const link = shop.row ? uniqueResult(database.prepare("SELECT id,title FROM sales_links WHERE shopId=? AND platformGoodsId=?").all(shop.row.id, item.normalized.platformGoodsId)) : null;
  const sku = link?.row ? uniqueResult(database.prepare("SELECT id,systemGoodsType FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").all(link.row.id, item.normalized.platformSkuId)) : null;
  const erp = uniqueResult(database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)").all(item.normalized.merchantSkuCode));
  return { shop, link, sku, erp };
}

test("batch identity prefetch preserves missing, unique, alias and ambiguous lookup semantics", () => {
  const database = fixture();
  const items = [
    { normalized: { shopName: "A店", platformGoodsId: "goods-1", platformSkuId: "spec-1", merchantSkuCode: "erp-1" } },
    { normalized: { shopName: "Alpha", platformGoodsId: "goods-duplicate", platformSkuId: "spec-1", merchantSkuCode: "DUP" } },
    { normalized: { shopName: "Alpha", platformGoodsId: "goods-1", platformSkuId: "spec-duplicate", merchantSkuCode: "missing" } },
    { normalized: { shopName: "重复店", platformGoodsId: "goods-1", platformSkuId: "spec-1", merchantSkuCode: "ERP-1" } },
  ];
  let prepareCount = 0;
  const counted = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") return (sql) => { prepareCount += 1; return target.prepare(sql); };
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const cache = prefetchSalesDailyIdentityCache(counted, items);
  assert.equal(prepareCount, 4);

  for (const item of items) {
    const expected = legacy(database, item);
    const shop = cache.shops.get(item.normalized.shopName.toLowerCase());
    const link = shop?.row ? cache.links.get(`${shop.row.id}|${item.normalized.platformGoodsId}`) : null;
    const sku = link?.row ? cache.skus.get(`${link.row.id}|${item.normalized.platformSkuId}`) : null;
    const erp = cache.erpSkus.get(item.normalized.merchantSkuCode.toLowerCase());
    assert.deepEqual({ shop, link, sku, erp }, expected);
  }
  assert.equal(cache.shops.get("重复店").count, 2);
  assert.equal(cache.links.get("shop-1|goods-duplicate").count, 2);
  assert.equal(cache.skus.get("link-1|spec-duplicate").count, 2);
  assert.equal(cache.erpSkus.get("dup").count, 2);
  database.close();
});
