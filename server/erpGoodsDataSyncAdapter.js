import {
  advanceDataSyncTaskSchedule,
  assertCurrentDataSyncPreview,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncBatch,
  getDataSyncTask,
  listDueDataSyncTasks,
  markDataSyncBatchPreviewReady,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";
import { commitErpV2Import, parseWangdianGoodsImport, readErpV2Import, validateErpV2Import } from "./productV2Import.js";

function requestRange(task, syncMode, requestStart, requestEnd) {
  const end = requestEnd || new Date().toISOString();
  if (syncMode === "full") {
    if (!requestStart) throw new Error("全量同步必须提供开始时间。");
    return { requestStart, requestEnd: end };
  }
  if (!task.lastSuccessAt) throw new Error("ERP货品尚无成功同步时间，请先完成一次全量同步。");
  return { requestStart: requestStart || task.lastSuccessAt, requestEnd: end };
}

export async function previewErpGoodsDataSync({ taskId, syncMode = "", requestStart = null, requestEnd = null, triggerMode = "manual", createdBy = "", queryGoods } = {}) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "erp_goods") throw new Error("ERP货品同步任务不存在。");
  const mode = syncMode || task.defaultSyncMode;
  const range = requestRange(task, mode, requestStart, requestEnd);
  const batch = createDataSyncBatch(task.id, { triggerMode, syncMode: mode, ...range, createdBy });
  startDataSyncBatch(batch.id);
  try {
    const parsed = await parseWangdianGoodsImport({
      dataSyncBatchId: batch.id,
      importMode: mode,
      query: { startTime: range.requestStart, endTime: range.requestEnd },
      createdBy,
      ...(queryGoods ? { queryGoods } : {}),
    });
    const validated = validateErpV2Import(parsed.batch.id);
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchId: parsed.batch.id,
      summary: validated.summary,
      ...range,
    });
    return { dataSyncBatch, importBatch: validated.batch, summary: validated.summary, preview: validated.preview, syncLog: parsed.syncLog };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "api_or_validation_error", message: error.message }] });
    throw error;
  }
}

export function commitErpGoodsDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (!batch.sourceBatchId) throw new Error("同步预览未关联ERP导入批次。");
  try {
    const result = commitErpV2Import(batch.sourceBatchId);
    const summary = result.summary ?? {};
    const status = Number(summary.errors || 0) > 0 ? "partial" : "succeeded";
    const dataSyncBatch = completeDataSyncBatch(batch.id, {
      status,
      totalCount: Number(summary.created || 0) + Number(summary.updated || 0) + Number(summary.unchanged || 0),
      createdCount: summary.created,
      updatedCount: summary.updated,
      invalidatedCount: summary.missingGoods || 0,
      exceptions: Number(summary.errors || 0) > 0 ? [{ exceptionType: "data_validation", message: `ERP同步提交存在 ${summary.errors} 项异常。` }] : [],
    });
    return { ...result, dataSyncBatch };
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
  return { dataSyncBatch: batch, importBatch: imported.batch, summary: { ...imported.summary, ...imported.batch.summaryJson }, preview: imported.preview, isCurrent };
}

export async function runDueErpGoodsSyncTasks({ createdBy = "system-scheduler", queryGoods } = {}) {
  const results = [];
  for (const task of listDueDataSyncTasks().filter((item) => item.taskCode === "erp_goods")) {
    try {
      const preview = await previewErpGoodsDataSync({ taskId: task.id, syncMode: "incremental", triggerMode: "automatic", createdBy, ...(queryGoods ? { queryGoods } : {}) });
      results.push({ taskId: task.id, success: true, result: commitErpGoodsDataSync(preview.dataSyncBatch.id) });
    } catch (error) {
      results.push({ taskId: task.id, success: false, error: error.message });
    } finally {
      advanceDataSyncTaskSchedule(task.id, new Date());
    }
  }
  return results;
}
