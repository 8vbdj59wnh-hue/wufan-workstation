import { getDatabase } from "./db.js";
import { getLatestCompletePlatformBatch } from "./v3PlatformBatchService.js";

const clean = (value) => String(value ?? "").trim();

export function resolveLinkOperatingContext(options = {}) {
  const database = options.database || getDatabase();
  const platformBatch = getLatestCompletePlatformBatch(database);
  return { platformBatch };
}

export function buildLinkOperatingScope(database, options = {}) {
  const alias = clean(options.alias) || "l";
  const context = resolveLinkOperatingContext({ ...options, database });
  // Link资产的当前有效性只由自身生命周期状态决定。平台批次仅用于溯源，
  // 不能替代currentState，否则增量文件或其他来源覆盖批次后会隐藏有效资产。
  const predicate = `${alias}.currentState='active'`;
  return { predicate, params: {}, context };
}

export function getLinkOperatingSummary(options = {}) {
  const database = options.database || getDatabase();
  const scope = buildLinkOperatingScope(database, { ...options, alias: "l", prefix: "linkOperatingSummary" });
  const platformPredicate = scope.context.platformBatch?.id
    ? `EXISTS (SELECT 1 FROM platform_goods_excel_import_rows r
        WHERE r.batchId=@linkOperatingSummaryBatchId AND r.salesLinkId=l.id)`
    : "0";
  const params = scope.context.platformBatch?.id
    ? { linkOperatingSummaryBatchId: scope.context.platformBatch.id }
    : {};
  const row = database.prepare(`SELECT COUNT(*) historicalAssetCount,
      SUM(CASE WHEN ${platformPredicate} THEN 1 ELSE 0 END) platformActiveCount,
      SUM(CASE WHEN ${scope.predicate} THEN 1 ELSE 0 END) operatingCount,
      SUM(CASE WHEN NOT (${scope.predicate}) THEN 1 ELSE 0 END) historicalCount
    FROM sales_links l`).get(params);
  return {
    historicalAssetCount: Number(row?.historicalAssetCount || 0),
    platformActiveCount: Number(row?.platformActiveCount || 0),
    operatingCount: Number(row?.operatingCount || 0),
    historicalCount: Number(row?.historicalCount || 0),
    platformBatch: scope.context.platformBatch,
  };
}
