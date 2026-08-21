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
  const prefix = clean(options.prefix) || "linkOperating";
  const context = resolveLinkOperatingContext({ ...options, database });
  const params = {};
  if (context.platformBatch?.id) {
    params[`${prefix}BatchId`] = context.platformBatch.id;
  }
  const predicate = context.platformBatch?.id ? `${alias}.lastSeenBatchId=@${prefix}BatchId` : "0";
  return { predicate, params, context };
}

export function getLinkOperatingSummary(options = {}) {
  const database = options.database || getDatabase();
  const scope = buildLinkOperatingScope(database, { ...options, alias: "l", prefix: "linkOperatingSummary" });
  const platformPredicate = scope.context.platformBatch?.id
    ? "l.lastSeenBatchId=@linkOperatingSummaryBatchId"
    : "0";
  const row = database.prepare(`SELECT COUNT(*) historicalAssetCount,
      SUM(CASE WHEN ${platformPredicate} THEN 1 ELSE 0 END) platformActiveCount,
      SUM(CASE WHEN ${scope.predicate} THEN 1 ELSE 0 END) operatingCount,
      SUM(CASE WHEN NOT (${scope.predicate}) THEN 1 ELSE 0 END) historicalCount
    FROM sales_links l`).get(scope.params);
  return {
    historicalAssetCount: Number(row?.historicalAssetCount || 0),
    platformActiveCount: Number(row?.platformActiveCount || 0),
    operatingCount: Number(row?.operatingCount || 0),
    historicalCount: Number(row?.historicalCount || 0),
    platformBatch: scope.context.platformBatch,
  };
}
