import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const parseJson = (raw, fallback = {}) => { try { return JSON.parse(raw || "{}"); } catch { return fallback; } };
const now = () => new Date().toISOString();

function decodeTask(row) {
  return row ? { ...row, config: parseJson(row.configJson), enabled: row.status === "enabled" } : null;
}

function decodeBatch(row) {
  return row ? { ...row, totalCount: Number(row.totalCount || 0), createdCount: Number(row.createdCount || 0), updatedCount: Number(row.updatedCount || 0), invalidatedCount: Number(row.invalidatedCount || 0), exceptionCount: Number(row.exceptionCount || 0) } : null;
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
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM data_sync_tasks) taskCount,
    (SELECT COUNT(*) FROM data_sync_tasks WHERE status='enabled') enabledTaskCount,
    (SELECT COUNT(*) FROM data_sync_batches WHERE status IN ('queued','running')) activeBatchCount,
    (SELECT COUNT(*) FROM data_sync_exceptions WHERE status='open') openExceptionCount
  `).get();
  return { tasks, batches, exceptions, legacy, counts };
}

export function setDataSyncTaskStatus(taskId, status) {
  if (!["enabled", "paused"].includes(status)) throw new Error("同步任务状态无效。");
  const db = getDatabase();
  const result = db.prepare("UPDATE data_sync_tasks SET status=?,updatedAt=? WHERE id=?").run(status, now(), taskId);
  if (!result.changes) throw new Error("同步任务不存在。");
  return decodeTask(db.prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
}

export function createManualDataSyncBatch(taskId, { syncMode = "", requestStart = null, requestEnd = null, createdBy = "" } = {}) {
  const db = getDatabase();
  const task = decodeTask(db.prepare("SELECT * FROM data_sync_tasks WHERE id=?").get(taskId));
  if (!task) throw new Error("同步任务不存在。");
  if (task.status !== "enabled") throw new Error("同步任务已暂停，请先启用。");
  const mode = syncMode || task.defaultSyncMode;
  if (!["full", "incremental"].includes(mode)) throw new Error("同步模式无效。");
  const createdAt = now();
  const batch = {
    id: `data-sync-batch-${crypto.randomUUID()}`, taskId, triggerMode: "manual", syncMode: mode, status: "queued",
    requestStart: requestStart || null, requestEnd: requestEnd || null, createdBy: createdBy || null, createdAt,
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO data_sync_batches (id,taskId,triggerMode,syncMode,status,requestStart,requestEnd,createdBy,createdAt) VALUES (@id,@taskId,@triggerMode,@syncMode,@status,@requestStart,@requestEnd,@createdBy,@createdAt)`).run(batch);
    db.prepare(`INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)`).run(
      `data-sync-log-${crypto.randomUUID()}`, batch.id, "info", "batch_queued", "管理员已创建手动同步批次，等待对应同步适配器执行。", JSON.stringify({ taskCode: task.taskCode, syncMode: mode }), createdAt,
    );
  }).immediate();
  return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batch.id));
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
    if (!batch || !["queued", "running"].includes(batch.status)) throw new Error("同步批次不存在或已结束。");
    const exceptions = Array.isArray(result.exceptions) ? result.exceptions : [];
    db.prepare(`UPDATE data_sync_batches SET status=?,totalCount=?,createdCount=?,updatedCount=?,invalidatedCount=?,exceptionCount=?,errorMessage=?,startedAt=COALESCE(startedAt,?),completedAt=? WHERE id=?`).run(
      status, Number(result.totalCount || 0), Number(result.createdCount || 0), Number(result.updatedCount || 0), Number(result.invalidatedCount || 0), exceptions.length, result.errorMessage || null, completedAt, completedAt, batchId,
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
