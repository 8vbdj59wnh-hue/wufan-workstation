import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import {
  confirmConnectionDataImport,
  listConnectionFoundationRows,
  previewConnectionDataImport,
  readConnectionFoundationBatch,
} from "./connectionDataFoundationService.js";
import {
  assertCurrentDataSyncPreview,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncBatch,
  getDataSyncTask,
  markDataSyncBatchPreviewReady,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";

const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const parseJson = (raw) => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };
const platformAliases = { tmall: ["tmall", "天猫"], "天猫": ["tmall", "天猫"], taobao: ["taobao", "淘宝"], "淘宝": ["taobao", "淘宝"], jd: ["jd", "京东"], "京东": ["jd", "京东"], xiaohongshu: ["xiaohongshu", "小红书"], "小红书": ["xiaohongshu", "小红书"] };

function findShop(db, platform, shopName) {
  for (const platformName of platformAliases[String(platform || "").trim().toLowerCase()] || [platform]) {
    const shop = db.prepare(`SELECT s.id FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
      WHERE LOWER(s.platform)=LOWER(?) AND (LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)) LIMIT 1`).get(platformName, shopName, shopName, shopName);
    if (shop) return shop;
  }
  return null;
}

function summarize(sourceBatch) {
  return {
    total: Number(sourceBatch.totalRows || 0),
    valid: Number(sourceBatch.pendingRows || sourceBatch.matchedRows || 0),
    exceptionCount: Number(sourceBatch.errorRows || 0),
    periodStart: sourceBatch.periodStart || null,
    periodEnd: sourceBatch.periodEnd || null,
    fileName: sourceBatch.fileName,
    fileHash: sourceBatch.fileHash,
  };
}

function unifiedExceptions(sourceBatchId) {
  const db = getDatabase();
  const rows = listConnectionFoundationRows(sourceBatchId);
  const errors = rows.filter((row) => row.status === "error").map((row) => ({
    exceptionType: row.errorType || "data_validation",
    severity: "error",
    message: row.errorMessage || "真实销售导入数据异常。",
    entityType: "sales_import_row",
    entityId: String(row.rowNumber),
    rawData: { rowNumber: row.rowNumber, raw: parseJson(row.rawDataJson), normalized: parseJson(row.normalizedDataJson) },
  }));
  for (const row of rows.filter((item) => item.status === "validated")) {
    const data = parseJson(row.normalizedDataJson);
    const shop = findShop(db, data.platform, data.shop);
    const link = shop ? db.prepare("SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, String(data.platformGoodsId || "").trim()) : null;
    const sku = link ? db.prepare("SELECT id,erpSkuId FROM sales_link_skus WHERE salesLinkId=? AND LOWER(COALESCE(normalizedPlatformSkuCode,platformSkuCode,''))=LOWER(?)").get(link.id, String(data.skuCode || "").trim()) : null;
    const erpSku = sku?.erpSkuId ? db.prepare("SELECT id FROM erp_skus WHERE id=?").get(sku.erpSkuId) : null;
    if (!link) errors.push({ exceptionType: "missing_link", severity: "error", message: "商品ID未匹配到链接资产。", entityType: "sales_import_row", entityId: String(row.rowNumber), rawData: { rowNumber: row.rowNumber, normalized: data } });
    else if (!sku) errors.push({ exceptionType: "missing_sku", severity: "error", message: "SKU未匹配到该链接的平台SKU关系。", entityType: "sales_import_row", entityId: String(row.rowNumber), rawData: { rowNumber: row.rowNumber, normalized: data } });
    else if (!erpSku) errors.push({ exceptionType: "missing_erp_sku", severity: "error", message: "平台SKU尚未精确关联ERP SKU。", entityType: "sales_import_row", entityId: String(row.rowNumber), rawData: { rowNumber: row.rowNumber, normalized: data } });
    else if (db.prepare("SELECT id FROM connection_sku_sales_facts WHERE salesLinkSkuId=? AND periodStart=? AND periodEnd=?").get(sku.id, data.periodStart, data.periodEnd)) errors.push({ exceptionType: "duplicate_data", severity: "error", message: "同一链接SKU及周期的销售事实已存在。", entityType: "sales_import_row", entityId: String(row.rowNumber), rawData: { rowNumber: row.rowNumber, normalized: data } });
  }
  return errors;
}

function responseFor(batch) {
  const sourceBatch = batch?.sourceBatchId ? readConnectionFoundationBatch(batch.sourceBatchId) : null;
  const exceptionCount = Number(batch?.exceptionCount || 0);
  return { dataSyncBatch: batch, importBatch: sourceBatch, summary: sourceBatch ? { ...summarize(sourceBatch), exceptionCount } : {}, isCurrent: batch?.status === "preview_ready", blocked: Boolean(exceptionCount && batch?.status === "preview_ready") };
}

export function previewSalesFactDataSync({ taskId, buffer, fileName, createdBy = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择真实销售Excel文件。");
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "sales_fact_excel_import") throw new Error("真实销售导入任务不存在。");
  const fileHash = digest(buffer);
  const existing = getDatabase().prepare("SELECT * FROM data_sync_batches WHERE taskId=? AND fileHash=? ORDER BY createdAt DESC LIMIT 1").get(task.id, fileHash);
  if (existing) return { ...responseFor(getDataSyncBatch(existing.id)), idempotent: true };

  const batch = createDataSyncBatch(task.id, { triggerMode: "manual", syncMode: "incremental", fileName, fileHash, createdBy });
  startDataSyncBatch(batch.id);
  try {
    const preview = previewConnectionDataImport({ buffer, fileName, importType: "erp_sales", userId: createdBy });
    const sourceBatch = preview.batch;
    getDatabase().prepare("UPDATE data_sync_batches SET periodStart=?,periodEnd=? WHERE id=?").run(sourceBatch.periodStart || null, sourceBatch.periodEnd || null, batch.id);
    const exceptions = unifiedExceptions(sourceBatch.id);
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchType: "connection_sales_import",
      sourceBatchId: sourceBatch.id,
      summary: summarize(sourceBatch),
      exceptions,
      requestStart: sourceBatch.periodStart,
      requestEnd: sourceBatch.periodEnd,
      message: "真实销售Excel解析预览已生成。",
    });
    return { dataSyncBatch, importBatch: sourceBatch, preview: preview.preview, summary: { ...summarize(sourceBatch), exceptionCount: exceptions.length }, rows: preview.rows, isCurrent: true, idempotent: false, blocked: preview.blocked || exceptions.some((item) => ["missing_link", "missing_sku", "missing_erp_sku", "duplicate_data"].includes(item.exceptionType)) };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "file_or_parse_error", message: error.message }] });
    throw error;
  }
}

export function readSalesFactDataSyncPreview(batchId) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || !["preview_ready", "superseded", "succeeded", "partial"].includes(batch.status) || batch.sourceBatchType !== "connection_sales_import") throw new Error("真实销售导入预览不存在。");
  return responseFor(batch);
}

export function commitSalesFactDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== "connection_sales_import" || !batch.sourceBatchId) throw new Error("同步批次未关联真实销售导入预览。");
  const blocking = getDatabase().prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND status='open' AND exceptionType IN ('missing_link','missing_sku','missing_erp_sku','duplicate_data')").get(batch.id).total;
  if (blocking) throw new Error(`当前预览存在 ${blocking} 条链接、SKU或重复事实异常，不能确认写入。`);
  try {
    const result = confirmConnectionDataImport(batch.sourceBatchId);
    const sourceBatch = readConnectionFoundationBatch(batch.sourceBatchId);
    const factCount = Number(getDatabase().prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts WHERE batchId=?").get(batch.sourceBatchId).total || 0);
    const status = Number(sourceBatch.errorRows || 0) ? "partial" : "succeeded";
    const dataSyncBatch = completeDataSyncBatch(batch.id, { status, totalCount: sourceBatch.totalRows, createdCount: factCount, exceptionCount: sourceBatch.errorRows, exceptions: [] });
    return { dataSyncBatch, importBatch: sourceBatch, result: { ...result.result, factsCreated: factCount }, summary: summarize(sourceBatch) };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}
