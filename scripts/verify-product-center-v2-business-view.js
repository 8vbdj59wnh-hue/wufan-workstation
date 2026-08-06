import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const databasePath = path.join(os.tmpdir(), `product-center-v2-business-${process.pid}.db`);
process.env.WUFAN_DB_PATH = databasePath;

const { getDatabase, initializeDatabase } = await import("../server/db.js");
const { listProductCenterV2Skus } = await import("../server/productCenterV2Service.js");

try {
  initializeDatabase({ reset: true });
  const db = getDatabase();
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO wangdian_inventory_sync_batches
    (id,importMode,businessDate,status,startedAt) VALUES ('inventory-batch','full','2026-08-06','completed',?)`).run(timestamp);
  db.prepare(`INSERT INTO erp_goods (id,goodsCode,goodsName,brand,category,rawSourceData,currentState) VALUES ('g1','G1','测试货品','测试品牌','测试分类','{}','active')`).run();
  const insertSku = db.prepare(`INSERT INTO erp_skus
    (id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES (@id,@code,'g1',@name,'active','{}','batch-1','batch-1','active',@timestamp,@timestamp)`);
  [100, 50, 20, 5, 0, 10].forEach((sales, index) => {
    const id = `sku-${index + 1}`;
    insertSku.run({ id, code: `SKU-${index + 1}`, name: `规格${index + 1}`, timestamp });
    db.prepare(`INSERT INTO erp_sku_inventory_daily_summaries
      (id,businessDate,erpSkuId,warehouseCount,stockNum,availableSendStock,sales7d,salesMonth,sales90d,syncBatchId,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(`inventory-${id}`, "2026-08-06", id, 1, index === 4 ? 30 : 100, 80, sales / 4, sales, sales * 3, "inventory-batch", timestamp, timestamp);
  });
  db.prepare(`INSERT INTO products (id,skuCode,name,brand,category,status) VALUES ('product-new','SKU-6','新品档案','测试品牌','测试分类','新品')`).run();
  db.prepare(`INSERT INTO product_erp_mappings
    (id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,inventoryCurrentState)
    VALUES ('product-map','product-new','g1','sku-6','SKU-6','exact','active','active')`).run();
  db.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status) VALUES ('shop-1','天猫','测试店','测试店','测试店','active')`).run();
  db.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState) VALUES ('link-1','shop-1','goods-1','测试链接','strong','test','complete','active')`).run();
  db.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,syncEnabled,matchStatus,currentState) VALUES ('link-sku-1','link-1','platform-sku-1',1,'matched_auto','active')`).run();
  db.prepare(`INSERT INTO sales_link_sku_erp_mappings
    (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt)
    VALUES ('mapping-1','link-sku-1','sku-1','single',1,'active','test',?,?)`).run(timestamp, timestamp);

  const all = listProductCenterV2Skus({ limit: 50 });
  const hit = listProductCenterV2Skus({ businessZone: "hit", sort: "sales-desc", limit: 50 });
  const clearance = listProductCenterV2Skus({ businessZone: "clearance", limit: 50 });
  const category = listProductCenterV2Skus({ category: "测试分类", limit: 50 });
  const platform = listProductCenterV2Skus({ platform: "天猫", limit: 50 });
  if (all.summary.total !== 6) throw new Error(`ERP SKU主体数量错误：${all.summary.total}`);
  if (all.summary.businessZones.hit !== 1 || hit.rows[0]?.erpSkuId !== "sku-1") throw new Error("爆款区或销量排序错误");
  if (all.summary.businessZones.new !== 1) throw new Error("新品区分类错误");
  if (clearance.pagination.total !== 1 || clearance.rows[0]?.erpSkuId !== "sku-5") throw new Error("清仓区分类错误");
  if (category.pagination.total !== 6 || !all.facets.categories.includes("测试分类")) throw new Error("分类筛选错误");
  if (platform.pagination.total !== 1 || platform.rows[0]?.linkCount !== 1) throw new Error("平台筛选或V2链接聚合错误");
  console.log(JSON.stringify({ success: true, summary: all.summary, hit: hit.rows[0].merchantSkuCode, clearance: clearance.rows[0].merchantSkuCode, categoryCount: category.pagination.total, platformCount: platform.pagination.total }, null, 2));
} finally {
  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });
}
