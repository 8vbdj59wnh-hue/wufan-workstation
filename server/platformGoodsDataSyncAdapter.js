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
import {
  commitWangdianPlatformGoodsSync,
  listWangdianShopMappings,
  previewWangdianPlatformGoodsSync,
  readWangdianPlatformGoodsSync,
} from "./wangdianPlatformGoodsSyncService.js";

function validateManualScope(scope = {}, triggerMode = "manual") {
  if (triggerMode !== "manual") return;
  const shopIds = Array.isArray(scope.shops) ? scope.shops.filter(Boolean) : [];
  const platforms = Array.isArray(scope.platforms) ? scope.platforms.filter(Boolean) : [];
  if (shopIds.length !== 1) throw new Error("请选择一个系统店铺后再生成平台SKU关系预览。");
  if (platforms.length !== 1) throw new Error("请选择平台后再生成平台SKU关系预览。");
  const mapping = listWangdianShopMappings().find((item) => item.status === "active" && item.shopId === shopIds[0]);
  if (!mapping) throw new Error("当前系统店铺尚未配置旺店通店铺编号，禁止生成同步预览。");
  if (String(mapping.platform || "").trim().toLocaleLowerCase("zh-CN") !== String(platforms[0]).trim().toLocaleLowerCase("zh-CN")) {
    throw new Error("所选平台与系统店铺不一致，禁止生成同步预览。");
  }
}

function requestRange(task, syncMode, requestStart, requestEnd) {
  const end = requestEnd || new Date().toISOString();
  if (syncMode === "full") {
    if (!requestStart) throw new Error("全量同步必须提供开始时间。");
    return { requestStart, requestEnd: end };
  }
  if (!task.lastSuccessAt) throw new Error("平台SKU关系尚无成功同步时间，请先完成一次全量同步。");
  return { requestStart: requestStart || task.lastSuccessAt, requestEnd: end };
}

function unifiedExceptions(items = []) {
  return items.map((item) => ({
    exceptionType: item.exceptionType,
    severity: item.exceptionType === "platform_restricted" ? "warning" : "error",
    message: item.message,
    entityType: item.platformSkuId ? "platform_sku" : item.platformGoodsId ? "platform_goods" : "shop",
    entityId: item.platformSkuId || item.platformGoodsId || item.shopNo || null,
    rawData: item.rawData,
  }));
}

function summary(log) {
  return {
    total: Number(log.sourceRowCount || 0),
    matched: Number(log.matchedCount || 0),
    created: Number(log.createdCount || 0),
    updated: Number(log.updatedCount || 0),
    exceptionCount: Number(log.exceptionCount || 0),
    pageCount: Number(log.pageCount || 0),
    canCommit: Boolean(log.canCommit),
  };
}

export async function previewPlatformGoodsDataSync({ taskId, resumeBatchId = "", syncMode = "", requestStart = null, requestEnd = null, scope = {}, triggerMode = "manual", createdBy = "", queryApi } = {}) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== "wangdian_platform_goods") throw new Error("平台货品关系同步任务不存在。");
  const existing = resumeBatchId ? getDataSyncBatch(resumeBatchId) : null;
  if (existing && existing.taskId !== task.id) throw new Error("续跑批次与平台货品关系同步任务不匹配。");
  const mode = existing?.syncMode || syncMode || task.defaultSyncMode;
  const range = existing ? { requestStart: existing.requestStart, requestEnd: existing.requestEnd } : requestRange(task, mode, requestStart, requestEnd);
  const effectiveScope = existing?.scope || scope;
  validateManualScope(effectiveScope, triggerMode);
  const batch = existing ? resumeDataSyncBatch(existing.id) : createDataSyncBatch(task.id, { triggerMode, syncMode: mode, ...range, scope: effectiveScope, createdBy });
  if (!existing) startDataSyncBatch(batch.id);
  try {
    const preview = await previewWangdianPlatformGoodsSync({
      dataSyncBatchId: batch.id,
      importMode: mode,
      startTime: range.requestStart,
      endTime: range.requestEnd,
      scope: effectiveScope,
      createdBy,
      ...(queryApi ? { queryApi } : {}),
    });
    const dataSyncBatch = markDataSyncBatchPreviewReady(batch.id, {
      sourceBatchType: "wangdian_platform_goods_sync",
      sourceBatchId: preview.id,
      summary: summary(preview),
      exceptions: unifiedExceptions(preview.exceptions),
      message: "旺店通平台SKU关系同步预览已生成。",
      ...range,
    });
    return { dataSyncBatch, platformSync: preview, summary: summary(preview), isCurrent: true };
  } catch (error) {
    interruptDataSyncBatch(batch.id, error);
    throw error;
  }
}

export function readPlatformGoodsDataSyncPreview(batchId) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || !["preview_ready", "superseded"].includes(batch.status) || batch.sourceBatchType !== "wangdian_platform_goods_sync" || !batch.sourceBatchId) throw new Error("平台SKU关系同步预览不存在或已结束。");
  const platformSync = readWangdianPlatformGoodsSync(batch.sourceBatchId);
  if (!platformSync) throw new Error("平台SKU关系同步底层预览不存在。");
  return { dataSyncBatch: batch, platformSync, summary: summary(platformSync), isCurrent: batch.status === "preview_ready" };
}

export function commitPlatformGoodsDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== "wangdian_platform_goods_sync" || !batch.sourceBatchId) throw new Error("同步预览未关联平台SKU关系批次。");
  try {
    const result = commitWangdianPlatformGoodsSync(batch.sourceBatchId);
    const dataSyncBatch = completeDataSyncBatch(batch.id, {
      status: "succeeded",
      totalCount: result.matchedCount,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
    });
    return { dataSyncBatch, platformSync: result, summary: summary(result) };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "commit_error", message: error.message }] });
    throw error;
  }
}

export async function runDuePlatformGoodsSyncTasks({ createdBy = "system-scheduler", queryApi } = {}) {
  const results = [];
  for (const task of listDueDataSyncTasks().filter((item) => item.taskCode === "wangdian_platform_goods")) {
    try {
      const preview = await previewPlatformGoodsDataSync({ taskId: task.id, syncMode: "incremental", triggerMode: "automatic", createdBy, ...(queryApi ? { queryApi } : {}) });
      results.push({ taskId: task.id, success: true, result: commitPlatformGoodsDataSync(preview.dataSyncBatch.id) });
    } catch (error) {
      results.push({ taskId: task.id, success: false, error: error.message });
    } finally {
      advanceDataSyncTaskSchedule(task.id, new Date());
    }
  }
  return results;
}
