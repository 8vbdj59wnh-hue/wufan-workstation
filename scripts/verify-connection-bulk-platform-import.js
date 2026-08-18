import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const databasePath = path.join(os.tmpdir(), `wufan-bulk-platform-${process.pid}-${Date.now()}.db`);
process.env.WUFAN_DB_PATH = databasePath;
process.env.WUFAN_BULK_QUEUE_MANUAL = "1";

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { ensurePlatformLinkOperationTemplates } = await import("../server/connectionDataFoundationService.js");
const {
  confirmConnectionBulkPlatformImport,
  createConnectionBulkPlatformImport,
  drainConnectionBulkPlatformImportQueue,
  readConnectionBulkPlatformImport,
  resumeConnectionBulkPlatformImports,
} = await import("../server/connectionBulkPlatformImportService.js");

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const workbook = (rows, sheetName) => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

try {
  initializeDatabase({ reset: true });
  const db = getDatabase(); const stamp = new Date().toISOString();
  for (const shop of [["shop-tmall", "天猫", "点意旗舰店"], ["shop-jd", "京东", "点意"]]) {
    db.prepare("INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)")
      .run(shop[0], shop[1], shop[2], shop[2], shop[2], stamp, stamp);
  }
  for (const link of [["link-tmall-100", "shop-tmall", "TM-100", "天猫测试"], ["link-jd-200", "shop-jd", "JD-200", "京东测试"]]) {
    db.prepare(`INSERT INTO sales_links
      (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
      VALUES (?,?,?,?,'strong','erp_platform_goods','complete','active',?,?)`).run(...link, stamp, stamp);
  }
  ensurePlatformLinkOperationTemplates();
  const tmall = workbook([["说明"], ["说明"], ["说明"], ["说明"], ["商品ID", "商品名称", "统计日期", "商品访客数", "支付金额"], ["TM-100", "天猫测试", "2026-08-06", 12, 88]], "生意参谋平台-商品");
  const jd = workbook([["SPU", "SPU名称", "时间", "商品访客数", "成交金额"], ["JD-200", "京东测试", "2026-08-06", 8, 66]], "商品明细");
  const invalid = workbook([["未知字段"], ["无可识别内容"]], "未知表");
  const before = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_link_skus) linkSkus,
    (SELECT COUNT(*) FROM erp_skus) erpSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts,(SELECT COUNT(*) FROM erp_sku_inventory_daily_summaries) inventory`).get();
  const created = createConnectionBulkPlatformImport({ files: [
    { originalname: "天猫点意旗舰店.xlsx", buffer: tmall }, { originalname: "京东点意.xlsx", buffer: jd }, { originalname: "无法识别.xlsx", buffer: invalid },
  ] });
  const interrupted = db.prepare("SELECT id FROM connection_bulk_platform_import_files WHERE bulkBatchId=? ORDER BY sequenceNo LIMIT 1").get(created.batch.id);
  db.prepare("UPDATE connection_bulk_platform_import_files SET status='running' WHERE id=?").run(interrupted.id);
  resumeConnectionBulkPlatformImports();
  assert(db.prepare("SELECT status FROM connection_bulk_platform_import_files WHERE id=?").get(interrupted.id).status === "waiting", "中断子任务未恢复到等待队列。");
  drainConnectionBulkPlatformImportQueue();
  const preview = readConnectionBulkPlatformImport(created.batch.id);
  assert(preview.batch.status === "preview_ready_with_errors", "父批次未生成统一带异常预览。");
  assert(preview.batch.processedCount === 3 && preview.files.length === 3, "文件子任务未逐个完成。");
  assert(preview.files[0].platform === "tmall" && preview.files[0].shopId === "shop-tmall", "天猫平台或店铺识别错误。");
  assert(preview.files[1].platform === "jd" && preview.files[1].shopId === "shop-jd", "京东平台或店铺识别错误。");
  assert(preview.files[2].status === "failed" && preview.files[2].errorMessage, "无法识别文件未隔离。");
  const afterPreview = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_link_skus) linkSkus,
    (SELECT COUNT(*) FROM erp_skus) erpSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts,(SELECT COUNT(*) FROM erp_sku_inventory_daily_summaries) inventory`).get();
  assert(JSON.stringify(afterPreview) === JSON.stringify(before), "批量预览修改了业务数据。");
  const committed = confirmConnectionBulkPlatformImport(created.batch.id);
  assert(committed.batch.status === "completed_with_errors", "批量确认状态错误。");
  assert(committed.result.createdLinks === 0 && committed.result.factsCreated === 2, "批量确认应只写入既有链接的经营事实。");
  assert(db.prepare("SELECT COUNT(*) count FROM sales_links").get().count === before.links, "经营数据导入不得创建链接。");
  const protectedAfter = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_link_skus) linkSkus,(SELECT COUNT(*) FROM erp_skus) erpSkus,
    (SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,(SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts,
    (SELECT COUNT(*) FROM erp_sku_inventory_daily_summaries) inventory`).get();
  assert(protectedAfter.linkSkus === before.linkSkus && protectedAfter.erpSkus === before.erpSkus && protectedAfter.mappings === before.mappings
    && protectedAfter.salesFacts === before.salesFacts && protectedAfter.inventory === before.inventory, "批量确认修改了受保护关系或事实。");
  const repeated = createConnectionBulkPlatformImport({ files: [
    { originalname: "京东点意.xlsx", buffer: jd }, { originalname: "无法识别.xlsx", buffer: invalid }, { originalname: "天猫点意旗舰店.xlsx", buffer: tmall },
  ] });
  assert(repeated.idempotent === true && repeated.batch.id === created.batch.id, "相同文件集合未保持幂等。");
  process.env.WUFAN_BULK_QUEUE_MANUAL = "0";
  const backgroundFile = workbook([["说明"], ["说明"], ["说明"], ["说明"], ["商品ID", "商品名称", "统计日期", "商品访客数", "支付金额"], ["TM-101", "后台队列测试", "2026-08-06", 3, 18]], "生意参谋平台-商品");
  const background = createConnectionBulkPlatformImport({ files: [{ originalname: "天猫后台队列.xlsx", buffer: backgroundFile }] });
  let backgroundPreview = readConnectionBulkPlatformImport(background.batch.id);
  for (let attempt = 0; attempt < 100 && ["waiting", "running"].includes(backgroundPreview.batch.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    backgroundPreview = readConnectionBulkPlatformImport(background.batch.id);
  }
  assert(backgroundPreview.batch.status === "preview_ready" && backgroundPreview.summary.errors === 1,
    "缺少已有链接的经营数据应在预览阶段被隔离。");
  const backgroundCommitted = confirmConnectionBulkPlatformImport(background.batch.id);
  assert(backgroundCommitted.result.createdLinks === 0
    && !db.prepare("SELECT id FROM sales_links WHERE shopId='shop-tmall' AND platformGoodsId='TM-101'").get(),
  "缺失链接的经营数据确认时不得创建链接。");
  initializeDatabase({ reset: false });
  assert(db.pragma("integrity_check", { simple: true }) === "ok" && db.pragma("foreign_key_check").length === 0, "隔离数据库完整性检查失败。");
  console.log(JSON.stringify({ files: 3, processed: preview.batch.processedCount, backgroundQueue: backgroundPreview.batch.status, queueResume: true, platforms: preview.files.slice(0, 2).map((file) => file.platform), shops: preview.files.slice(0, 2).map((file) => file.shopId), isolatedErrors: 1, missingLinkBlocked: true, createdLinks: committed.result.createdLinks, operationFacts: committed.result.factsCreated, idempotent: true, protectedRelationsChanged: false, migrationIdempotent: true, integrityCheck: "ok", foreignKeyCheck: 0 }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
