import { getDatabase } from "./db.js";

const linkTaskCodes = ["platform_operations", "sales_fact_excel_import", "platform_goods_excel_import", "wangdian_platform_goods"];
const successfulStatuses = new Set(["completed", "partial", "completed_with_errors", "completed_with_exceptions"]);
const activeStatuses = new Set(["waiting", "queued", "running"]);
const dailyHistoryLimit = 120;

function maxText(values) { return values.filter(Boolean).sort().at(-1) ?? null; }
function minText(values) { return values.filter(Boolean).sort().at(0) ?? null; }
function validDate(value) { return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || "").slice(0, 10)) ? String(value).slice(0, 10) : null; }
function addDays(value, offset) {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);
}
function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dateRange(startDate, endDate) {
  const result = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) result.push(date);
  return result;
}

function getSalesDailyCompleteness(database) {
  const factBounds = database.prepare("SELECT MIN(saleDate) minDate,MAX(saleDate) maxDate FROM connection_sku_sales_daily_facts").get();
  const unifiedAttempts = database.prepare(`SELECT b.id,b.status,
      substr(COALESCE(b.periodStart,b.requestStart,b.periodEnd,b.requestEnd),1,10) startDate,
      substr(COALESCE(b.periodEnd,b.requestEnd,b.periodStart,b.requestStart),1,10) endDate,
      COALESCE(b.completedAt,b.startedAt,b.createdAt) updatedAt
    FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId
    WHERE t.taskCode='sales_fact_excel_import' ORDER BY updatedAt DESC,b.id DESC`).all();
  const legacyAttempts = database.prepare(`SELECT id,status,
      substr(COALESCE(periodStart,businessDate,periodEnd),1,10) startDate,
      substr(COALESCE(periodEnd,businessDate,periodStart),1,10) endDate,
      COALESCE(completedAt,updatedAt,createdAt) updatedAt
    FROM connection_import_batches WHERE importType IN ('erp_sales','erp_sales_daily_preview')
      OR sourceType IN ('erp_sales','erp_sales_daily_preview') ORDER BY updatedAt DESC,id DESC`).all();
  const attempts = [...unifiedAttempts, ...legacyAttempts].map((item) => ({ ...item,
    startDate: validDate(item.startDate), endDate: validDate(item.endDate) })).filter((item) => item.startDate || item.endDate)
    .map((item) => ({ ...item, startDate: item.startDate || item.endDate, endDate: item.endDate || item.startDate }))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const yesterday = addDays(shanghaiToday(), -1);
  const knownStartDate = minText([validDate(factBounds?.minDate), ...attempts.map((item) => item.startDate)]);
  const startDate = maxText([knownStartDate || addDays(yesterday, -29), addDays(yesterday, -(dailyHistoryLimit - 1))]);
  const factRows = startDate <= yesterday ? database.prepare(`SELECT saleDate,COUNT(*) rowCount,
      COUNT(DISTINCT salesLinkId) linkCount,COUNT(DISTINCT salesLinkSkuId) skuCount,
      SUM(salesAmount) salesAmount,MAX(updatedAt) updatedAt
    FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ? GROUP BY saleDate`).all(startDate, yesterday) : [];
  const factsByDate = new Map(factRows.map((item) => [item.saleDate, item]));
  const days = (startDate <= yesterday ? dateRange(startDate, yesterday) : []).map((date) => {
    const fact = factsByDate.get(date); const attempt = attempts.find((item) => item.startDate <= date && item.endDate >= date) || null;
    let status = "not_imported"; let reason = "未发现覆盖该日期的销售日报导入记录";
    if (fact) { status = "updated"; reason = "销售日报事实已形成"; }
    else if (attempt && activeStatuses.has(attempt.status)) { status = "updating"; reason = "覆盖该日期的销售日报正在更新"; }
    else if (attempt && ["failed", "interrupted"].includes(attempt.status)) { status = "update_failed"; reason = "覆盖该日期的最近一次导入未成功"; }
    else if (attempt && successfulStatuses.has(attempt.status)) { status = "imported_no_data"; reason = "导入批次覆盖该日期，但未形成销售日报事实"; }
    else if (attempt) { status = "pending"; reason = "已存在导入记录，但尚未完成更新"; }
    return { date, status, reason, rowCount: Number(fact?.rowCount || 0), linkCount: Number(fact?.linkCount || 0),
      skuCount: Number(fact?.skuCount || 0), salesAmount: fact?.salesAmount == null ? null : Number(fact.salesAmount),
      updatedAt: fact?.updatedAt || attempt?.updatedAt || null, batchId: attempt?.id || null, batchStatus: attempt?.status || null };
  }).reverse();
  const summary = days.reduce((result, item) => ({ ...result, [item.status]: Number(result[item.status] || 0) + 1 }), {});
  let consecutiveMissingDays = 0;
  for (const item of days) { if (item.status === "updated") break; consecutiveMissingDays += 1; }
  const updatedCount = Number(summary.updated || 0); const expectedDays = days.length;
  return { startDate, endDate: yesterday, limitedToDays: dailyHistoryLimit, expectedDays, updatedCount,
    issueCount: expectedDays - updatedCount, coverageRate: expectedDays ? updatedCount / expectedDays : null,
    consecutiveMissingDays, counts: { updated: updatedCount, notImported: Number(summary.not_imported || 0),
      importedNoData: Number(summary.imported_no_data || 0), updating: Number(summary.updating || 0),
      updateFailed: Number(summary.update_failed || 0), pending: Number(summary.pending || 0) },
    days, issues: days.filter((item) => item.status !== "updated") };
}

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
  const salesDataDate = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts").get()?.value ?? null;
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
    dailyCompleteness: getSalesDailyCompleteness(database),
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
