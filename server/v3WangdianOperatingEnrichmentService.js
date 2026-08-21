import { getDatabase } from "./db.js";
import { adaptWangdianGoodsResponse } from "./wangdianGoodsAdapter.js";
import { queryWangdianGoods, queryWangdianSuites } from "./wangdianClient.js";
import { searchWangdianSuites } from "./wangdianSuiteService.js";

const clean = (value) => String(value ?? "").trim();
const normalized = (value) => clean(value).replace(/\.0+$/u, "").toLowerCase();
const HOUR_MS = 60 * 60 * 1000;

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function duration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function targets(database, options = {}) {
  const rows = database.prepare(`SELECT DISTINCT m.merchantSkuCode,m.normalizedCode
    FROM operating_erp_set_members m
    LEFT JOIN erp_skus e ON lower(trim(e.merchantSkuCode))=m.normalizedCode AND e.currentState='active'
    LEFT JOIN sales_objects o ON o.normalizedObjectCode=m.normalizedCode AND o.status='active' AND o.sourceType='wangdian_suite_api'
    WHERE m.lifecycleStatus IN ('active','sales_active','unresolved') AND e.id IS NULL AND o.id IS NULL
    ORDER BY m.normalizedCode`).all();
  if (!tableExists(database, "operating_erp_identity_observations")) return { rows, cached: [] };
  const now = (options.now ? new Date(options.now) : new Date()).getTime();
  const negativeTtlMs = duration(options.negativeCacheTtlMs, duration(process.env.V3_WANGDIAN_NEGATIVE_CACHE_TTL_HOURS, 6) * HOUR_MS);
  const identityTtlMs = duration(options.identityCacheTtlMs, duration(process.env.V3_WANGDIAN_IDENTITY_CACHE_TTL_HOURS, 6) * HOUR_MS);
  const unavailableTtlMs = duration(options.sourceUnavailableCacheTtlMs, duration(process.env.V3_WANGDIAN_UNAVAILABLE_CACHE_TTL_MINUTES, 5) * 60 * 1000);
  const observations = database.prepare(`SELECT normalizedCode,merchantSkuCode,sourceCheckedAt,sourceUpdatedAt,
      resolvedIdentityType,identityStatus,goodsStatus,suiteStatus,goodsErpSkuId,suiteSalesObjectId
    FROM operating_erp_identity_observations WHERE sourceCheckedAt IS NOT NULL`).all();
  const componentsByObject = new Map();
  if (tableExists(database, "sales_object_structures") && tableExists(database, "sales_object_structure_components")) {
    const components = database.prepare(`SELECT s.salesObjectId,e.merchantSkuCode skuCode,c.quantity
      FROM sales_object_structures s
      JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
      JOIN erp_skus e ON e.id=c.erpSkuId
      WHERE s.status='active' ORDER BY s.salesObjectId,c.sortOrder,c.id`).all();
    for (const item of components) componentsByObject.set(item.salesObjectId, [...(componentsByObject.get(item.salesObjectId) || []), item]);
  }
  const recent = new Map();
  for (const item of observations) {
    const checkedAt = new Date(item.sourceCheckedAt).getTime();
    const ttl = item.identityStatus === "erp_not_found" ? negativeTtlMs
      : item.identityStatus === "source_unavailable" ? unavailableTtlMs : identityTtlMs;
    if (!(ttl > 0) || !Number.isFinite(checkedAt) || now - checkedAt > ttl) continue;
    const bundleComponents = componentsByObject.get(item.suiteSalesObjectId) || [];
    if (item.suiteStatus === "found" && !bundleComponents.length) continue;
    recent.set(normalized(item.normalizedCode), {
      code: clean(item.merchantSkuCode), checkedAt: item.sourceCheckedAt,
      goodsChecked: item.goodsStatus !== "not_checked", suiteChecked: item.suiteStatus !== "not_checked",
      goods: item.goodsStatus === "found" ? {
        merchantSkuCode: clean(item.merchantSkuCode),
        goodsDeleted: item.identityStatus === "source_conflict" && item.resolvedIdentityType === "single",
        erpStatus: item.identityStatus === "source_conflict" && item.resolvedIdentityType === "single" ? "inactive" : "active",
      } : null,
      suite: item.suiteStatus === "found" ? {
        suiteCode: clean(item.merchantSkuCode), modifiedAt: item.sourceUpdatedAt,
        deleted: item.identityStatus === "source_conflict" && item.resolvedIdentityType === "bundle",
        components: bundleComponents.map((component) => ({ skuCode: component.skuCode, quantity: component.quantity, deleted: false })),
      } : null,
      goodsError: item.goodsStatus === "source_unavailable" ? "cached_source_unavailable" : null,
      suiteError: item.suiteStatus === "source_unavailable" ? "cached_source_unavailable" : null,
      cacheStatus: item.identityStatus === "erp_not_found" ? "negative_hit" : "identity_hit",
    });
  }
  const cached = [];
  const pending = [];
  for (const row of rows) {
    const observation = recent.get(normalized(row.normalizedCode));
    if (observation) cached.push(observation);
    else pending.push(row);
  }
  return { rows: pending, cached };
}

export async function enrichOperatingErpObjects(input = {}, options = {}) {
  const database = options.database || input.database || getDatabase();
  const queryGoods = options.queryGoods || ((request) => queryWangdianGoods(request));
  const querySuites = options.querySuites || ((request) => queryWangdianSuites(request));
  const targetSet = targets(database, options);
  const rows = targetSet.rows;
  const erpByCode = new Map(database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all().map((item) => [normalized(item.merchantSkuCode), item]));
  const liveObservations = Object.fromEntries(targetSet.cached.map((item) => [normalized(item.code), item]));
  const bundleSources = {};
  for (const observation of targetSet.cached) {
    if (!observation.suite || observation.suite.deleted) continue;
    bundleSources[normalized(observation.code)] = {
      sourceUpdatedAt: observation.suite.modifiedAt || null,
      components: observation.suite.components.filter((item) => !item.deleted).map((item) => ({
        erpSkuId: erpByCode.get(normalized(item.skuCode))?.id || null,
        skuCode: clean(item.skuCode),
        quantity: Number(item.quantity),
      })),
    };
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, Number(options.concurrency || 8)), rows.length) }, async () => {
    while (cursor < rows.length) {
      const target = rows[cursor]; cursor += 1;
      const code = clean(target.merchantSkuCode);
      const observation = { code, checkedAt: new Date().toISOString(), goodsChecked: false, suiteChecked: false, goods: null, suite: null, goodsError: null, suiteError: null };
      await Promise.all([
        (async () => { try {
          const payload = await queryGoods({ params: { spec_no: code, hide_deleted: 0 }, pageSize: 100 });
          const exact = adaptWangdianGoodsResponse(payload).filter((item) => normalized(item.merchantSkuCode) === normalized(code));
          observation.goods = exact[0] || null; observation.goodsChecked = true;
        } catch (error) { observation.goodsError = error.message || String(error); } })(),
        (async () => { try {
          const result = await searchWangdianSuites({ suiteNo: code, pageSize: 100, hideDeleted: false }, { querySuites });
          observation.suite = result.items.find((item) => normalized(item.suiteCode) === normalized(code)) || null; observation.suiteChecked = true;
        } catch (error) { observation.suiteError = error.message || String(error); } })(),
      ]);
      liveObservations[normalized(code)] = observation;
      if (observation.suite && !observation.suite.deleted) {
        const components = observation.suite.components.filter((item) => !item.deleted).map((item) => ({
          erpSkuId: erpByCode.get(normalized(item.skuCode))?.id || null,
          skuCode: clean(item.skuCode), quantity: Number(item.quantity),
        }));
        bundleSources[normalized(code)] = { sourceUpdatedAt: observation.suite.modifiedAt || null, components };
      }
    }
  });
  await Promise.all(workers);
  const observations = Object.values(liveObservations);
  const sourceFailures = observations.filter((item) => item.goodsError || item.suiteError).length;
  const bomPending = Object.values(bundleSources).filter((item) => !item.components.length || item.components.some((component) => !component.erpSkuId || !(component.quantity > 0))).length;
  return {
    status: sourceFailures ? "source_unavailable" : bomPending ? "bundle_bom_pending" : "completed",
    changedCodes: rows.length,
    evaluatedCodes: rows.length + targetSet.cached.length,
    cacheHits: targetSet.cached.length,
    identityCacheHits: targetSet.cached.filter((item) => item.cacheStatus === "identity_hit").length,
    negativeCacheHits: targetSet.cached.filter((item) => item.cacheStatus === "negative_hit").length,
    estimatedApiRequests: rows.length * 2,
    sourceFailures, bomPending, liveObservations, bundleSources,
  };
}

export default enrichOperatingErpObjects;
