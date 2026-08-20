import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { runV3RelationMainChain } from "./v3RelationMainChainService.js";
import { readV3RelationFeatureFlags } from "./v3RelationFeatureFlags.js";

const DAY_MS = 86400000;
const RUN_RETENTION_DAYS = 90;
const RESOLVED_RETENTION_DAYS = 180;
const clean = (value) => String(value ?? "").trim();
const stableId = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
const json = (value) => JSON.stringify(value ?? {});
const parse = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };

let running = false;
let queuedTrigger = null;

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function count(database, table) {
  return tableExists(database, table) ? Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total) : 0;
}

export function readV3ShadowProtectedSnapshot(options = {}) {
  const database = options.database || getDatabase();
  const facts = tableExists(database, "connection_sku_sales_daily_facts")
    ? database.prepare(`SELECT COUNT(*) facts,
        COALESCE(SUM(salesAmount),0) salesAmount,
        COALESCE(SUM(costAmount),0) costAmount,
        COALESCE(SUM(profitAmount),0) profitAmount
      FROM connection_sku_sales_daily_facts`).get()
    : { facts: 0, salesAmount: 0, costAmount: 0, profitAmount: 0 };
  return {
    salesObjects: count(database, "sales_objects"),
    structures: count(database, "sales_object_structures"),
    structureComponents: count(database, "sales_object_structure_components"),
    relations: count(database, "sales_link_sku_sales_object_relations"),
    legacyMappings: count(database, "sales_link_sku_erp_mappings"),
    productStructures: count(database, "sales_link_sku_product_structures"),
    manualBindings: count(database, "platform_sku_manual_bindings"),
    comboAssets: count(database, "sales_combo_groups") + count(database, "sales_combo_group_items"),
    products: count(database, "products"),
    links: count(database, "sales_links"),
    erpSkus: count(database, "erp_skus"),
    dailyFacts: Number(facts.facts || 0),
    salesAmount: Number(facts.salesAmount || 0),
    costAmount: Number(facts.costAmount || 0),
    profitAmount: Number(facts.profitAmount || 0),
  };
}

function trueMissingCodeCount(database, batchId) {
  if (!batchId) return 0;
  return Number(database.prepare(`SELECT COUNT(*) total FROM sales_link_skus
    WHERE currentState='active' AND lastSeenBatchId=?
      AND trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))=''
      AND lower(trim(COALESCE(systemGoodsType,''))) NOT IN ('无','无需','非系统货品','非商品')`).get(batchId).total);
}

function identityCount(database, status) {
  if (!tableExists(database, "operating_erp_identity_observations")) return 0;
  return Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_identity_observations WHERE identityStatus=?").get(status).total);
}

function metricsFor(database, result) {
  const summary = result.comparison?.summary || {};
  const batchId = result.batch?.id || null;
  const evaluated = Number(summary.total || 0);
  const same = Number(summary.same || 0);
  return {
    evaluated,
    same,
    consistencyRate: evaluated ? same / evaluated : 0,
    v3_more_complete: Number(summary.v3_missing_current || 0),
    current_more_complete: Number(summary.current_missing_v3 || 0),
    relation_conflict: Number(summary.relation_conflict || 0),
    type_conflict: Number(summary.type_conflict || 0),
    source_conflict: Number(summary.source_conflict || 0),
    missing_erp_code: trueMissingCodeCount(database, batchId),
    erp_not_found: identityCount(database, "erp_not_found"),
    shadow_error: 0,
  };
}

function differenceRows(database, result) {
  const rows = [];
  for (const item of result.comparison?.details || []) {
    if (item.status === "same") continue;
    const differenceType = ({
      v3_missing_current: "v3_more_complete",
      current_missing_v3: "current_more_complete",
    })[item.status] || item.status;
    rows.push({
      objectType: "link_sku",
      objectId: item.linkSkuId,
      normalizedCode: clean(item.sourceCode).toLowerCase() || null,
      differenceType,
      current: { salesObjectId: item.currentSalesObjectId || null },
      v3: { salesObjectId: item.projectedSalesObjectId || null },
    });
  }
  if (tableExists(database, "operating_erp_identity_observations")) {
    const identities = database.prepare(`SELECT normalizedCode,identityStatus,resolvedIdentityType,goodsStatus,suiteStatus,detailJson
      FROM operating_erp_identity_observations WHERE identityStatus<>'confirmed'`).all();
    for (const item of identities) rows.push({
      objectType: "erp_identity",
      objectId: item.normalizedCode,
      normalizedCode: item.normalizedCode,
      differenceType: item.identityStatus,
      current: {},
      v3: { resolvedIdentityType: item.resolvedIdentityType, goodsStatus: item.goodsStatus, suiteStatus: item.suiteStatus, detail: parse(item.detailJson) },
    });
  }
  return rows;
}

function persistDifferences(database, runId, rows, timestamp) {
  const batchSize = Math.max(25, Number(process.env.V3_SHADOW_WRITE_BATCH_SIZE || 250));
  const stats = { writeBatchSize: batchSize, batchCount: 0, longestTransactionMs: 0, changed: 0, resolved: 0, stableSkipped: 0 };
  const writeBatches = (items, operation) => {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const batch = items.slice(offset, offset + batchSize);
      const started = performance.now();
      database.transaction(() => batch.forEach(operation)).immediate();
      stats.batchCount += 1;
      stats.longestTransactionMs = Math.max(stats.longestTransactionMs, performance.now() - started);
    }
  };
  const desired = new Map();
  for (const row of rows) {
    const key = `${row.objectType}\u0000${row.objectId}\u0000${row.differenceType}`;
    if (!desired.has(key)) desired.set(key, row);
  }
  const existing = new Map(database.prepare(`SELECT * FROM v3_relation_shadow_differences`).all()
    .map((row) => [`${row.objectType}\u0000${row.objectId}\u0000${row.differenceType}`, row]));
  const changed = [];
  for (const [key, row] of desired) {
    const current = existing.get(key);
    const currentJson = json(row.current);
    const v3Json = json(row.v3);
    if (current?.status === "active"
      && current.normalizedCode === row.normalizedCode
      && current.currentResultJson === currentJson
      && current.v3ResultJson === v3Json) {
      stats.stableSkipped += 1;
      continue;
    }
    changed.push({ ...row, key, currentJson, v3Json });
  }
  const resolved = [...existing.entries()].filter(([key, row]) => row.status === "active" && !desired.has(key)).map(([, row]) => row);
  const upsert = database.prepare(`INSERT INTO v3_relation_shadow_differences
    (id,objectType,objectId,normalizedCode,differenceType,currentResultJson,v3ResultJson,firstSeenAt,lastSeenAt,occurrenceCount,status,lastRunId,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,1,'active',?,?,?)
    ON CONFLICT(objectType,objectId,differenceType) DO UPDATE SET
      normalizedCode=excluded.normalizedCode,currentResultJson=excluded.currentResultJson,v3ResultJson=excluded.v3ResultJson,
      lastSeenAt=excluded.lastSeenAt,occurrenceCount=v3_relation_shadow_differences.occurrenceCount+1,status='active',lastRunId=excluded.lastRunId,updatedAt=excluded.updatedAt`);
  const resolve = database.prepare("UPDATE v3_relation_shadow_differences SET status='resolved',updatedAt=? WHERE id=? AND status='active'");
  writeBatches(changed, (row) => {
    const info = upsert.run(stableId("v3-shadow-diff", row.key), row.objectType, row.objectId, row.normalizedCode, row.differenceType,
      row.currentJson, row.v3Json, timestamp, timestamp, runId, timestamp, timestamp);
    stats.changed += Number(info.changes || 0);
  });
  writeBatches(resolved, (row) => {
    const info = resolve.run(timestamp, row.id);
    stats.resolved += Number(info.changes || 0);
  });
  return stats;
}

function prune(database, timestamp) {
  const runCutoff = new Date(new Date(timestamp).getTime() - RUN_RETENTION_DAYS * DAY_MS).toISOString();
  const resolvedCutoff = new Date(new Date(timestamp).getTime() - RESOLVED_RETENTION_DAYS * DAY_MS).toISOString();
  database.prepare("DELETE FROM v3_relation_shadow_runs WHERE startedAt<?").run(runCutoff);
  database.prepare("DELETE FROM v3_relation_shadow_differences WHERE status='resolved' AND lastSeenAt<?").run(resolvedCutoff);
}

export async function executeV3ShadowObservation(trigger = {}, options = {}) {
  const database = options.database || getDatabase();
  const flags = readV3RelationFeatureFlags(options.flags || {});
  if (flags.projection !== "shadow" || flags.relationWrite || flags.relationRead) {
    return { skipped: true, reason: "v3_shadow_disabled", flags };
  }
  const startedAt = new Date().toISOString();
  const runId = stableId("v3-shadow-run", `${startedAt}|${trigger.type || "manual"}|${trigger.objectId || ""}|${crypto.randomUUID()}`);
  const before = readV3ShadowProtectedSnapshot({ database });
  database.prepare(`INSERT INTO v3_relation_shadow_runs
    (id,triggerType,triggerObjectId,sourceBatchId,status,startedAt,metricsJson,protectedBeforeJson,createdAt,updatedAt)
    VALUES (?,?,?,?, 'running',?,'{}',?,?,?)`)
    .run(runId, clean(trigger.type) || "manual", clean(trigger.objectId) || null, clean(trigger.batchId) || null, startedAt, json(before), startedAt, startedAt);
  const started = performance.now();
  try {
    const runMainChain = options.runMainChain || runV3RelationMainChain;
    const shadowConcurrency = Math.max(1, Number(process.env.V3_SHADOW_WANGDIAN_CONCURRENCY || 2));
    const result = await runMainChain({ batchId: trigger.batchId, detailLimit: 5000 }, {
      database,
      flags: { projection: "shadow", relationWrite: false, relationRead: false },
      enrichmentOptions: { concurrency: shadowConcurrency, ...(options.enrichmentOptions || {}) },
    });
    const after = readV3ShadowProtectedSnapshot({ database });
    if (json(before) !== json(after)) throw new Error("v3_shadow_business_asset_mutation_detected");
    const metrics = metricsFor(database, result);
    const completedAt = new Date().toISOString();
    const diagnosticWrites = persistDifferences(database, runId, differenceRows(database, result), completedAt);
    metrics.engineering = {
      operatingSet: result.operatingSet?.materialization || null,
      identity: result.identity?.materialization || null,
      diagnosticWrites,
    };
    database.prepare(`UPDATE v3_relation_shadow_runs SET status='completed',completedAt=?,durationMs=?,metricsJson=?,protectedAfterJson=?,updatedAt=? WHERE id=?`)
      .run(completedAt, performance.now() - started, json(metrics), json(after), completedAt, runId);
    prune(database, completedAt);
    return { skipped: false, runId, status: "completed", metrics, before, after };
  } catch (error) {
    const completedAt = new Date().toISOString();
    database.prepare(`UPDATE v3_relation_shadow_runs SET status='failed',completedAt=?,durationMs=?,metricsJson=?,protectedAfterJson=?,errorMessage=?,updatedAt=? WHERE id=?`)
      .run(completedAt, performance.now() - started, json({ shadow_error: 1 }), json(readV3ShadowProtectedSnapshot({ database })), error.message, completedAt, runId);
    throw error;
  }
}

async function drainQueue(options = {}) {
  if (running) return;
  running = true;
  try {
    while (queuedTrigger) {
      const trigger = queuedTrigger;
      queuedTrigger = null;
      try { await executeV3ShadowObservation(trigger, options); }
      catch (error) { console.error("[v3-shadow]", error); }
    }
  } finally { running = false; }
}

export function scheduleV3ShadowObservation(trigger = {}, options = {}) {
  const flags = readV3RelationFeatureFlags(options.flags || {});
  if (flags.projection !== "shadow" || flags.relationWrite || flags.relationRead) return { scheduled: false, reason: "v3_shadow_disabled" };
  queuedTrigger = trigger;
  setImmediate(() => drainQueue(options));
  return { scheduled: true };
}

export function readV3ShadowSummary(options = {}) {
  const database = options.database || getDatabase();
  const latest = database.prepare("SELECT * FROM v3_relation_shadow_runs ORDER BY startedAt DESC LIMIT 1").get();
  const totals = database.prepare(`SELECT COUNT(*) runs,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
    AVG(CASE WHEN status='completed' THEN durationMs END) averageDurationMs
    FROM v3_relation_shadow_runs`).get();
  const differences = database.prepare(`SELECT differenceType,COUNT(*) total FROM v3_relation_shadow_differences
    WHERE status='active' GROUP BY differenceType ORDER BY differenceType`).all();
  return {
    flags: readV3RelationFeatureFlags(),
    retention: { runDays: RUN_RETENTION_DAYS, resolvedDifferenceDays: RESOLVED_RETENTION_DAYS },
    totals: { runs: Number(totals.runs || 0), completed: Number(totals.completed || 0), failed: Number(totals.failed || 0), averageDurationMs: Number(totals.averageDurationMs || 0) },
    latest: latest ? { ...latest, metrics: parse(latest.metricsJson), protectedBefore: parse(latest.protectedBeforeJson), protectedAfter: parse(latest.protectedAfterJson) } : null,
    activeDifferences: Object.fromEntries(differences.map((row) => [row.differenceType, Number(row.total)])),
    calculatedAt: new Date().toISOString(),
  };
}

export function listV3ShadowDifferences(query = {}, options = {}) {
  const database = options.database || getDatabase();
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)));
  const status = clean(query.status) || "active";
  const type = clean(query.differenceType);
  const where = ["status=?"];
  const parameters = [status];
  if (type) { where.push("differenceType=?"); parameters.push(type); }
  const clause = where.join(" AND ");
  const total = Number(database.prepare(`SELECT COUNT(*) total FROM v3_relation_shadow_differences WHERE ${clause}`).get(...parameters).total);
  const items = database.prepare(`SELECT * FROM v3_relation_shadow_differences WHERE ${clause}
    ORDER BY lastSeenAt DESC,id LIMIT ? OFFSET ?`).all(...parameters, pageSize, (page - 1) * pageSize)
    .map((row) => ({ ...row, currentResult: parse(row.currentResultJson), v3Result: parse(row.v3ResultJson) }));
  return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export default executeV3ShadowObservation;
