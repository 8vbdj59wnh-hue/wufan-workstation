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
import { resolveLinkSkuErpRelations } from "./capabilities/resolveLinkSkuErpRelation.js";

const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const parseJson = (raw) => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };
const SALES_FACT_PARSER_VERSION = "sales-fact-v3-v2-relation-resolution";
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

function resolveRelationsInBatches(db, salesLinkSkuIds, batchSize = 500) {
  const results = {};
  for (let offset = 0; offset < salesLinkSkuIds.length; offset += batchSize) {
    Object.assign(results, resolveLinkSkuErpRelations(
      { salesLinkSkuIds: salesLinkSkuIds.slice(offset, offset + batchSize) },
      { database: db },
    ).results);
  }
  return results;
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
  const validatedRows = rows.filter((item) => item.status === "validated").map((row) => {
    const data = parseJson(row.normalizedDataJson);
    const shop = findShop(db, data.platform, data.shop);
    const link = shop ? db.prepare("SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, String(data.platformGoodsId || "").trim()) : null;
    const sku = link ? db.prepare("SELECT id FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(link.id, String(data.platformSkuId || "").trim()) : null;
    const erpSku = db.prepare("SELECT id FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)").get(String(data.skuCode || "").trim());
    return { row, data, shop, link, sku, erpSku };
  });
  const relationSkuIds = [...new Set(validatedRows.filter((item) => item.sku && item.erpSku).map((item) => item.sku.id))];
  const relations = resolveRelationsInBatches(db, relationSkuIds);

  for (const { row, data, shop, link, sku, erpSku } of validatedRows) {
    const relation = sku ? relations[sku.id] : null;
    const targetMapping = erpSku ? relation?.mappings?.find((item) => item.erpSkuId === erpSku.id) : null;
    let exception = null;
    if (!link) exception = { exceptionType: "missing_link", message: shop ? "店铺与平台货品ID未匹配到链接资产。" : "店铺未精确匹配到系统店铺。" };
    else if (!sku) exception = { exceptionType: "missing_platform_sku", message: "平台规格ID未匹配到该链接的平台SKU。" };
    else if (!erpSku) exception = { exceptionType: "missing_erp_sku", message: "ERP SKU编码未精确匹配到ERP主数据。" };
    else if (relation?.relationStatus === "active_complete" && relation.isUsable && targetMapping) exception = null;
    else if (relation?.relationStatus === "active_complete") exception = {
      exceptionType: "erp_relation_conflict",
      message: "当前ERP SKU不在该链接SKU的完整active关系中，请核对组件组成。",
    };
    else if (relation?.relationStatus === "pending") exception = {
      exceptionType: "erp_relation_governance_pending",
      message: "链接SKU的ERP关系尚未确认，请先完成关系治理。",
    };
    else if (relation?.relationStatus === "missing") exception = {
      exceptionType: "missing_erp_mapping",
      message: "链接SKU当前没有正式ERP关系。",
    };
    else exception = {
      exceptionType: "erp_relation_conflict",
      message: relation?.conflicts?.map((item) => item.message).filter(Boolean).join("；") || "链接SKU的ERP关系不完整或存在冲突。",
    };
    if (exception) {
      db.prepare("UPDATE connection_import_rows SET status='error',errorType=?,errorMessage=? WHERE id=?").run(exception.exceptionType, exception.message, row.id);
      errors.push({
        ...exception,
        severity: "error",
        entityType: "sales_import_row",
        entityId: String(row.rowNumber),
        rawData: {
          rowNumber: row.rowNumber,
          normalized: data,
          relationStatus: relation?.relationStatus || null,
          relationshipShape: relation?.relationshipShape || null,
          relationConflictCodes: relation?.conflicts?.map((item) => item.code) || [],
        },
      });
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

export function readCurrentSalesFactDataSyncPreview() {
  const task = getDatabase().prepare("SELECT id FROM data_sync_tasks WHERE taskCode='sales_fact_excel_import' AND status='enabled'").get();
  if (!task) return null;
  const batches = getDatabase().prepare("SELECT * FROM data_sync_batches WHERE taskId=? ORDER BY CASE status WHEN 'preview_ready' THEN 0 ELSE 1 END,createdAt DESC LIMIT 20").all(task.id);
  const batch = batches.find((item) => parseJson(item.scopeJson).parserVersion === SALES_FACT_PARSER_VERSION
    && ["preview_ready", "superseded", "succeeded", "partial"].includes(item.status)
    && item.sourceBatchType === "connection_sales_import");
  return batch ? responseFor(batch) : null;
}

export function commitSalesFactDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== "connection_sales_import" || !batch.sourceBatchId) throw new Error("同步批次未关联真实销售导入预览。");
  const parserVersion = parseJson(batch.scopeJson).parserVersion;
  const blocking = getDatabase().prepare("SELECT COUNT(*) total FROM data_sync_exceptions WHERE batchId=? AND status='open' AND exceptionType IN ('missing_link','missing_sku','missing_platform_sku','missing_erp_sku','missing_erp_mapping','erp_relation_governance_pending','erp_relation_conflict','missing_product_structure','product_structure_review_pending','product_structure_conflict')").get(batch.id).total;
  if (parserVersion !== SALES_FACT_PARSER_VERSION && blocking) throw new Error(`当前预览存在 ${blocking} 条链接、SKU或重复事实异常，不能确认写入。`);
  try {
    const result = confirmConnectionDataImport(batch.sourceBatchId);
    const sourceBatch = readConnectionFoundationBatch(batch.sourceBatchId);
    const factCount = Number(getDatabase().prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts WHERE batchId=?").get(batch.sourceBatchId).total || 0);
    const status = Number(sourceBatch.errorRows || 0) ? "partial" : "succeeded";
    const dataSyncBatch = completeDataSyncBatch(batch.id, { status, totalCount: sourceBatch.totalRows, createdCount: factCount, exceptionCount: sourceBatch.errorRows, exceptions: [] });
    return { dataSyncBatch, importBatch: sourceBatch, result: { ...result.result, factsAffected: factCount }, summary: summarize(sourceBatch) };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}
