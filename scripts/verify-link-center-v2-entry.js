import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const databasePath = path.join(os.tmpdir(), `wufan-link-v2-${process.pid}-${Date.now()}.db`);
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { listConnectionImportTemplates, previewConnectionDataImport } = await import("../server/connectionDataFoundationService.js");
const { commitPlatformGoodsExcelDataSync, previewPlatformGoodsExcelDataSync } = await import("../server/platformGoodsExcelDataSyncAdapter.js");
const { confirmPlatformLinkShopMappings, previewPlatformLinkShopMappings } = await import("../server/platformLinkShopMappingImportService.js");

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const workbookBuffer = (rows, sheetName = "Sheet1") => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

try {
  initializeDatabase({ reset: true });
  const db = getDatabase(); const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('shop-tmall','天猫','点意旗舰店','点意旗舰店','点意旗舰店','active',?,?)`).run(timestamp, timestamp);
  const extraShops = [
    ["shop-taobao", "淘宝", "Banran半然", "banran半然", "Banran半然"],
    ["shop-xhs", "小红书", "半然-小红书", "半然-小红书", "半然-小红书"],
    ["shop-jd", "京东", "点意", "点意", "点意"],
    ["shop-douyin", "抖店", "点意抖音店", "点意抖音店", "点意抖音店"],
  ];
  for (const shop of extraShops) db.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'active',?,?)`).run(...shop, timestamp, timestamp);
  db.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,platformGoodsCode,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES ('link-1','shop-tmall','1001','1001','测试链接','goods_id','platform_link_operations','complete','active',?,?)`).run(timestamp, timestamp);
  for (const [linkId, shopId, goodsId] of [["link-taobao","shop-taobao","2001"],["link-xhs","shop-xhs","3001"],["link-jd","shop-jd","4001"],["link-douyin","shop-douyin","5001"]]) {
    db.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,platformGoodsCode,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'goods_id','platform_link_operations','complete','active',?,?)`).run(linkId, shopId, goodsId, goodsId, `链接${goodsId}`, timestamp, timestamp);
  }
  db.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('link-sku-1','link-1','sku-1','ERP-001','erp-001','默认','默认','unmatched','active',?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('link-sku-taobao','link-taobao','sku-2','ERP-002','erp-002','默认','默认','unmatched','active',?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO erp_goods (id,goodsCode,goodsName,currentState,createdAt,updatedAt) VALUES ('erp-goods-1','G-001','测试货品','active',?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('erp-sku-1','ERP-001','erp-goods-1','默认','active','seed','seed','active',?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,specificationName,erpStatus,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('erp-sku-2','ERP-002','erp-goods-1','默认','active','seed','seed','active',?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO sales_link_sku_erp_mappings (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt)
    VALUES ('existing-point-mapping','link-sku-1','erp-sku-1','single',1,'active','legacy_migration',?,?)`).run(timestamp, timestamp);

  const protectedBefore = db.prepare(`SELECT
    (SELECT COUNT(*) FROM sales_links) links,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,
    (SELECT COUNT(*) FROM erp_skus) erpSkus,
    (SELECT COUNT(*) FROM products) products,
    (SELECT shopId FROM sales_links WHERE id='link-1') linkShopId,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) facts,
    (SELECT erpSkuId FROM sales_link_skus WHERE id='link-sku-1') legacyErpSkuId`).get();

  const relationFile = workbookBuffer([
    { 店铺: "点意旗舰店-天猫-公司", 货品ID: "1001", 规格ID: "sku-1", 平台规格编码: "ERP-001", 系统货品: "单品" },
    { 店铺: "Banran半然-淘宝", 货品ID: "2001", 规格ID: "sku-2", 平台规格编码: "ERP-002", 系统货品: "单品" },
    { 店铺: "系统不存在-淘宝", 货品ID: "9999", 规格ID: "sku-9", 平台规格编码: "ERP-009", 系统货品: "单品" },
    { 店铺: "无效", 货品ID: "invalid", 规格ID: "invalid-sku", 平台规格编码: "ERP-009", 系统货品: "单品" },
    { 店铺: "总计:", 货品ID: "NA", 规格ID: "NA", 平台规格编码: "NA", 系统货品: "NA" },
    { 店铺: "汇总", 货品ID: "summary", 规格ID: "summary-sku", 平台规格编码: "ERP-009", 系统货品: "单品" },
  ]);
  const relationPreview = previewPlatformGoodsExcelDataSync({ taskId: "sync-task-platform-goods-excel", buffer: relationFile, fileName: "平台货品.xlsx", createdBy: "" });
  assert(relationPreview.summary.linkable === 1 && relationPreview.summary.alreadyLinked === 1, "平台货品全量预览未正确区分新增和已有关系。");
  assert(relationPreview.summary.sourceShopCount === 3 && relationPreview.summary.matchedShopCount === 2, "平台货品全量预览店铺统计错误。");
  assert(relationPreview.summary.exceptionTypes.missing_shop === 1, "不存在的店铺未进入异常中心。");
  assert(relationPreview.summary.ignoredNonBusiness === 3, "平台货品非业务行未在店铺匹配前过滤。");
  assert(!relationPreview.summary.exceptionTypes.non_business_row, "平台货品非业务行错误进入异常统计。");
  const relationCommit = commitPlatformGoodsExcelDataSync(relationPreview.dataSyncBatch.id);
  assert(relationCommit.created === 1, "平台货品多店铺V2关系未创建或重复创建已有关系。");
  const mapping = db.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId='link-sku-1' AND erpSkuId='erp-sku-1'").get();
  assert(mapping?.mappingType === "single" && mapping.quantity === 1 && mapping.sourceType === "legacy_migration", "已有点意关系被重复或覆盖。");
  const importedMapping = db.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId='link-sku-taobao' AND erpSkuId='erp-sku-2'").get();
  assert(importedMapping?.mappingType === "single" && importedMapping.quantity === 1 && importedMapping.sourceType === "platform_goods_excel", "新店铺V2映射字段不符合要求。");
  assert(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE sourceType='platform_goods_excel'").get().total === 1, "多店铺映射数量错误。");
  assert(db.prepare("SELECT erpSkuId FROM sales_link_skus WHERE id='link-sku-1'").get().erpSkuId === protectedBefore.legacyErpSkuId, "旧erpSkuId字段被修改。");

  const shopFile = workbookBuffer([{ 平台: "天猫", 平台商品ID: "1001", 系统店铺: "shop-tmall" }]);
  const shopPreview = previewPlatformLinkShopMappings({ buffer: shopFile, fileName: "店铺匹配.xlsx", createdBy: "" });
  assert(shopPreview.summary.valid === 1 && shopPreview.summary.errors === 0, "店铺匹配预览失败。");
  const shopCommit = confirmPlatformLinkShopMappings(shopPreview.batch.id);
  assert(shopCommit.created === 1, "店铺匹配未创建。");
  assert(db.prepare("SELECT shopId FROM platform_link_shop_mappings WHERE platform='tmall' AND platformGoodsId='1001'").get().shopId === "shop-tmall", "店铺匹配结果错误。");

  const platformFile = workbookBuffer([
    ["说明"], ["说明"], ["说明"], ["说明"],
    ["商品ID", "商品名称", "统计日期", "商品访客数", "商品浏览量", "支付金额"],
    ["1001", "测试链接", "2026-08-06", "10", "20", "99.5"],
  ], "生意参谋平台-商品");
  const platformPreview = previewConnectionDataImport({ buffer: platformFile, fileName: "天猫点意旗舰店链接数据.xlsx", importType: "platform_link_operations", userId: "" });
  assert(platformPreview.preview.detectedAutomatically === true, "平台文件没有走自动识别。");
  assert(platformPreview.preview.platform === "tmall" && platformPreview.preview.shopId === "shop-tmall", "平台或店铺自动识别错误。");
  const platformCases = [
    ["淘宝半然链接数据.xlsx", "taobao", "shop-taobao", workbookBuffer([["说明"],["说明"],["说明"],["说明"],["商品ID","商品名称","统计日期","商品访客数"],["2001","淘宝链接","2026-08-06","10"]], "生意参谋平台-商品")],
    ["半然小红书链接数据.xlsx", "xiaohongshu", "shop-xhs", workbookBuffer([{ 商品ID:"3001", 商品NAME:"小红书链接", 经营方式:"全部", 载体:"全部", 商品访客数:"10" }], "商品明细数据下载2026-08-01至2026-08-06")],
    ["京东点意链接数据.xlsx", "jd", "shop-jd", workbookBuffer([{ SPU:"4001", SPU名称:"京东链接", 时间:"2026-08-06", 商品访客数:"10" }], "商品明细")],
    ["抖音点意抖音店链接数据.xlsx", "douyin", "shop-douyin", workbookBuffer([{ 商品ID:"5001", 商品名称:"抖音链接", 统计日期:"2026-08-06", 商品访客数:"10" }], "商品数据")],
  ];
  for (const [fileName, platform, shopId, buffer] of platformCases) {
    const result = previewConnectionDataImport({ buffer, fileName, importType: "platform_link_operations", userId: "" });
    assert(result.preview.platform === platform && result.preview.shopId === shopId, `${platform}平台自动识别错误。`);
  }
  const supportedPlatforms = new Set(listConnectionImportTemplates().filter((item) => item.dataType === "platform_link_operations").map((item) => item.sourcePlatform));
  for (const platform of ["tmall", "taobao", "xiaohongshu", "jd", "douyin"]) assert(supportedPlatforms.has(platform), `缺少${platform}平台模板。`);

  const protectedAfter = db.prepare(`SELECT
    (SELECT COUNT(*) FROM sales_links) links,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,
    (SELECT COUNT(*) FROM erp_skus) erpSkus,
    (SELECT COUNT(*) FROM products) products,
    (SELECT shopId FROM sales_links WHERE id='link-1') linkShopId,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) facts,
    (SELECT erpSkuId FROM sales_link_skus WHERE id='link-sku-1') legacyErpSkuId`).get();
  assert(protectedAfter.links === protectedBefore.links, "预览修改了链接数量。");
  assert(protectedAfter.facts === protectedBefore.facts, "预览修改了销售事实。");
  assert(protectedAfter.linkSkus === protectedBefore.linkSkus && protectedAfter.erpSkus === protectedBefore.erpSkus && protectedAfter.products === protectedBefore.products, "导入修改了受保护的SKU或产品数量。");
  assert(protectedAfter.linkShopId === protectedBefore.linkShopId, "店铺匹配修改了链接身份。");
  assert(protectedAfter.legacyErpSkuId === protectedBefore.legacyErpSkuId, "V2切换修改了旧字段。");
  const mappingCountBeforeSecondMigration = db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total;
  initializeDatabase({ reset: false });
  assert(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total === mappingCountBeforeSecondMigration, "第二次迁移改变了V2映射数量。");
  assert(db.pragma("integrity_check", { simple: true }) === "ok", "SQLite integrity_check未通过。");
  assert(db.pragma("foreign_key_check").length === 0, "SQLite foreign_key_check未通过。");
  console.log(JSON.stringify({
    platformGoodsV2MappingsCreated: relationCommit.created,
    platformGoodsSourceShops: relationPreview.summary.sourceShopCount,
    platformGoodsMatchedShops: relationPreview.summary.matchedShopCount,
    platformGoodsMissingShopExceptions: relationPreview.summary.exceptionTypes.missing_shop,
    platformGoodsIgnoredNonBusinessRows: relationPreview.summary.ignoredNonBusiness,
    shopMappingsCreated: shopCommit.created,
    detectedPlatforms: [...supportedPlatforms].sort(),
    detectedShopId: platformPreview.preview.shopId,
    salesFactsChanged: protectedAfter.facts - protectedBefore.facts,
    salesLinksChanged: protectedAfter.links - protectedBefore.links,
    protectedBusinessCountsChanged: 0,
    linkIdentityChanged: false,
    migrationIdempotent: true,
    integrityCheck: "ok",
    foreignKeyCheck: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
