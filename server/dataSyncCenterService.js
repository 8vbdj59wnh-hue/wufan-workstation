import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const parseJson = (raw, fallback = {}) => { try { return JSON.parse(raw || "{}"); } catch { return fallback; } };
const now = () => new Date().toISOString();

function decodeTask(row) {
  return row ? { ...row, config: parseJson(row.configJson), enabled: row.status === "enabled" } : null;
}

function decodeBatch(row) {
  return row ? { ...row, scope: parseJson(row.scopeJson), totalCount: Number(row.totalCount || 0), createdCount: Number(row.createdCount || 0), updatedCount: Number(row.updatedCount || 0), invalidatedCount: Number(row.invalidatedCount || 0), exceptionCount: Number(row.exceptionCount || 0) } : null;
}

export function getDataSyncCenterOverview({ batchLimit = 50, exceptionLimit = 50 } = {}) {
  const db = getDatabase();
  const tasks = db.prepare("SELECT * FROM data_sync_tasks ORDER BY transportType, name").all().map(decodeTask);
  const batches = db.prepare("SELECT b.*,t.name taskName,t.syncType FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId ORDER BY b.createdAt DESC LIMIT ?").all(Math.min(200, Math.max(1, Number(batchLimit) || 50))).map(decodeBatch);
  const exceptions = db.prepare("SELECT e.*,t.name taskName FROM data_sync_exceptions e JOIN data_sync_tasks t ON t.id=e.taskId ORDER BY CASE e.status WHEN 'open' THEN 0 ELSE 1 END,e.createdAt DESC LIMIT ?").all(Math.min(200, Math.max(1, Number(exceptionLimit) || 50))).map((row) => ({ ...row, rawData: parseJson(row.rawDataJson) }));
  const legacy = {
    erpSyncRuns: db.prepare("SELECT COUNT(*) total FROM erp_sync_runs").get().total,
    wangdianGoodsLogs: db.prepare("SELECT COUNT(*) total FROM wangdian_goods_sync_logs").get().total,
    erpImportBatches: db.prepare("SELECT COUNT(*) total FROM erp_import_batches").get().total,
  };
  const salesShops = db.prepare("SELECT id,platform,shopName,displayName,status FROM sales_shops WHERE status='active' ORDER BY platform,displayName").all();
  const wangdianShopMappings = db.prepare(`SELECT m.*,s.platform,s.shopName,s.displayName FROM wangdian_shop_mappings m JOIN sales_shops s ON s.id=m.shopId ORDER BY m.wangdianShopNo`).all();
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM data_sync_tasks) taskCount,
    (SELECT COUNT(*) FROM data_sync_tasks WHERE status='enabled') enabledTaskCount,
    (SELECT COUNT(*) FROM data_sync_batches WHERE status IN ('queued','running','preview_ready')) activeBatchCount,
    (SELECT COUNT(*) FROM data_sync_exceptions WHERE status='open') openExceptionCount
  `).get();
  return { tasks, batches, exceptions, legacy, counts, salesShops, wangdianShopMappings };
}

export function setDataSyncTaskStatus(taskId, status) {
  if (!["enabled", "paused"].includes(status)) throw new Error("同步任务状态无效。");
  const db = getDatabase();
  const task = decodeTask(db.prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
  if (!task) throw new Error("同步任务不存在。");
  const updatedAt = now();
  const nextRunAt = status === "enabled" && task.executionMode === "both" ? nextScheduledAt(task.scheduleCron, new Date(updatedAt)) : null;
  const result = db.prepare("UPDATE data_sync_tasks SET status=?,nextRunAt=?,updatedAt=? WHERE id=?").run(status, nextRunAt, updatedAt, taskId);
  if (!result.changes) throw new Error("同步任务不存在。");
  return decodeTask(db.prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
}

function nextScheduledAt(cron, reference = new Date()) {
  const match = String(cron || "").match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/u);
  if (!match) return null;
  const next = new Date(reference);
  next.setSeconds(0, 0);
  next.setHours(Number(match[2]), Number(match[1]), 0, 0);
  if (next <= reference) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function getDataSyncTask(taskId) {
  return decodeTask(getDatabase().prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
}

export function getDataSyncBatch(batchId) {
  return decodeBatch(getDatabase().prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
}

export function createManualDataSyncBatch(taskId, { syncMode = "", requestStart = null, requestEnd = null, createdBy = "" } = {}) {
  return createDataSyncBatch(taskId, { triggerMode: "manual", syncMode, requestStart, requestEnd, createdBy });
}

export function createDataSyncBatch(taskId, { triggerMode = "manual", syncMode = "", requestStart = null, requestEnd = null, fileName = null, fileHash = null, periodStart = null, periodEnd = null, scope = {}, createdBy = "" } = {}) {
  const db = getDatabase();
  const task = decodeTask(db.prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
  if (!task) throw new Error("同步任务不存在。");
  if (task.status !== "enabled") throw new Error("同步任务已暂停，请先启用。");
  const mode = syncMode || task.defaultSyncMode;
  if (!["full", "incremental"].includes(mode)) throw new Error("同步模式无效。");
  const createdAt = now();
  const batch = {
    id: `data-sync-batch-${crypto.randomUUID()}`, taskId, triggerMode, syncMode: mode, status: "queued",
    requestStart: requestStart || null, requestEnd: requestEnd || null, fileName: fileName || null, fileHash: fileHash || null, periodStart: periodStart || null, periodEnd: periodEnd || null, scopeJson: JSON.stringify(scope || {}), createdBy: createdBy || null, createdAt,
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO data_sync_batches (id,taskId,triggerMode,syncMode,status,requestStart,requestEnd,fileName,fileHash,periodStart,periodEnd,scopeJson,createdBy,createdAt) VALUES (@id,@taskId,@triggerMode,@syncMode,@status,@requestStart,@requestEnd,@fileName,@fileHash,@periodStart,@periodEnd,@scopeJson,@createdBy,@createdAt)`).run(batch);
    db.prepare(`INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)`).run(
      `data-sync-log-${crypto.randomUUID()}`, batch.id, "info", "batch_queued", "管理员已创建手动同步批次，等待对应同步适配器执行。", JSON.stringify({ taskCode: task.taskCode, syncMode: mode }), createdAt,
    );
  }).immediate();
  return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batch.id));
}

export function markDataSyncBatchPreviewReady(batchId, { sourceBatchType = "erp_import_batch", sourceBatchId, summary = {}, requestStart = null, requestEnd = null, exceptions = [], message = "同步预览已生成。" } = {}) {
  const db = getDatabase();
  const completedAt = now();
  return db.transaction(() => {
    const batch = db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId);
    if (!batch || !["queued", "running"].includes(batch.status)) throw new Error("同步批次不存在或当前状态不可生成预览。");
    const exceptionCount = exceptions.length || Number(summary.exceptionCount || 0) || Number(summary.invalid || 0) + Number(summary.error || 0);
    db.prepare("UPDATE data_sync_batches SET status='superseded' WHERE taskId=? AND status='preview_ready' AND id<>?").run(batch.taskId, batchId);
    db.prepare(`UPDATE data_sync_batches SET status='preview_ready',requestStart=COALESCE(?,requestStart),requestEnd=COALESCE(?,requestEnd),totalCount=?,createdCount=?,updatedCount=?,exceptionCount=?,sourceBatchType=?,sourceBatchId=?,completedAt=NULL WHERE id=?`).run(
      requestStart, requestEnd, Number(summary.total || 0), Number(summary.created || 0), Number(summary.updated || 0), exceptionCount, sourceBatchType, sourceBatchId, batchId,
    );
    db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
      `data-sync-log-${crypto.randomUUID()}`, batchId, exceptionCount ? "warn" : "info", "preview_ready", message, JSON.stringify({ sourceBatchType, sourceBatchId, summary }), completedAt,
    );
    const items = exceptions.length ? exceptions : exceptionCount ? [{ exceptionType: "data_validation", severity: "error", message: `同步预览存在 ${exceptionCount} 项校验异常。`, rawData: summary }] : [];
    for (const item of items) db.prepare(`INSERT INTO data_sync_exceptions (id,taskId,batchId,exceptionType,severity,status,message,entityType,entityId,rawDataJson,createdAt) VALUES (?,?,?,?,?,'open',?,?,?,?,?)`).run(
      `data-sync-exception-${crypto.randomUUID()}`, batch.taskId, batchId, item.exceptionType || "data_validation", item.severity || "error", item.message || "同步数据异常", item.entityType || null, item.entityId || null, JSON.stringify(item.rawData || {}), completedAt,
    );
    return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
  }).immediate();
}

export function assertCurrentDataSyncPreview(batchId) {
  const db = getDatabase();
  const batch = db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId);
  if (batch?.status === "superseded") throw new Error("该预览已被更新版本替代，请提交当前最新有效预览。");
  if (!batch || batch.status !== "preview_ready") throw new Error("当前同步批次不是可提交预览。");
  const current = db.prepare("SELECT id FROM data_sync_batches WHERE taskId=? AND status='preview_ready' ORDER BY createdAt DESC,id DESC LIMIT 1").get(batch.taskId);
  if (current?.id !== batch.id) throw new Error("该预览已被更新版本替代，请提交当前最新有效预览。");
  return decodeBatch(batch);
}

export function listDueDataSyncTasks(referenceAt = now()) {
  return getDatabase().prepare("SELECT * FROM data_sync_tasks WHERE status='enabled' AND executionMode='both' AND nextRunAt IS NOT NULL AND nextRunAt<=? ORDER BY nextRunAt").all(referenceAt).map(decodeTask);
}

export function advanceDataSyncTaskSchedule(taskId, referenceAt = new Date()) {
  const task = getDataSyncTask(taskId);
  if (!task) throw new Error("同步任务不存在。");
  const nextRunAt = nextScheduledAt(task.scheduleCron, referenceAt);
  getDatabase().prepare("UPDATE data_sync_tasks SET nextRunAt=?,updatedAt=? WHERE id=?").run(nextRunAt, now(), taskId);
  return nextRunAt;
}

export function startDataSyncBatch(batchId) {
  const db = getDatabase();
  const startedAt = now();
  const result = db.prepare("UPDATE data_sync_batches SET status='running',startedAt=? WHERE id=? AND status='queued'").run(startedAt, batchId);
  if (!result.changes) throw new Error("同步批次不存在或当前状态不可启动。");
  db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(`data-sync-log-${crypto.randomUUID()}`, batchId, "info", "batch_started", "同步批次开始执行。", "{}", startedAt);
  return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
}

export function completeDataSyncBatch(batchId, result = {}) {
  const db = getDatabase();
  const status = ["succeeded", "partial", "failed"].includes(result.status) ? result.status : "succeeded";
  const completedAt = now();
  return db.transaction(() => {
    const batch = db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId);
    if (!batch || !["queued", "running", "preview_ready"].includes(batch.status)) throw new Error("同步批次不存在或已结束。");
    const exceptions = Array.isArray(result.exceptions) ? result.exceptions : [];
    db.prepare(`UPDATE data_sync_batches SET status=?,totalCount=?,createdCount=?,updatedCount=?,invalidatedCount=?,exceptionCount=?,errorMessage=?,startedAt=COALESCE(startedAt,?),completedAt=? WHERE id=?`).run(
      status, Number(result.totalCount || 0), Number(result.createdCount || 0), Number(result.updatedCount || 0), Number(result.invalidatedCount || 0), Number(result.exceptionCount ?? exceptions.length), result.errorMessage || null, completedAt, completedAt, batchId,
    );
    for (const item of exceptions) {
      db.prepare(`INSERT INTO data_sync_exceptions (id,taskId,batchId,exceptionType,severity,status,message,entityType,entityId,rawDataJson,createdAt) VALUES (?,?,?,?,?,'open',?,?,?,?,?)`).run(
        `data-sync-exception-${crypto.randomUUID()}`, batch.taskId, batchId, item.exceptionType || "data_error", item.severity || "error", item.message || "同步数据异常", item.entityType || null, item.entityId || null, JSON.stringify(item.rawData || {}), completedAt,
      );
    }
    db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
      `data-sync-log-${crypto.randomUUID()}`, batchId, status === "failed" ? "error" : "info", "batch_completed", status === "succeeded" ? "同步批次执行成功。" : status === "partial" ? "同步批次部分成功。" : "同步批次执行失败。", JSON.stringify(result), completedAt,
    );
    if (status === "succeeded") db.prepare("UPDATE data_sync_tasks SET lastSuccessAt=?,updatedAt=? WHERE id=?").run(completedAt, completedAt, batch.taskId);
    return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
  }).immediate();
}

export function resolveDataSyncException(exceptionId, { note = "", resolvedBy = "" } = {}) {
  const db = getDatabase();
  const result = db.prepare("UPDATE data_sync_exceptions SET status='resolved',resolutionNote=?,resolvedAt=?,resolvedBy=? WHERE id=? AND status='open'").run(note || null, now(), resolvedBy || null, exceptionId);
  if (!result.changes) throw new Error("异常不存在或已处理。");
  return db.prepare("SELECT * FROM data_sync_exceptions WHERE id=?").get(exceptionId);
}
