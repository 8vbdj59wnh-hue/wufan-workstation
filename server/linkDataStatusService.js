import { getDatabase } from "./db.js";

const linkTaskCodes = ["platform_operations", "sales_fact_excel_import", "platform_goods_excel_import", "wangdian_platform_goods"];
const successfulStatuses = new Set(["completed", "partial", "completed_with_errors"]);
const activeStatuses = new Set(["waiting", "queued", "running"]);

function maxText(values) { return values.filter(Boolean).sort().at(-1) ?? null; }

function normalizeUnifiedBatch(row) {
  if (!row) return null;
  return {
    id: row.id, source: "data_sync", taskCode: row.taskCode, taskName: row.taskName,
    status: row.status, dataDate: maxText([row.periodEnd, row.requestEnd])?.slice(0, 10) ?? null,
    updatedAt: row.completedAt || row.startedAt || row.createdAt, exceptionCount: Number(row.exceptionCount || 0),
  };
}

function normalizeLegacyBatch(row) {
  if (!row) return null;
  return {
    id: row.id, source: "connection_import", taskCode: row.importType || row.sourceType, taskName: "链接经营数据导入",
    status: row.status, dataDate: maxText([row.periodEnd, row.businessDate])?.slice(0, 10) ?? null,
    updatedAt: row.completedAt || row.updatedAt || row.createdAt, exceptionCount: Number(row.errorRows || 0),
  };
}

export function getLinkDataStatus({ includeDetails = false } = {}) {
  const database = getDatabase();
  const taskPlaceholders = linkTaskCodes.map(() => "?").join(",");
  const unifiedRows = database.prepare(`SELECT b.*,t.taskCode,t.name taskName FROM data_sync_batches b
    JOIN data_sync_tasks t ON t.id=b.taskId WHERE t.taskCode IN (${taskPlaceholders}) ORDER BY b.createdAt DESC,b.id DESC`).all(...linkTaskCodes);
  const legacyRows = database.prepare(`SELECT * FROM connection_import_batches
    WHERE importType IS NOT NULL OR sourceType IN ('business_advisor','platform_operations') ORDER BY createdAt DESC,id DESC`).all();
  const batches = [...unifiedRows.map(normalizeUnifiedBatch), ...legacyRows.map(normalizeLegacyBatch)]
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const latestBatch = batches[0] ?? null;
  const latestSuccessfulBatch = batches.find((batch) => successfulStatuses.has(batch.status)) ?? null;
  const activeBatch = batches.find((batch) => activeStatuses.has(batch.status)) ?? null;
  const salesDataDate = database.prepare("SELECT MAX(substr(periodEnd,1,10)) value FROM connection_sku_sales_facts").get()?.value ?? null;
  const platformDataDate = database.prepare("SELECT MAX(substr(periodEnd,1,10)) value FROM connection_period_snapshots").get()?.value ?? null;
  const latestDataDate = maxText([salesDataDate, platformDataDate, latestSuccessfulBatch?.dataDate]);
  const openUnifiedExceptions = Number(database.prepare(`SELECT COUNT(*) count FROM data_sync_exceptions e
    JOIN data_sync_tasks t ON t.id=e.taskId WHERE e.status='open' AND t.taskCode IN (${taskPlaceholders})`).get(...linkTaskCodes)?.count || 0);
  const legacyExceptions = Number(database.prepare(`SELECT COUNT(*) count FROM connection_import_rows r JOIN connection_import_batches b ON b.id=r.batchId
    WHERE r.status='error' AND (b.importType IS NOT NULL OR b.sourceType IN ('business_advisor','platform_operations'))
      AND NOT EXISTS (SELECT 1 FROM data_sync_batches ds WHERE ds.sourceBatchId=b.id)`).get()?.count || 0);
  const exceptionCount = openUnifiedExceptions + legacyExceptions;
  let status = "no_data";
  if (activeBatch) status = "updating";
  else if (latestBatch && ["failed", "interrupted"].includes(latestBatch.status)
    && (!latestSuccessfulBatch || String(latestBatch.updatedAt) > String(latestSuccessfulBatch.updatedAt))) status = "failed";
  else if (latestSuccessfulBatch) status = exceptionCount > 0 ? "updated_with_exceptions" : "updated";
  const result = {
    latestDataDate,
    lastUpdatedAt: latestSuccessfulBatch?.updatedAt ?? null,
    status,
    statusLabel: ({ no_data: "暂无数据", updating: "更新中", failed: "更新失败", updated_with_exceptions: "已更新，有异常", updated: "已更新" })[status],
    hasExceptions: exceptionCount > 0,
    exceptionCount,
  };
  if (includeDetails) result.details = {
    latestBatch,
    latestSuccessfulBatch,
    activeBatch,
    dataDates: { sales: salesDataDate, platformOperations: platformDataDate },
    exceptionCounts: { unified: openUnifiedExceptions, legacy: legacyExceptions },
    recentBatches: batches.slice(0, 10),
  };
  return result;
}
