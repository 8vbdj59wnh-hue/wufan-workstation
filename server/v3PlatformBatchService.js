const clean = (value) => String(value ?? "").trim();

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function legacyBatch(database) {
  if (!tableExists(database, "erp_import_batches")) return null;
  const row = database.prepare(`SELECT id,businessDate,completedAt,createdAt,originalFilename fileName,NULL fileHash,importMode syncMode
    FROM erp_import_batches
    WHERE importType='platform_goods' AND status='completed'
      AND (importMode IS NULL OR trim(importMode)='' OR importMode='full')
    ORDER BY COALESCE(businessDate,substr(completedAt,1,10),substr(createdAt,1,10)) DESC,
             COALESCE(completedAt,createdAt) DESC LIMIT 1`).get();
  return row ? { ...row, source: "erp_import_batches", sortAt: row.completedAt || row.createdAt || row.businessDate || "" } : null;
}

function dataSyncBatch(database) {
  if (!tableExists(database, "data_sync_batches") || !tableExists(database, "data_sync_tasks")) return null;
  const rows = database.prepare(`SELECT b.id,b.periodEnd businessDate,b.completedAt,b.createdAt,b.fileName,b.fileHash,b.syncMode,b.totalCount,b.scopeJson,b.status
    FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId
    WHERE t.taskCode='platform_goods_excel_import' AND b.status='succeeded' AND b.syncMode='full'
    ORDER BY COALESCE(b.completedAt,b.createdAt) DESC,b.id DESC LIMIT 50`).all();
  const row = rows.find((candidate) => {
    let scope = {};
    try { scope = JSON.parse(candidate.scopeJson || "{}"); } catch { scope = {}; }
    if (scope.platformSnapshotMode === "full") return true;
    const names = Array.isArray(scope.sourceShopNames) ? scope.sourceShopNames.map(clean).filter(Boolean) : [];
    const businessNames = names.filter((name) => !/^(?:无效|总计|合计|汇总)[:：]?$/u.test(name.replace(/\s+/gu, "")));
    const hasSummaryRow = names.some((name) => /^(?:总计|合计|汇总)[:：]?$/u.test(name.replace(/\s+/gu, "")));
    return scope.shopMode === "excel_all" && businessNames.length > 1 && hasSummaryRow;
  });
  return row ? { ...row, source: "data_sync_batches", sortAt: row.completedAt || row.createdAt || row.businessDate || "" } : null;
}

function hasMaterializedCoverage(database, batch) {
  if (!batch || !tableExists(database, "sales_link_skus")) return true;
  const covered = tableExists(database, "platform_goods_excel_import_rows")
    ? Number(database.prepare(`SELECT COUNT(DISTINCT salesLinkSkuId) total
        FROM platform_goods_excel_import_rows
        WHERE batchId=? AND salesLinkSkuId IS NOT NULL AND trim(salesLinkSkuId)<>''`).get(batch.id)?.total || 0)
    : 0;
  if (covered > 0) return true;
  return batch.source === "data_sync_batches" && Number(batch.totalCount || 0) === 0;
}

export function getLatestCompletePlatformBatch(database) {
  const rows = [legacyBatch(database), dataSyncBatch(database)].filter((batch) => batch && hasMaterializedCoverage(database, batch));
  rows.sort((left, right) => clean(right.sortAt).localeCompare(clean(left.sortAt)) || clean(right.id).localeCompare(clean(left.id)));
  return rows[0] || null;
}

export default getLatestCompletePlatformBatch;
