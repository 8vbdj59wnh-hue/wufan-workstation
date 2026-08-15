import { getDatabase } from "./db.js";

const linkTaskCodes = ["platform_operations", "sales_fact_excel_import", "platform_goods_excel_import", "wangdian_platform_goods"];
const successfulStatuses = new Set(["completed", "partial", "completed_with_errors", "completed_with_exceptions"]);
const activeStatuses = new Set(["waiting", "queued", "running"]);
const dailyHistoryLimit = 120;
const matrixCompletedStatuses = new Set(["completed", "succeeded"]);
const matrixPartialStatuses = new Set(["partial", "preview_ready", "completed_with_errors", "completed_with_exceptions"]);

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

function matrixCell(status, detail, extra = {}) {
  return { status, label: ({ completed: "已完成", partial: "部分未完成", missing: "未完成" })[status], detail, ...extra };
}

function getDailySourceMatrix(database, requestedShopId = "") {
  const shops = database.prepare(`SELECT s.id,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName) name
    FROM sales_shops s WHERE s.status='active' AND EXISTS (SELECT 1 FROM sales_links l WHERE l.shopId=s.id)
    ORDER BY s.platform,name,s.id`).all();
  const shopById = new Map(shops.map((item) => [item.id, item]));
  const selectedShopId = shopById.has(String(requestedShopId || "")) ? String(requestedShopId) : "";
  const expectedShops = selectedShopId ? [shopById.get(selectedShopId)] : shops;
  const expectedShopIds = new Set(expectedShops.map((item) => item.id));

  const platformRows = database.prepare(`SELECT l.shopId,substr(p.periodStart,1,10) startDate,substr(p.periodEnd,1,10) endDate,
      COUNT(*) rowCount,COUNT(DISTINCT p.salesLinkId) linkCount
    FROM connection_period_snapshots p JOIN sales_links l ON l.id=p.salesLinkId
    GROUP BY l.shopId,substr(p.periodStart,1,10),substr(p.periodEnd,1,10)`).all();
  const profitRows = database.prepare(`SELECT l.shopId,f.saleDate date,COUNT(*) rowCount,COUNT(DISTINCT f.salesLinkId) linkCount,
      COUNT(DISTINCT f.salesLinkSkuId) skuCount,MAX(f.updatedAt) updatedAt
    FROM connection_sku_sales_daily_facts f JOIN sales_links l ON l.id=f.salesLinkId
    GROUP BY l.shopId,f.saleDate`).all();
  const inventoryAttempts = database.prepare(`SELECT id,businessDate date,status,exceptionCount,
      COALESCE(completedAt,startedAt) updatedAt FROM wangdian_inventory_sync_batches
    WHERE status<>'superseded' ORDER BY updatedAt DESC,id DESC`).all();
  const goodsAttempts = database.prepare(`SELECT b.id,substr(COALESCE(b.requestEnd,b.completedAt,b.createdAt),1,10) date,
      b.status,b.exceptionCount,COALESCE(b.completedAt,b.startedAt,b.createdAt) updatedAt
    FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId
    WHERE t.taskCode='erp_goods' AND b.status<>'superseded' ORDER BY updatedAt DESC,b.id DESC`).all();

  const yesterday = addDays(shanghaiToday(), -1);
  const knownStartDate = minText([
    ...platformRows.map((item) => validDate(item.startDate)),
    ...profitRows.map((item) => validDate(item.date)),
    ...inventoryAttempts.map((item) => validDate(item.date)),
    ...goodsAttempts.map((item) => validDate(item.date)),
  ]);
  const startDate = maxText([knownStartDate || addDays(yesterday, -29), addDays(yesterday, -(dailyHistoryLimit - 1))]);
  const dates = startDate <= yesterday ? dateRange(startDate, yesterday) : [];
  const platformCoverage = new Map(dates.map((date) => [date, new Set()]));
  for (const item of platformRows) {
    const rangeStart = maxText([validDate(item.startDate), startDate]);
    const rangeEnd = minText([validDate(item.endDate), yesterday]);
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd || !expectedShopIds.has(item.shopId)) continue;
    for (const date of dateRange(rangeStart, rangeEnd)) platformCoverage.get(date)?.add(item.shopId);
  }
  const profitCoverage = new Map(dates.map((date) => [date, new Set()]));
  for (const item of profitRows) if (expectedShopIds.has(item.shopId)) profitCoverage.get(validDate(item.date))?.add(item.shopId);

  function shopScopedCell(coveredIds, sourceName) {
    const covered = expectedShops.filter((shop) => coveredIds?.has(shop.id));
    const missing = expectedShops.filter((shop) => !coveredIds?.has(shop.id));
    if (!expectedShops.length) return matrixCell("missing", `暂无可检查的店铺，${sourceName}无法判定`, { completedShopCount: 0, expectedShopCount: 0 });
    if (covered.length === expectedShops.length) return matrixCell("completed", selectedShopId ? `${expectedShops[0].name}已形成${sourceName}` : `${covered.length}/${expectedShops.length} 家店铺已完成`, { completedShopCount: covered.length, expectedShopCount: expectedShops.length });
    const missingNames = missing.slice(0, 5).map((shop) => `${shop.name}（${shop.platform}）`).join("、");
    const suffix = missing.length > 5 ? `等 ${missing.length} 家店铺` : missingNames;
    if (covered.length) return matrixCell("partial", `${covered.length}/${expectedShops.length} 家店铺已完成；未完成：${suffix}`, { completedShopCount: covered.length, expectedShopCount: expectedShops.length });
    return matrixCell("missing", selectedShopId ? `${expectedShops[0].name}未形成${sourceName}` : `0/${expectedShops.length} 家店铺已完成`, { completedShopCount: 0, expectedShopCount: expectedShops.length });
  }

  function globalCell(attempts, date, sourceName) {
    const attempt = attempts.find((item) => validDate(item.date) === date) || null;
    if (!attempt) return matrixCell("missing", `${sourceName}当日无成功更新记录`, { scope: "global" });
    const exceptionCount = Number(attempt.exceptionCount || 0);
    if (matrixCompletedStatuses.has(attempt.status) && exceptionCount === 0) return matrixCell("completed", `${sourceName}已完成（企业级数据源）`, { scope: "global", batchId: attempt.id, batchStatus: attempt.status });
    if (matrixPartialStatuses.has(attempt.status) || (matrixCompletedStatuses.has(attempt.status) && exceptionCount > 0) || activeStatuses.has(attempt.status)) {
      const reason = exceptionCount > 0 ? `，${exceptionCount} 项未完成` : "";
      return matrixCell("partial", `${sourceName}已执行${reason}`, { scope: "global", batchId: attempt.id, batchStatus: attempt.status });
    }
    return matrixCell("missing", `${sourceName}更新未完成（${attempt.status}）`, { scope: "global", batchId: attempt.id, batchStatus: attempt.status });
  }

  const rows = dates.map((date) => ({ date, sources: {
    platformLinks: shopScopedCell(platformCoverage.get(date), "平台链接数据"),
    linkProfit: shopScopedCell(profitCoverage.get(date), "链接利润数据"),
    wangdianInventory: globalCell(inventoryAttempts, date, "旺店通库存查询 API"),
    wangdianGoods: globalCell(goodsAttempts, date, "旺店通商品档案 API"),
  } })).reverse();
  const counts = { completed: 0, partial: 0, missing: 0 };
  for (const row of rows) for (const cell of Object.values(row.sources)) counts[cell.status] += 1;
  return {
    startDate, endDate: yesterday, selectedShopId, selectedShopName: selectedShopId ? shopById.get(selectedShopId)?.name : "全部店铺",
    shopOptions: shops, columns: [
      { key: "platformLinks", label: "平台链接数据表", scope: "shop" },
      { key: "linkProfit", label: "链接利润表", scope: "shop" },
      { key: "wangdianInventory", label: "旺店通库存查询 API", scope: "global" },
      { key: "wangdianGoods", label: "旺店通商品档案 API", scope: "global" },
    ], counts, rows,
  };
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

export function getLinkDataStatus({ includeDetails = false, shopId = "" } = {}) {
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
    dailySourceMatrix: getDailySourceMatrix(database, shopId),
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
