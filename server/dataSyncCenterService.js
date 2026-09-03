import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const parseJson = (raw, fallback = {}) => { try { return JSON.parse(raw || "{}"); } catch { return fallback; } };
const now = () => new Date().toISOString();
const technicalRecordTypes = new Set(["image_download_warning", "erp_sku_row_warning", "source_audit", "disabled_erp_sku"]);
const normalBusinessTypes = new Set(["no_system_goods", "non_business_row"]);
const legacyStructureTypes = new Set(["combo_goods", "bundle_sku"]);

function normalizeBusinessException(item = {}, resolvedAt = now()) {
  const originalType = item.exceptionType || "data_error";
  const exceptionType = legacyStructureTypes.has(originalType) ? "missing_product_structure" : originalType;
  if (technicalRecordTypes.has(exceptionType)) return {
    ...item, exceptionType, status: "ignored", resolutionType: "technical_record",
    resolutionNote: "技术过程记录，不进入业务异常治理。", resolvedAt,
  };
  if (normalBusinessTypes.has(exceptionType)) return {
    ...item, exceptionType, status: "ignored", resolutionType: "normal_business",
    resolutionNote: "正常业务状态，不进入异常治理。", resolvedAt,
  };
  return { ...item, exceptionType, status: "open", resolutionType: null, resolutionNote: null, resolvedAt: null };
}

function insertBusinessException(db, batch, item, createdAt) {
  if (item.status !== "open") return false;
  db.prepare(`INSERT INTO data_sync_exceptions
    (id,taskId,batchId,exceptionType,severity,status,message,entityType,entityId,rawDataJson,resolutionType,resolutionNote,resolvedReason,createdAt,resolvedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `data-sync-exception-${crypto.randomUUID()}`, batch.taskId, batch.id, item.exceptionType,
    item.severity || "error", item.status, item.message || "同步数据异常", item.entityType || null,
    item.entityId || null, JSON.stringify(item.rawData || {}), item.resolutionType, item.resolutionNote,
    item.resolutionNote, createdAt, item.resolvedAt,
  );
  return true;
}

function decodeTask(row) {
  return row ? { ...row, config: parseJson(row.configJson), enabled: row.status === "enabled" } : null;
}

function decodeBatch(row) {
  return row ? { ...row, scope: parseJson(row.scopeJson), progress: parseJson(row.progressJson), totalCount: Number(row.totalCount || 0), createdCount: Number(row.createdCount || 0), updatedCount: Number(row.updatedCount || 0), invalidatedCount: Number(row.invalidatedCount || 0), exceptionCount: Number(row.exceptionCount || 0) } : null;
}

export function getDataSyncAnomalySummary({ database = getDatabase() } = {}) {
  const exceptionCounts = database.prepare(`SELECT
      COUNT(*) recordCount,
      COUNT(DISTINCT COALESCE(NULLIF(entityType,''),'unknown') || ':' || COALESCE(NULLIF(entityId,''),id)) businessObjectCount
    FROM data_sync_exceptions WHERE status='open'`).get();
  const exceptionTypes = database.prepare(`SELECT exceptionType,COUNT(*) recordCount,
      COUNT(DISTINCT COALESCE(NULLIF(entityType,''),'unknown') || ':' || COALESCE(NULLIF(entityId,''),id)) businessObjectCount
    FROM data_sync_exceptions WHERE status='open'
    GROUP BY exceptionType ORDER BY recordCount DESC,exceptionType`).all();
  const relationFacts = database.prepare(`WITH relation_status AS (
      SELECT linkSkuId,
        MAX(CASE WHEN status='active' THEN 1 ELSE 0 END) hasActive,
        MAX(CASE WHEN status='conflict' THEN 1 ELSE 0 END) hasConflict
      FROM sales_link_sku_sales_object_relations
      WHERE status IN ('active','conflict')
      GROUP BY linkSkuId
    ) SELECT
      SUM(CASE WHEN l.currentState='active' AND COALESCE(s.currentState,'active')='active'
        AND s.matchStatus='not_applicable' THEN 1 ELSE 0 END) notApplicable,
      SUM(CASE WHEN l.currentState='active' AND COALESCE(s.currentState,'active')='active'
        AND COALESCE(s.matchStatus,'pending')<>'not_applicable'
        AND COALESCE(r.hasActive,0)=0 AND COALESCE(r.hasConflict,0)=0 THEN 1 ELSE 0 END) masterDataIncomplete,
      SUM(CASE WHEN l.currentState='active' AND COALESCE(s.currentState,'active')='active'
        AND (COALESCE(s.matchStatus,'') IN ('conflict','relation_conflict')
          OR COALESCE(r.hasConflict,0)=1) THEN 1 ELSE 0 END) relationConflict,
      SUM(CASE WHEN l.currentState<>'active' OR COALESCE(s.currentState,'active')<>'active' THEN 1 ELSE 0 END) legacyHistorical
    FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
    LEFT JOIN relation_status r ON r.linkSkuId=s.id`).get();
  const classification = (code, label, businessObjectCount, isAnomaly) => ({
    code,
    label,
    recordCount: Number(businessObjectCount || 0),
    businessObjectCount: Number(businessObjectCount || 0),
    isAnomaly,
  });
  return {
    capability: "DataSyncAnomalySummary",
    contractVersion: "1.0",
    readOnly: true,
    openExceptions: {
      recordCount: Number(exceptionCounts?.recordCount || 0),
      businessObjectCount: Number(exceptionCounts?.businessObjectCount || 0),
      byType: exceptionTypes.map((item) => ({ ...item,
        recordCount: Number(item.recordCount || 0), businessObjectCount: Number(item.businessObjectCount || 0) })),
    },
    classifications: {
      notApplicable: classification("not_applicable", "正常无需ERP关系", relationFacts?.notApplicable, false),
      masterDataIncomplete: classification("master_data_incomplete", "当前主数据待完善", relationFacts?.masterDataIncomplete, true),
      relationConflict: classification("relation_conflict", "当前真实关系冲突", relationFacts?.relationConflict, true),
      legacyHistoricalAsset: classification("legacy_historical_asset", "Legacy历史资产", relationFacts?.legacyHistorical, false),
    },
    definitions: {
      recordCount: "异常记录行数；同一业务对象可能出现多条记录。",
      businessObjectCount: "按业务对象类型和对象ID去重后的数量。",
      masterDataIncomplete: "当前经营Link SKU尚无已生效正式关系；不等同于新旧关系冲突。",
      relationConflict: "当前经营Link SKU存在显式冲突关系或冲突状态。",
      legacyHistoricalAsset: "已退出当前经营范围的历史Link SKU资产，不计为当前关系冲突。",
    },
  };
}

function getDataSyncReadStatus(database, batches, salesDailyBatches, counts) {
  const latest = batches[0] || null;
  const latestResult = database.prepare(`SELECT b.id,b.status,b.completedAt,b.startedAt,b.createdAt,b.totalCount,b.createdCount,b.updatedCount,b.invalidatedCount,b.exceptionCount,t.taskCode,t.name taskName
    FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId
    WHERE b.status IN ('succeeded','partial','failed','interrupted')
    ORDER BY COALESCE(b.completedAt,b.startedAt,b.createdAt) DESC,b.id DESC LIMIT 1`).get() || null;
  const latestSuccessfulAt = database.prepare(`SELECT COALESCE(completedAt,startedAt,createdAt) value
    FROM data_sync_batches WHERE status IN ('succeeded','partial')
    ORDER BY COALESCE(completedAt,startedAt,createdAt) DESC,id DESC LIMIT 1`).get()?.value || null;
  const salesDataDate = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts").get()?.value || null;
  return {
    capability: "DataSyncReadStatus",
    contractVersion: "1.0",
    readOnly: true,
    latestSyncStatus: latest?.status || null,
    latestSyncTime: latest ? (latest.completedAt || latest.startedAt || latest.createdAt || null) : null,
    dataUpdatedAt: latestSuccessfulAt,
    salesDataDate,
    latestResult: latestResult ? {
      id: latestResult.id, taskCode: latestResult.taskCode, taskName: latestResult.taskName,
      status: latestResult.status, totalCount: Number(latestResult.totalCount || 0),
      createdCount: Number(latestResult.createdCount || 0), updatedCount: Number(latestResult.updatedCount || 0),
      invalidatedCount: Number(latestResult.invalidatedCount || 0), exceptionCount: Number(latestResult.exceptionCount || 0),
    } : null,
    latestSalesDailyResult: salesDailyBatches[0] || null,
    currentCounts: { ...counts },
  };
}

function getLatestSalesDailyReadResult(database) {
  const row = database.prepare(`SELECT id,fileName,status,periodStart,periodEnd,totalRows,matchedRows,pendingRows,errorRows,
      createdAt,updatedAt,completedAt,previewSummaryJson
    FROM connection_import_batches WHERE importType='erp_sales_daily_preview'
    ORDER BY createdAt DESC,id DESC LIMIT 1`).get();
  if (!row) return null;
  const factCommit = parseJson(row.previewSummaryJson).factCommit || null;
  return {
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    totalCount: Number(row.totalRows || 0),
    successfulCount: factCommit
      ? Number(factCommit.insertedCount || 0) + Number(factCommit.skippedCount || 0)
      : Number(row.matchedRows || 0),
    exceptionCount: Number(row.pendingRows || 0) + Number(row.errorRows || 0),
    governanceCount: Number(row.pendingRows || 0),
    insertedCount: Number(factCommit?.insertedCount || 0),
    skippedCount: Number(factCommit?.skippedCount || 0),
    updatePendingCount: Number(factCommit?.updatePendingCount || 0),
    syncedAt: row.completedAt || row.updatedAt || row.createdAt,
    createdAt: row.createdAt,
  };
}

export function getDataSyncCenterOverview({ batchLimit = 50, exceptionLimit = 50, includeAdministrativeDetails = true } = {}) {
  const db = getDatabase();
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM data_sync_tasks) taskCount,
    (SELECT COUNT(*) FROM data_sync_tasks WHERE status='enabled') enabledTaskCount,
    (SELECT COUNT(*) FROM data_sync_batches WHERE status IN ('queued','running','preview_ready','interrupted')) activeBatchCount,
    (SELECT COUNT(*) FROM data_sync_exceptions WHERE status='open') openExceptionCount
  `).get();
  if (!includeAdministrativeDetails) {
    const latestBatchRow = db.prepare(`SELECT b.*,t.name taskName,t.syncType,t.taskCode
      FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId
      ORDER BY b.createdAt DESC LIMIT 1`).get();
    const latestSalesDailyResult = getLatestSalesDailyReadResult(db);
    const anomalySummary = getDataSyncAnomalySummary({ database: db });
    return {
      capability: "DataSyncCenterOverview",
      contractVersion: "2.0",
      readOnly: true,
      readStatus: getDataSyncReadStatus(db, latestBatchRow ? [decodeBatch(latestBatchRow)] : [], latestSalesDailyResult ? [latestSalesDailyResult] : [], counts),
      anomalySummary,
    };
  }
  const tasks = db.prepare("SELECT * FROM data_sync_tasks ORDER BY transportType, name").all().map(decodeTask);
  const batches = db.prepare("SELECT b.*,t.name taskName,t.syncType,t.taskCode FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId ORDER BY b.createdAt DESC LIMIT ?").all(Math.min(200, Math.max(1, Number(batchLimit) || 50))).map(decodeBatch);
  const exceptions = db.prepare("SELECT e.*,t.name taskName FROM data_sync_exceptions e JOIN data_sync_tasks t ON t.id=e.taskId ORDER BY CASE e.status WHEN 'open' THEN 0 ELSE 1 END,e.createdAt DESC LIMIT ?").all(Math.min(200, Math.max(1, Number(exceptionLimit) || 50))).map((row) => ({ ...row, rawData: parseJson(row.rawDataJson) }));
  const salesDailyBatches = db.prepare(`SELECT b.id,b.fileName,b.status,b.periodStart,b.periodEnd,b.totalRows,b.matchedRows,b.pendingRows,b.errorRows,
      b.createdAt,b.updatedAt,b.completedAt,b.previewSummaryJson,
      SUM(CASE WHEN r.status='ready' THEN 1 ELSE 0 END) readyRowCount,
      SUM(CASE WHEN r.status IN ('pending_relation','missing_relation') THEN 1 ELSE 0 END) governanceRowCount,
      SUM(CASE WHEN r.status NOT IN ('ready','pending_relation','missing_relation','accounting_auxiliary','shipping_adjustment','other_adjustment','excluded') THEN 1 ELSE 0 END) exceptionRowCount
    FROM connection_import_batches b
    LEFT JOIN connection_import_rows r ON r.batchId=b.id
    WHERE b.importType='erp_sales_daily_preview'
    GROUP BY b.id
    ORDER BY b.createdAt DESC,b.id DESC LIMIT ?`).all(Math.min(200, Math.max(1, Number(batchLimit) || 50))).map((row) => {
      const summary = parseJson(row.previewSummaryJson);
      const factCommit = summary.factCommit || null;
      return {
        id: row.id,
        fileName: row.fileName,
        status: row.status,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        totalCount: Number(row.totalRows || 0),
        successfulCount: factCommit
          ? Number(factCommit.insertedCount || 0) + Number(factCommit.skippedCount || 0)
          : Number(row.readyRowCount || 0),
        exceptionCount: Number(row.governanceRowCount || 0) + Number(row.exceptionRowCount || 0),
        governanceCount: Number(row.governanceRowCount || 0),
        insertedCount: Number(factCommit?.insertedCount || 0),
        skippedCount: Number(factCommit?.skippedCount || 0),
        updatePendingCount: Number(factCommit?.updatePendingCount || 0),
        syncedAt: row.completedAt || row.updatedAt || row.createdAt,
        createdAt: row.createdAt,
      };
    });
  const legacy = {
    erpSyncRuns: db.prepare("SELECT COUNT(*) total FROM erp_sync_runs").get().total,
    wangdianGoodsLogs: db.prepare("SELECT COUNT(*) total FROM wangdian_goods_sync_logs").get().total,
    erpImportBatches: db.prepare("SELECT COUNT(*) total FROM erp_import_batches").get().total,
  };
  const salesShops = db.prepare("SELECT id,platform,shopName,displayName,status FROM sales_shops WHERE status='active' ORDER BY platform,displayName").all();
  const wangdianShopMappings = db.prepare(`SELECT m.*,s.platform,s.shopName,s.displayName FROM wangdian_shop_mappings m JOIN sales_shops s ON s.id=m.shopId ORDER BY m.wangdianShopNo`).all();
  const latestShopDiscoveryBatch = db.prepare(`SELECT id,status,targetShopId,currentPage,totalPages,totalRows,readRows,errorMessage,createdAt,updatedAt FROM wangdian_shop_discovery_batches ORDER BY createdAt DESC LIMIT 1`).get() ?? null;
  const anomalySummary = getDataSyncAnomalySummary({ database: db });
  const readModel = { capability: "DataSyncCenterOverview", contractVersion: "2.0", readOnly: true,
    readStatus: getDataSyncReadStatus(db, batches, salesDailyBatches, counts), anomalySummary };
  return { ...readModel,
    tasks, batches, exceptions, salesDailyBatches, latestSalesDailyBatch: salesDailyBatches[0] || null,
    legacy, counts, salesShops, wangdianShopMappings, latestShopDiscoveryBatch };
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

export function getLatestDataSyncWatermark(taskId) {
  return getDatabase().prepare(`SELECT COALESCE(NULLIF(requestEnd,''),completedAt) value
    FROM data_sync_batches WHERE taskId=? AND status IN ('succeeded','partial')
      AND COALESCE(NULLIF(requestEnd,''),completedAt) IS NOT NULL
    ORDER BY COALESCE(completedAt,createdAt) DESC,id DESC LIMIT 1`).get(taskId)?.value ?? null;
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
    const rawItems = exceptions.length ? exceptions : Number(summary.exceptionCount || 0) || Number(summary.invalid || 0) + Number(summary.error || 0)
      ? [{ exceptionType: "data_validation", severity: "error", message: `同步预览存在 ${Number(summary.exceptionCount || 0) || Number(summary.invalid || 0) + Number(summary.error || 0)} 项校验异常。`, rawData: summary }]
      : [];
    const items = rawItems.map((item) => normalizeBusinessException(item, completedAt));
    const exceptionCount = items.filter((item) => item.status === "open").length;
    db.prepare("UPDATE data_sync_batches SET status='superseded' WHERE taskId=? AND status='preview_ready' AND id<>?").run(batch.taskId, batchId);
    db.prepare(`UPDATE data_sync_batches SET status='preview_ready',requestStart=COALESCE(?,requestStart),requestEnd=COALESCE(?,requestEnd),totalCount=?,createdCount=?,updatedCount=?,exceptionCount=?,sourceBatchType=?,sourceBatchId=?,completedAt=NULL WHERE id=?`).run(
      requestStart, requestEnd, Number(summary.total || 0), Number(summary.created || 0), Number(summary.updated || 0), exceptionCount, sourceBatchType, sourceBatchId, batchId,
    );
    db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
      `data-sync-log-${crypto.randomUUID()}`, batchId, exceptionCount ? "warn" : "info", "preview_ready", message, JSON.stringify({ sourceBatchType, sourceBatchId, summary }), completedAt,
    );
    for (const item of items) insertBusinessException(db, batch, item, completedAt);
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

export function interruptDataSyncBatch(batchId, error) {
  const db = getDatabase();
  const interruptedAt = now();
  const message = error?.message || String(error || "同步读取中断。");
  const result = db.prepare("UPDATE data_sync_batches SET status='interrupted',errorMessage=?,completedAt=? WHERE id=? AND status='running'").run(message, interruptedAt, batchId);
  if (!result.changes) throw new Error("同步批次不存在或当前状态不可中断。");
  db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
    `data-sync-log-${crypto.randomUUID()}`, batchId, "error", "batch_interrupted", "同步读取中断，断点已保留。", JSON.stringify({ message }), interruptedAt,
  );
  return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
}

export function resumeDataSyncBatch(batchId) {
  const db = getDatabase();
  const resumedAt = now();
  const batch = db.prepare("SELECT b.*,t.status taskStatus FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId WHERE b.id=?").get(batchId);
  if (!batch || batch.status !== "interrupted") throw new Error("同步批次不存在或当前状态不可续跑。");
  if (batch.taskStatus !== "enabled") throw new Error("同步任务已暂停，请先启用后再续跑。");
  db.prepare("UPDATE data_sync_batches SET status='running',errorMessage=NULL,completedAt=NULL WHERE id=?").run(batchId);
  db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
    `data-sync-log-${crypto.randomUUID()}`, batchId, "info", "batch_resumed", "同步批次从断点继续执行。", batch.progressJson || "{}", resumedAt,
  );
  return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
}

export function completeDataSyncBatch(batchId, result = {}) {
  const db = getDatabase();
  const status = ["succeeded", "partial", "failed"].includes(result.status) ? result.status : "succeeded";
  const completedAt = now();
  return db.transaction(() => {
    const batch = db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId);
    if (!batch || !["queued", "running", "preview_ready"].includes(batch.status)) throw new Error("同步批次不存在或已结束。");
    const exceptions = (Array.isArray(result.exceptions) ? result.exceptions : []).map((item) => normalizeBusinessException(item, completedAt));
    const businessExceptionCount = exceptions.filter((item) => item.status === "open").length;
    db.prepare(`UPDATE data_sync_batches SET status=?,totalCount=?,createdCount=?,updatedCount=?,invalidatedCount=?,exceptionCount=?,errorMessage=?,startedAt=COALESCE(startedAt,?),completedAt=? WHERE id=?`).run(
      status, Number(result.totalCount || 0), Number(result.createdCount || 0), Number(result.updatedCount || 0), Number(result.invalidatedCount || 0), exceptions.length ? businessExceptionCount : Number(result.exceptionCount || 0), result.errorMessage || null, completedAt, completedAt, batchId,
    );
    for (const item of exceptions) insertBusinessException(db, batch, item, completedAt);
    db.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
      `data-sync-log-${crypto.randomUUID()}`, batchId, status === "failed" ? "error" : "info", "batch_completed", status === "succeeded" ? "同步批次执行成功。" : status === "partial" ? "同步批次部分成功。" : "同步批次执行失败。", JSON.stringify(result), completedAt,
    );
    if (["succeeded", "partial"].includes(status)) {
      const watermark = batch.requestEnd || completedAt;
      db.prepare("UPDATE data_sync_tasks SET lastSuccessAt=?,updatedAt=? WHERE id=?").run(watermark, completedAt, batch.taskId);
    }
    return decodeBatch(db.prepare("SELECT * FROM data_sync_batches WHERE id=?").get(batchId));
  }).immediate();
}

export function resolveDataSyncException(exceptionId, { note = "", resolvedBy = "" } = {}) {
  const db = getDatabase();
  const result = db.prepare("UPDATE data_sync_exceptions SET status='resolved',resolutionNote=?,resolvedReason=?,resolvedAt=?,resolvedBy=? WHERE id=? AND status='open'").run(note || null, note || null, now(), resolvedBy || null, exceptionId);
  if (!result.changes) throw new Error("异常不存在或已处理。");
  return db.prepare("SELECT * FROM data_sync_exceptions WHERE id=?").get(exceptionId);
}
