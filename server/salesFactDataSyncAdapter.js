import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { readConnectionFoundationBatch } from "./connectionDataFoundationService.js";
import {
  assertCurrentDataSyncPreview,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncBatch,
  getDataSyncTask,
  markDataSyncBatchPreviewReady,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";
import {
  commitSalesDailyFacts,
  previewSalesDailyFacts,
  readSalesDailyFactPreview,
} from "./salesDailyFactPreviewService.js";

const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const parseJson = (raw) => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };
const SALES_FACT_PARSER_VERSION = "sales-fact-v4-daily-resolver";

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


function responseFor(batch) {
  const sourceBatch = batch?.sourceBatchId ? readConnectionFoundationBatch(batch.sourceBatchId) : null;
  const exceptionCount = Number(batch?.exceptionCount || 0);
  const parserVersion = parseJson(batch?.scopeJson).parserVersion;
  if (batch?.sourceBatchType === "sales_daily_preview" && sourceBatch) {
    const preview = readSalesDailyFactPreview(sourceBatch.id, { page: 1, pageSize: 50 });
    const daily = preview.summary || {};
    const summary = {
      ...daily,
      total: Number(daily.totalRows || 0),
      valid: Number(daily.readyRows || 0),
      exceptionCount,
      periodStart: daily.dateStart || null,
      periodEnd: daily.dateEnd || null,
      fileName: sourceBatch.fileName,
      fileHash: daily.sourceFileHash || sourceBatch.fileHash,
      parserVersion: daily.parserVersion || parserVersion,
    };
    return { dataSyncBatch: batch, importBatch: sourceBatch, preview, summary, rows: preview.rows, isCurrent: batch.status === "preview_ready", blocked: Number(summary.valid || 0) === 0 };
  }
  const summary = sourceBatch ? { ...summarize(sourceBatch), exceptionCount } : {};
  return { dataSyncBatch: batch, importBatch: sourceBatch, summary, isCurrent: batch?.status === "preview_ready", blocked: Boolean(exceptionCount && batch?.status === "preview_ready") };
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
    const preview = previewSalesDailyFacts({ buffer, fileName, createdBy });
    const sourceBatch = preview.batch;
    const dailySummary = preview.summary || {};
    const exceptionCount = Number(dailySummary.pendingRelationRows || 0) + Number(dailySummary.errorRows || 0);
    getDatabase().prepare("UPDATE data_sync_batches SET periodStart=?,periodEnd=? WHERE id=?").run(dailySummary.dateStart || null, dailySummary.dateEnd || null, batch.id);
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchType: "sales_daily_preview",
      sourceBatchId: sourceBatch.id,
      summary: {
        total: Number(dailySummary.totalRows || 0),
        created: Number(dailySummary.readyRows || 0),
        exceptionCount,
        dateStart: dailySummary.dateStart,
        dateEnd: dailySummary.dateEnd,
      },
      requestStart: dailySummary.dateStart,
      requestEnd: dailySummary.dateEnd,
      message: "链接利润表已按销售日报事实模型生成预览。",
    });
    return { ...responseFor(dataSyncBatch), idempotent: preview.idempotent };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "file_or_parse_error", message: error.message }] });
    throw error;
  }
}

export function readSalesFactDataSyncPreview(batchId) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || !["preview_ready", "superseded", "succeeded", "partial"].includes(batch.status) || !["sales_daily_preview", "connection_sales_import"].includes(batch.sourceBatchType)) throw new Error("真实销售导入预览不存在。");
  return responseFor(batch);
}

export function readCurrentSalesFactDataSyncPreview() {
  const task = getDatabase().prepare("SELECT id FROM data_sync_tasks WHERE taskCode='sales_fact_excel_import' AND status='enabled'").get();
  if (!task) return null;
  const batches = getDatabase().prepare("SELECT * FROM data_sync_batches WHERE taskId=? ORDER BY CASE status WHEN 'preview_ready' THEN 0 ELSE 1 END,createdAt DESC LIMIT 20").all(task.id);
  const batch = batches.find((item) => parseJson(item.scopeJson).parserVersion === SALES_FACT_PARSER_VERSION
    && ["preview_ready", "superseded", "succeeded", "partial"].includes(item.status)
    && item.sourceBatchType === "sales_daily_preview")
    || batches.find((item) => ["preview_ready", "superseded", "succeeded", "partial"].includes(item.status) && item.sourceBatchType === "connection_sales_import");
  return batch ? responseFor(batch) : null;
}

export function commitSalesFactDataSync(batchId) {
  const stored = getDataSyncBatch(batchId);
  if (stored?.sourceBatchType === "connection_sales_import") throw Object.assign(new Error("旧周期销售事实已进入只读状态，请先按销售日报模型重新解析。"), { code: "legacy_read_only" });
  if (stored?.sourceBatchType === "sales_daily_preview" && ["succeeded", "partial"].includes(stored.status)) {
    const committed = commitSalesDailyFacts(stored.sourceBatchId, { confirmedBy: stored.createdBy });
    return {
      dataSyncBatch: stored,
      importBatch: readConnectionFoundationBatch(stored.sourceBatchId),
      result: { ...committed.result, factsAffected: 0 },
      summary: responseFor(stored).summary,
    };
  }
  const batch = assertCurrentDataSyncPreview(batchId);
  if (!batch.sourceBatchId) throw new Error("同步批次未关联真实销售导入预览。");
  if (batch.sourceBatchType !== "sales_daily_preview") throw new Error("同步批次未关联销售日报预览。");
  try {
    const committed = commitSalesDailyFacts(batch.sourceBatchId, { confirmedBy: batch.createdBy });
    const result = committed.result;
    const sourceBatch = readConnectionFoundationBatch(batch.sourceBatchId);
    const exceptionCount = Number(result.blockedCount || 0) + Number(result.updatePendingCount || 0);
    const dataSyncBatch = completeDataSyncBatch(batch.id, {
      status: exceptionCount ? "partial" : "succeeded",
      totalCount: sourceBatch.totalRows,
      createdCount: result.insertedCount,
      updatedCount: 0,
      invalidatedCount: result.skippedCount,
      exceptionCount,
      exceptions: [],
    });
    return { dataSyncBatch, importBatch: sourceBatch, result: { ...result, factsAffected: result.insertedCount }, summary: responseFor(dataSyncBatch).summary };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}
