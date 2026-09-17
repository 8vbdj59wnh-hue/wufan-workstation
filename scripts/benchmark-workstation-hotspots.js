import crypto from "node:crypto";
import Database from "better-sqlite3";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH 必须指向隔离验证数据库。");
if (!['test', 'isolation', 'migration-preview'].includes(String(process.env.WUFAN_ENV || '').toLowerCase())) {
  throw new Error("性能脚本只能在 test/isolation/migration-preview 环境运行。");
}

const originalPrepare = Database.prototype.prepare;
let prepareCount = 0;
Database.prototype.prepare = function countedPrepare(sql) {
  prepareCount += 1;
  return originalPrepare.call(this, sql);
};

const [{ getDatabase }, { querySalesDailyDataQuality }, { getProductBusinessReadModel }, { getConnectionBusinessCockpit }] = await Promise.all([
  import("../server/db.js"),
  import("../server/salesDailyDataQualityService.js"),
  import("../server/productBusinessReadModel.js"),
  import("../server/connectionBusinessCockpitService.js"),
]);

const database = getDatabase();
const timed = (read) => {
  const startedAt = performance.now();
  const value = read();
  return { value, elapsedMs: Number((performance.now() - startedAt).toFixed(1)) };
};
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

prepareCount = 0;
const quality = timed(() => querySalesDailyDataQuality({ database, cacheTtlMs: 0 }));
const qualityPrepares = prepareCount;
const productCold = timed(() => getProductBusinessReadModel({ range: "30d", page: 1, pageSize: 30 }, { bypassCache: true }));
const productPage2 = timed(() => getProductBusinessReadModel({ range: "30d", page: 2, pageSize: 30 }));
const cockpit = timed(() => getConnectionBusinessCockpit("", true, { scope: "full", preset: "30d" }));

const explain = (sql, ...params) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail);
console.log(JSON.stringify({
  databasePath: process.env.WUFAN_DB_PATH,
  indexes: database.prepare(`SELECT name,sql FROM sqlite_master WHERE type='index' AND name IN (
    'idx_erp_skus_merchant_sku_lower','idx_sales_links_shop_platform_goods') ORDER BY name`).all(),
  plans: {
    erpSku: explain("SELECT id,merchantSkuCode FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)", "sample"),
    salesLink: explain("SELECT id,title FROM sales_links WHERE shopId=? AND platformGoodsId=?", "sample", "sample"),
  },
  quality: {
    elapsedMs: quality.elapsedMs,
    prepareCount: qualityPrepares,
    rows: quality.value.coverage?.totalRows ?? 0,
    sha256: digest(quality.value),
  },
  productBusiness: {
    coldMs: productCold.elapsedMs,
    page2Ms: productPage2.elapsedMs,
    total: productCold.value.pagination.total,
    page1Ids: productCold.value.items.map((item) => item.erpSkuId),
    page2Ids: productPage2.value.items.map((item) => item.erpSkuId),
    sameSummary: JSON.stringify(productCold.value.summary) === JSON.stringify(productPage2.value.summary),
  },
  connectionCockpit: {
    elapsedMs: cockpit.elapsedMs,
    timings: cockpit.value._timings,
    bytes: Buffer.byteLength(JSON.stringify(cockpit.value)),
    sha256: digest(cockpit.value),
  },
}, null, 2));
