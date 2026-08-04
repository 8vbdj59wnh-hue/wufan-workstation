import {
  advanceDataSyncTaskSchedule,
  assertCurrentDataSyncPreview,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncBatch,
  getDataSyncTask,
  listDueDataSyncTasks,
  markDataSyncBatchPreviewReady,
  interruptDataSyncBatch,
  resumeDataSyncBatch,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";
import { commitWangdianInventorySync, previewWangdianInventorySync, readWangdianInventorySyncBatch } from "./wangdianInventorySyncService.js";

function requestRange(task, syncMode, requestStart, requestEnd) {
  const end = requestEnd || new Date().toISOString();
  if (syncMode === "full") {
    if (!requestStart) throw new Error("全量同步必须提供开始时间。");
    return { requestStart, requestEnd: end };
  }
  if (!task.lastSuccessAt) throw new Error("库存尚无成功同步时间，请先完成一次全量同步。");
  return { requestStart: requestStart || task.lastSuccessAt, requestEnd: end };
}

function unifiedExceptions(items = []) {
  return items.map((item) => ({ exceptionType: item.exceptionType, severity: item.exceptionType === "cost_permission" ? "warning" : "error", message: item.message, entityType: item.specNo ? "erp_sku" : "warehouse", entityId: item.specNo || item.warehouseId || null, rawData: item.rawData }));
}

function summary(batch) {
  return { total: Number(batch.sourceRowCount || 0), matched: Number(batch.matchedCount || 0), created: Number(batch.createdCount || 0), updated: Number(batch.updatedCount || 0), unchanged: Number(batch.unchangedCount || 0), exceptionCount: Number(batch.exceptionCount || 0), pageCount: Number(batch.pageCount || 0), businessDate: batch.businessDate };
}

export async function previewInventoryDataSync({ taskId, resumeBatchId = "", syncMode = "", requestStart = null, requestEnd = null, businessDate = "", scope = {}, triggerMode = "manual", createdBy = "", queryApi } = {}) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "wangdian_inventory") throw new Error("库存同步任务不存在。");
  const existing = resumeBatchId ? getDataSyncBatch(resumeBatchId) : null;
  if (existing && existing.taskId !== task.id) throw new Error("续跑批次与库存同步任务不匹配。");
  const mode = existing?.syncMode || syncMode || task.defaultSyncMode;
  const range = existing ? { requestStart: existing.requestStart, requestEnd: existing.requestEnd } : requestRange(task, mode, requestStart, requestEnd);
  const effectiveScope = existing?.scope || scope;
  const batch = existing ? resumeDataSyncBatch(existing.id) : createDataSyncBatch(task.id, { triggerMode, syncMode: mode, ...range, scope: effectiveScope, createdBy });
  if (!existing) startDataSyncBatch(batch.id);
  try {
    const inventory = await previewWangdianInventorySync({ dataSyncBatchId: batch.id, importMode: mode, startTime: range.requestStart, endTime: range.requestEnd, businessDate: businessDate || String(range.requestEnd).slice(0, 10), specNos: effectiveScope.specNos, warehouseIds: effectiveScope.warehouseIds }, createdBy, queryApi);
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, { sourceBatchType: "wangdian_inventory_sync", sourceBatchId: inventory.id, summary: summary(inventory), exceptions: unifiedExceptions(inventory.exceptions), message: "旺店通库存同步预览已生成。", ...range });
    return { dataSyncBatch, inventorySync: inventory, summary: summary(inventory), isCurrent: true };
  } catch (error) {
    interruptDataSyncBatch(batch.id, error);
    throw error;
  }
}

export function readInventoryDataSyncPreview(batchId) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || !["preview_ready", "superseded"].includes(batch.status) || batch.sourceBatchType !== "wangdian_inventory_sync" || !batch.sourceBatchId) throw new Error("库存同步预览不存在或已结束。");
  const inventorySync = readWangdianInventorySyncBatch(batch.sourceBatchId);
  if (!inventorySync) throw new Error("库存同步底层预览不存在。");
  return { dataSyncBatch: batch, inventorySync, summary: summary(inventorySync), isCurrent: batch.status === "preview_ready" };
}

export function commitInventoryDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== "wangdian_inventory_sync" || !batch.sourceBatchId) throw new Error("同步预览未关联旺店通库存批次。");
  try {
    const result = commitWangdianInventorySync(batch.sourceBatchId);
    const dataSyncBatch = completeDataSyncBatch(batch.id, { status: "succeeded", totalCount: result.matchedCount, createdCount: result.createdCount, updatedCount: result.updatedCount });
    return { dataSyncBatch, inventorySync: result, summary: summary(result) };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}

export async function runDueInventorySyncTasks({ createdBy = "system-scheduler", queryApi } = {}) {
  const results = [];
  for (const task of listDueDataSyncTasks().filter((item) => item.taskCode === "wangdian_inventory")) {
    try {
      const preview = await previewInventoryDataSync({ taskId: task.id, syncMode: "incremental", triggerMode: "automatic", createdBy, ...(queryApi ? { queryApi } : {}) });
      results.push({ taskId: task.id, success: true, result: commitInventoryDataSync(preview.dataSyncBatch.id) });
    } catch (error) {
      results.push({ taskId: task.id, success: false, error: error.message });
    } finally {
      advanceDataSyncTaskSchedule(task.id, new Date());
    }
  }
  return results;
}
