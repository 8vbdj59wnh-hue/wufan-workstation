import assert from "node:assert/strict";
import path from "node:path";
import { performance } from "node:perf_hooks";

const databasePath = path.resolve(process.argv[2] || "");
assert(databasePath, "请提供隔离数据库路径");
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { resolveLinkSkuRelationsForRead } = await import("../server/capabilities/resolveLinkSkuRelationRead.js");

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};
const round = (value) => Number(value.toFixed(3));

try {
  initializeDatabase({ reset: false });
  const database = getDatabase();
  database.pragma("query_only=ON");
  const protectedCounts = () => ({
    dailyFacts: Number(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total),
    mappings: Number(database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total),
    salesObjects: Number(database.prepare("SELECT COUNT(*) total FROM sales_objects").get().total),
    salesObjectRelations: Number(database.prepare("SELECT COUNT(*) total FROM sales_link_sku_sales_object_relations").get().total),
    salesObjectStructures: Number(database.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total),
    salesObjectComponents: Number(database.prepare("SELECT COUNT(*) total FROM sales_object_structure_components").get().total),
  });
  const before = protectedCounts();
  const allIds = database.prepare("SELECT linkSkuId FROM sales_link_sku_sales_object_relations WHERE status='active' ORDER BY linkSkuId")
    .all().map((row) => row.linkSkuId);
  const ids = allIds.slice(0, 1000);
  assert(ids.length > 0, "隔离数据库没有active Sales Object关系");

  let formalOldQueries = 0;
  let formalNewQueries = 0;
  const formal = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, {
    database,
    scope: "linkDetail",
    onOldQuery: () => { formalOldQueries += 1; },
    onNewQuery: () => { formalNewQueries += 1; },
  });
  assert.equal(formalOldQueries, 0);
  assert(formalNewQueries > 0);
  assert(Object.values(formal.results).every((row) => row.resolverSource === "sales_object"));

  let shadowOldQueries = 0;
  const shadow = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, {
    database,
    scope: "resolverDiagnostic",
    shadowCompare: true,
    logDifference: () => {},
    onOldQuery: () => { shadowOldQueries += 1; },
  });
  assert(shadowOldQueries > 0);
  assert.deepEqual(shadow.results, formal.results, "Shadow Compare不得改变正式结果");

  const fullShadowSummary = { total: 0, consistent: 0, different: 0, byType: { consistent: 0, added: 0, reduced: 0, conflict: 0 } };
  let fullShadowOldQueries = 0;
  for (let offset = 0; offset < allIds.length; offset += 500) {
    const batch = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: allIds.slice(offset, offset + 500) }, {
      database,
      scope: "resolverDiagnostic",
      shadowCompare: true,
      logDifference: () => {},
      onOldQuery: () => { fullShadowOldQueries += 1; },
    });
    fullShadowSummary.total += batch.diagnostics.total;
    fullShadowSummary.consistent += batch.diagnostics.consistent;
    fullShadowSummary.different += batch.diagnostics.different;
    for (const type of Object.keys(fullShadowSummary.byType)) fullShadowSummary.byType[type] += batch.diagnostics.byType[type];
  }
  assert.equal(fullShadowSummary.total, allIds.length);
  assert.equal(fullShadowSummary.byType.reduced, 0);
  assert.equal(fullShadowSummary.byType.conflict, 0);

  const formalTimings = [];
  const shadowTimings = [];
  for (let index = 0; index < 8; index += 1) {
    let started = performance.now();
    resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, { database, scope: "linkDetail" });
    formalTimings.push(performance.now() - started);
    started = performance.now();
    resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, { database, scope: "resolverDiagnostic", shadowCompare: true, logDifference: () => {} });
    shadowTimings.push(performance.now() - started);
  }

  const salesObjectOnly = database.prepare(`SELECT r.linkSkuId
    FROM sales_link_sku_sales_object_relations r
    WHERE r.status='active'
      AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=r.linkSkuId AND m.currentState='active')
    ORDER BY r.linkSkuId LIMIT 10`).all().map((row) => row.linkSkuId);
  const salesObjectOnlyRead = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: salesObjectOnly }, { database, scope: "linkDetail" });
  assert(Object.values(salesObjectOnlyRead.results).every((row) => row.resolverSource === "sales_object" && row.isUsable));

  const metrics = database.prepare(`SELECT COUNT(*) facts,COALESCE(SUM(salesAmount),0) salesAmount,COALESCE(SUM(profitAmount),0) profitAmount
    FROM connection_sku_sales_daily_facts`).get();
  const after = protectedCounts();
  assert.deepEqual(after, before);
  const formalP50 = percentile(formalTimings, 0.5);
  const shadowP50 = percentile(shadowTimings, 0.5);
  const output = {
    success: true,
    databasePath,
    activeRelationCount: allIds.length,
    performanceSampleSize: ids.length,
    formalRead: { oldQueries: formalOldQueries, newQueries: formalNewQueries, resolverSource: "sales_object" },
    shadowCompare: {
      oldQueries: fullShadowOldQueries,
      summary: { mode: shadow.diagnostics.mode, ...fullShadowSummary },
    },
    salesObjectOnly: { sampleCount: salesObjectOnly.length, salesLinkSkuIds: salesObjectOnly, allUsable: true },
    performance: {
      formalP50Ms: round(formalP50),
      formalP95Ms: round(percentile(formalTimings, 0.95)),
      shadowP50Ms: round(shadowP50),
      shadowP95Ms: round(percentile(shadowTimings, 0.95)),
      p50ReductionPercent: shadowP50 > 0 ? round((shadowP50 - formalP50) / shadowP50 * 100) : 0,
    },
    businessMetrics: { facts: Number(metrics.facts), salesAmount: Number(metrics.salesAmount), profitAmount: Number(metrics.profitAmount) },
    protectedBefore: before,
    protectedAfter: after,
    integrityCheck: database.pragma("integrity_check", { simple: true }),
    foreignKeyCheckErrors: database.pragma("foreign_key_check").length,
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  closeDatabase();
}
