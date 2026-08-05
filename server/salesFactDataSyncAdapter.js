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
const SALES_FACT_PARSER_VERSION = "sales-fact-v2";
const platformAliases = { tmall: ["tmall", "天猫"], "天猫": ["tmall", "天猫"], taobao: ["taobao", "淘宝"], "淘宝": ["taobao", "淘宝"], jd: ["jd", "京东"], "京东": ["jd", "京东"], xiaohongshu: ["xiaohongshu", "小红书"], "小红书": ["xiaohongshu", "小红书"] };

function findShop(db, platform, shopName) {
  const names = platformAliases[String(platform || "").trim().toLowerCase()] || [];
  const rows = names.length
    ? names.flatMap((platformName) => db.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
        WHERE LOWER(s.platform)=LOWER(?) AND (LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`).all(platformName, shopName, shopName, shopName))
    : db.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
        WHERE LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)`).all(shopName, shopName, shopName);
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function summarize(sourceBatch) {
  const preview = parseJson(sourceBatch.previewSummaryJson);
  return {
    total: Number(sourceBatch.totalRows || 0),
    valid: Number(sourceBatch.pendingRows || sourceBatch.matchedRows || 0),
    exceptionCount: Number(sourceBatch.errorRows || 0),
    periodStart: sourceBatch.periodStart || null,
    periodEnd: sourceBatch.periodEnd || null,
    fileName: sourceBatch.fileName,
    fileHash: preview.sourceFileHash || sourceBatch.fileHash,
    parserVersion: preview.parserVersion || null,
    ignoredSummaryRows: Number(preview.ignoredSummaryRows || 0),
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
    const sku = link ? db.prepare("SELECT id,systemGoodsType FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(link.id, String(data.platformSkuId || "").trim()) : null;
    const erpSku = db.prepare("SELECT id FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)").get(String(data.skuCode || "").trim());
    const mapping = sku && erpSku ? db.prepare("SELECT id FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND erpSkuId=? AND currentState='active'").get(sku.id, erpSku.id) : null;
    let exception = null;
    if (!link) exception = { exceptionType: "missing_link", message: shop ? "店铺与平台货品ID未匹配到链接资产。" : "店铺未精确匹配到系统店铺。" };
    else if (!sku) exception = { exceptionType: "missing_platform_sku", message: "平台规格ID未匹配到该链接的平台SKU。" };
    else if (String(sku.systemGoodsType || "").includes("组合")) exception = { exceptionType: "combo_goods", message: "组合商品需人工维护多ERP SKU关系，本次预览已隔离。" };
    else if (!erpSku) exception = { exceptionType: "missing_erp_sku", message: "ERP SKU编码未精确匹配到ERP主数据。" };
    else if (!mapping) exception = { exceptionType: "missing_erp_mapping", message: "平台SKU与ERP SKU的有效关系不存在。" };
    else if (db.prepare("SELECT id FROM connection_sku_sales_facts WHERE salesLinkSkuId=? AND erpSkuId=? AND periodStart=? AND periodEnd=?").get(sku.id, erpSku.id, data.periodStart, data.periodEnd)) exception = { exceptionType: "duplicate_data", message: "同一平台SKU、ERP SKU及周期的销售事实已存在。" };
    if (exception) {
      db.prepare("UPDATE connection_import_rows SET status='error',errorType=?,errorMessage=? WHERE id=?").run(exception.exceptionType, exception.message, row.id);
      errors.push({ ...exception, severity: "error", entityType: "sales_import_row", entityId: String(row.rowNumber), rawData: { rowNumber: row.rowNumber, normalized: data } });
    }
  }
  const counts = db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) valid,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) invalid FROM connection_import_rows WHERE batchId=?").get(sourceBatchId);
  db.prepare("UPDATE connection_import_batches SET status='validated',pendingRows=?,errorRows=?,updatedAt=? WHERE id=?").run(Number(counts.valid || 0), Number(counts.invalid || 0), new Date().toISOString(), sourceBatchId);
  return errors;
}

function responseFor(batch) {
  const sourceBatch = batch?.sourceBatchId ? readConnectionFoundationBatch(batch.sourceBatchId) : null;
  const exceptionCount = Number(batch?.exceptionCount || 0);
  const parserVersion = parseJson(batch?.scopeJson).parserVersion;
  const summary = sourceBatch ? { ...summarize(sourceBatch), exceptionCount } : {};
  return { dataSyncBatch: batch, importBatch: sourceBatch, summary, isCurrent: batch?.status === "preview_ready", blocked: parserVersion === SALES_FACT_PARSER_VERSION ? Number(summary.valid || 0) === 0 : Boolean(exceptionCount && batch?.status === "preview_ready") };
}

export function previewSalesFactDataSync({ taskId, buffer, fileName, createdBy = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择真实销售Excel文件。");
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "sales_fact_excel_import") throw new Error("真实销售导入任务不存在。");
  const sourceFileHash = digest(buffer);
  const fileHash = digest(Buffer.concat([buffer, Buffer.from(`\0${SALES_FACT_PARSER_VERSION}`)]));
  const existing = getDatabase().prepare("SELECT * FROM data_sync_batches WHERE taskId=? AND fileHash=? ORDER BY createdAt DESC").all(task.id, fileHash)
    .find((item) => parseJson(item.scopeJson).parserVersion === SALES_FACT_PARSER_VERSION);
  if (existing) return { ...responseFor(getDataSyncBatch(existing.id)), idempotent: true };

  const batch = createDataSyncBatch(task.id, { triggerMode: "manual", syncMode: "incremental", fileName, fileHash, scope: { parserVersion: SALES_FACT_PARSER_VERSION, sourceFileHash }, createdBy });
  startDataSyncBatch(batch.id);
  try {
    const preview = previewConnectionDataImport({ buffer, fileName, importType: "erp_sales", userId: createdBy, parserVersion: SALES_FACT_PARSER_VERSION });
    let sourceBatch = preview.batch;
    getDatabase().prepare("UPDATE data_sync_batches SET periodStart=?,periodEnd=? WHERE id=?").run(sourceBatch.periodStart || null, sourceBatch.periodEnd || null, batch.id);
    const exceptions = unifiedExceptions(sourceBatch.id);
    sourceBatch = readConnectionFoundationBatch(sourceBatch.id);
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchType: "connection_sales_import",
      sourceBatchId: sourceBatch.id,
      summary: summarize(sourceBatch),
      exceptions,
      requestStart: sourceBatch.periodStart,
      requestEnd: sourceBatch.periodEnd,
      message: "真实销售Excel解析预览已生成。",
    });
    const summary = { ...summarize(sourceBatch), exceptionCount: exceptions.length };
    return { dataSyncBatch, importBatch: sourceBatch, preview: preview.preview, summary, rows: listConnectionFoundationRows(sourceBatch.id), isCurrent: true, idempotent: false, blocked: Number(summary.valid || 0) === 0 };
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
  const parserVersion = parseJson(batch.scopeJson).parserVersion;
  const blocking = getDatabase().prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND status='open' AND exceptionType IN ('missing_link','missing_sku','missing_platform_sku','missing_erp_sku','missing_erp_mapping','combo_goods','duplicate_data')").get(batch.id).total;
  if (parserVersion !== SALES_FACT_PARSER_VERSION && blocking) throw new Error(`当前预览存在 ${blocking} 条链接、SKU或重复事实异常，不能确认写入。`);
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
