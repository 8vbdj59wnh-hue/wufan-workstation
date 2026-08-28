import {
  advanceDataSyncTaskSchedule,
  assertCurrentDataSyncPreview,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncBatch,
  getLatestDataSyncWatermark,
  getDataSyncTask,
  listDueDataSyncTasks,
  markDataSyncBatchPreviewReady,
  interruptDataSyncBatch,
  resumeDataSyncBatch,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";
import { commitErpV2Import, parseWangdianGoodsImport, readErpV2Import, validateErpV2Import } from "./productV2Import.js";
import { autoCreateProductProfilesForImportBatch } from "./erpSkuService.js";

function requestRange(task, syncMode, requestStart, requestEnd) {
  const end = requestEnd || new Date().toISOString();
  if (syncMode === "full") {
    if (!requestStart) throw new Error("全量同步必须提供开始时间。");
    return { requestStart, requestEnd: end };
  }
  const watermark = task.lastSuccessAt || getLatestDataSyncWatermark(task.id);
  if (!watermark) throw new Error("ERP货品尚无可用同步水位，请先完成一次全量同步。");
  return { requestStart: requestStart || watermark, requestEnd: end };
}

export async function previewErpGoodsDataSync({ taskId, resumeBatchId = "", syncMode = "", requestStart = null, requestEnd = null, triggerMode = "manual", createdBy = "", queryGoods } = {}) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "erp_goods") throw new Error("ERP货品同步任务不存在。");
  const existing = resumeBatchId ? getDataSyncBatch(resumeBatchId) : null;
  if (existing && existing.taskId !== task.id) throw new Error("续跑批次与ERP货品同步任务不匹配。");
  const mode = existing?.syncMode || syncMode || task.defaultSyncMode;
  const range = existing ? { requestStart: existing.requestStart, requestEnd: existing.requestEnd } : requestRange(task, mode, requestStart, requestEnd);
  const batch = existing ? resumeDataSyncBatch(existing.id) : createDataSyncBatch(task.id, { triggerMode, syncMode: mode, ...range, createdBy });
  if (!existing) startDataSyncBatch(batch.id);
  try {
    const parsed = await parseWangdianGoodsImport({
      dataSyncBatchId: batch.id,
      importMode: mode,
      query: { startTime: range.requestStart, endTime: range.requestEnd },
      createdBy,
      ...(queryGoods ? { queryGoods } : {}),
    });
    if (parsed.noChange) {
      const dataSyncBatch = completeDataSyncBatch(batch.id, {
        status: "succeeded",
        totalCount: 0,
        createdCount: 0,
        updatedCount: 0,
        invalidatedCount: 0,
        exceptionCount: 0,
      });
      return { ...parsed, dataSyncBatch };
    }
    const validated = validateErpV2Import(parsed.batch.id);
    const exceptions = (parsed.imageWarnings ?? []).map((warning) => ({
      exceptionType: "image_download_warning",
      severity: "warning",
      message: warning.message || "旺店通图片下载失败，已跳过该辅助字段。",
      entityType: "erp_sku",
      entityId: warning.merchantSkuCodes?.[0] || null,
      rawData: warning,
    }));
    exceptions.push(...(validated.exceptions ?? []), ...(validated.warnings ?? []));
    if (!validated.valid) throw new Error("旺店通返回数据中没有可解析的ERP SKU身份，批次已阻断。");
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchId: parsed.batch.id,
      summary: {
        ...validated.summary,
        exceptionCount: validated.summary.skipped,
        warningCount: Number(validated.summary.warnings || 0) + (parsed.imageWarnings?.length ?? 0),
      },
      exceptions,
      ...range,
      message: `ERP同步预览已生成：可导入 ${validated.summary.importable} 个SKU，隔离 ${validated.summary.skipped} 个异常SKU。`,
    });
    return {
      dataSyncBatch,
      importBatch: validated.batch,
      summary: {
        ...validated.summary,
        warningCount: Number(validated.summary.warnings || 0) + (parsed.imageWarnings?.length ?? 0),
      },
      preview: validated.preview,
      syncLog: parsed.syncLog,
    };
  } catch (error) {
    interruptDataSyncBatch(batch.id, error);
    error.dataSyncBatchId = batch.id;
    throw error;
  }
}

export function commitErpGoodsDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (!batch.sourceBatchId) throw new Error("同步预览未关联ERP导入批次。");
  try {
    const result = commitErpV2Import(batch.sourceBatchId);
    const summary = result.summary ?? {};
    let autoProfile;
    try {
      autoProfile = autoCreateProductProfilesForImportBatch(batch.sourceBatchId);
    } catch (error) {
      autoProfile = {
        enabled: true,
        attemptedCount: 0,
        createdCount: 0,
        failedCount: 1,
        created: [],
        failures: [{ merchantSkuCode: null, message: error.message || "自动建档执行失败。" }],
      };
    }
    const status = Number(summary.skipped || 0) > 0 ? "partial" : "succeeded";
    const dataSyncBatch = completeDataSyncBatch(batch.id, {
      status,
      totalCount: Number(summary.importedSkus || 0) + Number(summary.skipped || 0),
      createdCount: summary.created,
      updatedCount: summary.updated,
      invalidatedCount: summary.missingGoods || 0,
      exceptionCount: summary.skipped || 0,
      exceptions: [],
      autoProfile,
    });
    return { ...result, autoProfile, dataSyncBatch };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}

export function readErpGoodsDataSyncPreview(batchId) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || !["preview_ready", "superseded"].includes(batch.status) || !batch.sourceBatchId) throw new Error("ERP货品同步预览不存在或已结束。");
  const imported = readErpV2Import(batch.sourceBatchId);
  const isCurrent = batch.status === "preview_ready";
  const summary = { ...imported.summary, ...imported.batch.summaryJson };
  summary.warningCount = Number(summary.warnings || 0) + Number(summary.imageWarningCount || 0);
  return { dataSyncBatch: batch, importBatch: imported.batch, summary, preview: imported.preview, isCurrent };
}

export async function runDueErpGoodsSyncTasks({ createdBy = "system-scheduler", queryGoods } = {}) {
  const results = [];
  for (const task of listDueDataSyncTasks().filter((item) => item.taskCode === "erp_goods")) {
    try {
      const preview = await previewErpGoodsDataSync({ taskId: task.id, syncMode: "incremental", triggerMode: "automatic", createdBy, ...(queryGoods ? { queryGoods } : {}) });
      results.push({ taskId: task.id, success: true, result: preview.noChange ? preview : commitErpGoodsDataSync(preview.dataSyncBatch.id) });
    } catch (error) {
      let failedBatchId = error.dataSyncBatchId || null;
      if (!failedBatchId) {
        try {
          const failedBatch = createDataSyncBatch(task.id, {
            triggerMode: "automatic", syncMode: "incremental", requestStart: task.lastSuccessAt || null,
            requestEnd: new Date().toISOString(), createdBy,
          });
          failedBatchId = completeDataSyncBatch(failedBatch.id, { status: "failed", errorMessage: error.message }).id;
        } catch { /* 任务状态变化时保留原始失败结果 */ }
      }
      results.push({ taskId: task.id, batchId: failedBatchId, success: false, error: error.message });
    } finally {
      advanceDataSyncTaskSchedule(task.id, new Date());
    }
  }
  return results;
}
