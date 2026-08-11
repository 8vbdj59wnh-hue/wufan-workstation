import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-platform-sku-sync-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");
const dbModule = await import("../server/db.js");
dbModule.initializeDatabase();
const db = dbModule.getDatabase();
const center = await import("../server/dataSyncCenterService.js");
const adapter = await import("../server/platformGoodsDataSyncAdapter.js");
const platformService = await import("../server/wangdianPlatformGoodsSyncService.js");

const now = "2026-08-04T00:00:00.000Z";
db.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)").run("shop-jd", "jd", "点意", "点意", "点意", now, now);
db.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)").run("shop-tmall", "tmall", "点意旗舰店", "点意旗舰店", "点意旗舰店", now, now);
db.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'platform_import','complete','active',?,?)").run("link-1", "shop-jd", "G-1", "已有链接1", "strong", now, now);
db.prepare("INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'platform_import','complete','active',?,?)").run("link-2", "shop-jd", "G-2", "已有链接2", "strong", now, now);
db.prepare("INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES (?,?,?,'{}','active',?,?)").run("goods-1", "ERP-G-1", "ERP货品", now, now);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'baseline','baseline','active',?,?)").run("erp-sku-1", "M-1", "goods-1", "规格1", "{}", now, now);
db.prepare("INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,'baseline','baseline','active',?,?)").run("erp-sku-2", "M-2", "goods-1", "规格2", "{}", now, now);
db.prepare("INSERT INTO products (id,skuCode,name,status,createdAt,updatedAt) VALUES (?,?,?,'active',?,?)").run("product-1", "P-1", "现有产品", now, now);
db.prepare("INSERT INTO product_erp_mappings (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'active',?,?)").run("mapping-1", "product-1", "goods-1", "erp-sku-1", "M-1", "sku_code", now, now);
platformService.saveWangdianShopMapping({ wangdianShopNo: "WDT-JD", shopId: "shop-jd" }, "person-admin");
platformService.saveWangdianShopMapping({ wangdianShopNo: "WDT-TMALL", shopId: "shop-tmall" }, "person-admin");

const task = center.getDataSyncTask("sync-task-platform-goods");
assert.equal(task.taskCode, "wangdian_platform_goods");
assert.equal(task.status, "paused");
center.setDataSyncTaskStatus(task.id, "enabled");
const countsBefore = Object.fromEntries(["sales_links", "products"].map((table) => [table, db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));

const goodRows = [
  { shop_no: "WDT-JD", goods_id: "G-1", spec_id: "S-1", spec_outer_id: "OUT-1", spec_name: "平台规格1", merchant_no: "M-1", price: 99, stock_num: 8 },
  { shop_no: "WDT-JD", goods_id: "G-2", spec_id: "S-2", spec_outer_id: "OUT-2", spec_name: "平台规格2", merchant_no: "M-2", price: 88, stock_num: 6 },
  { shop_no: "WDT-TMALL", goods_id: "TAO-1", spec_id: "TAO-S-1", merchant_no: "M-1" },
];
const query = (rows) => async () => ({ status: 0, data: { total_count: rows.length, goods_list: rows } });

const previewV1 = await adapter.previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-02 00:00:00", scope: { shops: ["shop-jd"], platforms: ["jd"] }, createdBy: "person-admin", queryApi: query(goodRows) });
assert.equal(previewV1.summary.matched, 2);
assert.equal(previewV1.summary.created, 2);
assert.equal(previewV1.summary.exceptionCount, 0);
assert.deepEqual(previewV1.dataSyncBatch.scope, { shops: ["shop-jd"], platforms: ["jd"] });
const restrictedPreview = await adapter.previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-02 00:00:00", scope: { shops: ["shop-tmall"], platforms: ["tmall"] }, createdBy: "person-admin", queryApi: query(goodRows.slice(2)) });
assert.equal(restrictedPreview.platformSync.exceptions[0].exceptionType, "platform_restricted");

const blockedRows = [
  { shop_no: "UNKNOWN", goods_id: "G-1", spec_id: "S-X", merchant_no: "M-1" },
  { shop_no: "WDT-JD", goods_id: "MISSING", spec_id: "S-X2", merchant_no: "M-1" },
  { shop_no: "WDT-JD", goods_id: "G-1", spec_id: "S-X3", merchant_no: "" },
  { shop_no: "WDT-JD", goods_id: "G-1", spec_id: "S-X4", merchant_no: "NOT-FOUND" },
  { shop_no: "WDT-JD", goods_id: "G-1", spec_id: "S-X5", merchant_no: "M-1", match_target_type: 2 },
];
const previewV2 = await adapter.previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-02 00:00:00", scope: { shops: ["shop-jd"], platforms: ["jd"] }, createdBy: "person-admin", queryApi: query(blockedRows) });
assert.equal(previewV2.summary.canCommit, false);
assert.throws(() => adapter.commitPlatformGoodsDataSync(previewV2.dataSyncBatch.id), /店铺映射/u);
assert.equal(adapter.readPlatformGoodsDataSyncPreview(previewV1.dataSyncBatch.id).isCurrent, false);

const previewV3 = await adapter.previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "full", requestStart: "2026-08-01 00:00:00", requestEnd: "2026-08-02 00:00:00", scope: { shops: ["shop-jd"], platforms: ["jd"] }, createdBy: "person-admin", queryApi: query(goodRows) });
const committed = adapter.commitPlatformGoodsDataSync(previewV3.dataSyncBatch.id);
assert.equal(committed.dataSyncBatch.status, "succeeded");
assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, 2);
assert.deepEqual(db.prepare("SELECT erpSkuId,productId FROM sales_link_skus WHERE platformSkuId='S-1'").get(), { erpSkuId: null, productId: null });
assert.deepEqual(db.prepare("SELECT erpSkuId,productId FROM sales_link_skus WHERE platformSkuId='S-2'").get(), { erpSkuId: null, productId: null });
assert.deepEqual(db.prepare("SELECT m.erpSkuId,m.mappingType,m.quantity,m.currentState FROM sales_link_sku_erp_mappings m JOIN sales_link_skus s ON s.id=m.salesLinkSkuId WHERE s.platformSkuId='S-1'").get(), { erpSkuId: "erp-sku-1", mappingType: "single", quantity: 1, currentState: "active" });
assert.deepEqual(db.prepare("SELECT m.erpSkuId,m.mappingType,m.quantity,m.currentState FROM sales_link_sku_erp_mappings m JOIN sales_link_skus s ON s.id=m.salesLinkSkuId WHERE s.platformSkuId='S-2'").get(), { erpSkuId: "erp-sku-2", mappingType: "single", quantity: 1, currentState: "active" });
assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_links").get().total, countsBefore.sales_links);
assert.equal(db.prepare("SELECT COUNT(*) total FROM products").get().total, countsBefore.products);

const incremental = await adapter.previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "incremental", requestEnd: "2026-08-12 00:00:00", scope: { shops: ["shop-jd"], platforms: ["jd"] }, createdBy: "person-admin", queryApi: query(goodRows.slice(0, 2)) });
assert.deepEqual(incremental.dataSyncBatch.scope, { shops: ["shop-jd"], platforms: ["jd"] });
assert.equal(incremental.summary.created, 0);
assert.equal(incremental.summary.updated, 2);
adapter.commitPlatformGoodsDataSync(incremental.dataSyncBatch.id);
assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, 2, "重复同步不得重复创建平台SKU关系");
assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total, 2, "重复同步不得重复创建V2关系");

const unifiedTypes = db.prepare("SELECT DISTINCT exceptionType FROM data_sync_exceptions WHERE taskId=? ORDER BY exceptionType").all(task.id).map((item) => item.exceptionType);
assert.ok(unifiedTypes.includes("platform_restricted"));
assert.ok(unifiedTypes.includes("unknown_shop"));
assert.ok(unifiedTypes.includes("missing_platform_goods"));
assert.ok(unifiedTypes.includes("missing_merchant_no"));
assert.ok(unifiedTypes.includes("missing_erp_sku"));
assert.ok(unifiedTypes.includes("bundle_sku"));
db.prepare("UPDATE data_sync_tasks SET nextRunAt='2000-01-01T00:00:00.000Z' WHERE id=?").run(task.id);
const scheduled = await adapter.runDuePlatformGoodsSyncTasks({ queryApi: query(goodRows.slice(0, 2)) });
assert.equal(scheduled[0].success, true);
assert.equal(db.prepare("SELECT COUNT(*) total FROM data_sync_batches WHERE taskId=? AND triggerMode='automatic'").get(task.id).total, 1);
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(db.pragma("foreign_key_check"), []);
for (const item of db.prepare("SELECT id FROM wangdian_platform_goods_sync_logs").all()) fs.rmSync(path.join(dbModule.uploadsDir, "wangdian-platform-goods-sync", `${item.id}.json`), { force: true });
dbModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });

console.log(JSON.stringify({ taskCode: task.taskCode, full: { matched: 2, created: 2, v2Mappings: 2 }, incremental: { updated: 2 }, restrictedPlatformHandled: true, unknownShopBlocked: true, salesLinksCreated: 0, productsCreated: 0, legacyFieldsWritten: 0, idempotentRelations: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
