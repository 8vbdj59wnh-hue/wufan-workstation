import { getDatabase } from "./db.js";
import { createHash } from "node:crypto";

const EVIDENCE_LEVELS = ["exact", "legacy_evidence", "inferred", "unknown"];
let contributionCaches = new WeakMap();
const contributionCacheTtlMs = 60_000;
const broadIdentityScopeThreshold = 500;

function text(value) { return String(value ?? "").trim(); }
function number(value) { return value === null || value === undefined ? null : Number(value); }
function date(value) { const result = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : ""; }
function add(metric, field, value) { if (value !== null && value !== undefined) metric[field] += Number(value); }

function contributionCacheKey(identityField, periodStart, periodEnd, identityIds = [], salesLinkIds = null) {
  const scope = JSON.stringify({ identityIds: [...identityIds].sort(), salesLinkIds: salesLinkIds === null ? null : [...salesLinkIds].sort() });
  return `${identityField}|${periodStart}|${periodEnd}|${createHash("sha256").update(scope).digest("hex")}`;
}

function cachesFor(database) {
  let caches = contributionCaches.get(database);
  if (!caches) {
    caches = { results: new Map(), facts: new Map() };
    contributionCaches.set(database, caches);
  }
  return caches;
}

export function invalidateProductContributionCache(database = null) {
  if (database) contributionCaches.delete(database);
  else contributionCaches = new WeakMap();
}

function readCachedContribution(database, key) {
  const cache = cachesFor(database).results;
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) { cache.delete(key); return null; }
  return cached.value;
}

function rememberContribution(database, key, value) {
  const cache = cachesFor(database).results;
  cache.set(key, { value, expiresAt: Date.now() + contributionCacheTtlMs });
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  return value;
}

function readCachedFacts(database, key) {
  const cache = cachesFor(database).facts;
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) { cache.delete(key); return null; }
  return cached.value;
}

function rememberFacts(database, key, value) {
  const cache = cachesFor(database).facts;
  cache.set(key, { value, expiresAt: Date.now() + contributionCacheTtlMs });
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  return value;
}
function blank(identityId, identityField = "productId") {
  return {
    [identityField]: identityId, directSalesQuantity: 0, bundleContributionQuantity: 0, totalPhysicalContribution: 0,
    directSalesAmount: 0, directCost: 0, directProfit: 0,
    directFactCount: 0, bundleParticipationCount: 0, contributingBundleCount: 0,
    bomEvidenceLevel: null, bomEvidence: { exact: 0, legacy_evidence: 0, inferred: 0, unknown: 0 },
    directLinks: new Map(), contributingBundles: new Map(), directFieldCounts: { quantity: 0, amount: 0, cost: 0, profit: 0 },
  };
}
function evidenceLevel(counts) {
  for (let index = EVIDENCE_LEVELS.length - 1; index >= 0; index -= 1) if (counts[EVIDENCE_LEVELS[index]]) return EVIDENCE_LEVELS[index];
  return null;
}
function publicMetric(metric, identityField = "productId") {
  const hasDirect = metric.directFactCount > 0;
  const hasBundle = metric.bundleParticipationCount > 0;
  const result = {
    [identityField]: metric[identityField],
    directSalesQuantity: metric.directFieldCounts.quantity ? metric.directSalesQuantity : null,
    bundleContributionQuantity: hasBundle ? metric.bundleContributionQuantity : null,
    totalPhysicalContribution: hasDirect || hasBundle ? metric.directSalesQuantity + metric.bundleContributionQuantity : null,
    directSalesAmount: metric.directFieldCounts.amount ? metric.directSalesAmount : null,
    directCost: metric.directFieldCounts.cost ? metric.directCost : null,
    directProfit: metric.directFieldCounts.profit ? metric.directProfit : null,
    directFactCount: metric.directFactCount,
    bundleParticipationCount: metric.bundleParticipationCount,
    contributingBundleCount: metric.contributingBundles.size,
    bomEvidenceLevel: evidenceLevel(metric.bomEvidence),
    bomEvidence: { ...metric.bomEvidence },
    directLinks: [...metric.directLinks.values()],
    contributingBundles: [...metric.contributingBundles.values()].map(({ componentQuantityByErp, ...bundle }) => ({
      ...bundle,
      componentErpSkuIds: [...componentQuantityByErp.keys()],
      componentQuantity: [...componentQuantityByErp.values()].reduce((total, value) => total + Number(value), 0),
      bomEvidenceLevel: evidenceLevel(bundle.bomEvidence),
    })),
  };
  return result;
}

function loadContext(database, facts) {
  const objectIds = [...new Set(facts.map((item) => item.salesObjectId))];
  if (!objectIds.length) return { structures: new Map(), periods: new Map(), productsByErp: new Map() };
  const placeholders = objectIds.map(() => "?").join(",");
  const structures = database.prepare(`SELECT * FROM sales_object_structures WHERE salesObjectId IN (${placeholders}) AND status IN ('active','superseded') ORDER BY salesObjectId,version`).all(...objectIds);
  const structureIds = structures.map((item) => item.id);
  const structurePlaceholders = structureIds.map(() => "?").join(",");
  const components = structureIds.length ? database.prepare(`SELECT structureId,erpSkuId,quantity,sortOrder FROM sales_object_structure_components WHERE structureId IN (${structurePlaceholders}) AND status='active' ORDER BY structureId,sortOrder,erpSkuId`).all(...structureIds) : [];
  const periods = structureIds.length && database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_object_structure_effective_periods'").get()
    ? database.prepare(`SELECT * FROM sales_object_structure_effective_periods WHERE structureId IN (${structurePlaceholders}) AND sourceState='active' ORDER BY salesObjectId,validFrom`).all(...structureIds) : [];
  const componentsByStructure = new Map();
  for (const component of components) {
    if (!componentsByStructure.has(component.structureId)) componentsByStructure.set(component.structureId, []);
    componentsByStructure.get(component.structureId).push({ erpSkuId: component.erpSkuId, quantity: Number(component.quantity), sortOrder: Number(component.sortOrder || 0) });
  }
  const structuresByObject = new Map();
  for (const structure of structures) {
    if (!structuresByObject.has(structure.salesObjectId)) structuresByObject.set(structure.salesObjectId, []);
    structuresByObject.get(structure.salesObjectId).push({ ...structure, components: componentsByStructure.get(structure.id) ?? [] });
  }
  const periodsByObject = new Map();
  for (const period of periods) {
    if (!periodsByObject.has(period.salesObjectId)) periodsByObject.set(period.salesObjectId, []);
    periodsByObject.get(period.salesObjectId).push(period);
  }
  const productsByErp = new Map();
  for (const row of database.prepare("SELECT erpSkuId,productId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL AND productId IS NOT NULL ORDER BY updatedAt,id").all()) {
    if (!productsByErp.has(row.erpSkuId)) productsByErp.set(row.erpSkuId, []);
    if (!productsByErp.get(row.erpSkuId).includes(row.productId)) productsByErp.get(row.erpSkuId).push(row.productId);
  }
  return { structures: structuresByObject, periods: periodsByObject, productsByErp };
}

function structureForFact(fact, context) {
  const structures = context.structures.get(fact.salesObjectId) ?? [];
  const byId = new Map(structures.map((item) => [item.id, item]));
  const saleDate = date(fact.saleDate);
  const period = (context.periods.get(fact.salesObjectId) ?? []).find((item) => {
    const from = date(item.validFrom); const to = date(item.validTo);
    return from && from <= saleDate && (!to || saleDate < to);
  });
  if (period && byId.has(period.structureId)) return { structure: byId.get(period.structureId), evidence: EVIDENCE_LEVELS.includes(period.validityBasis) ? period.validityBasis : "unknown" };
  const active = structures.find((item) => item.status === "active");
  if (!active) return { structure: null, evidence: "unknown" };
  if (EVIDENCE_LEVELS.includes(active.validityBasis) && active.validityBasis !== "unknown") return { structure: active, evidence: active.validityBasis };
  return { structure: active, evidence: active.sourceType === "combo_master_excel" ? "legacy_evidence" : "inferred" };
}

function queryContributions(input = {}, options = {}, identityField = "productId") {
  const database = options.database || getDatabase();
  const periodStart = date(input.periodStart || input.startDate); const periodEnd = date(input.periodEnd || input.endDate);
  if (!periodStart || !periodEnd || periodStart > periodEnd) throw new Error("Product Contribution日期范围无效。");
  const requestedIdentityIds = [...new Set(((identityField === "erpSkuId" ? input.erpSkuIds : input.productIds) ?? []).map(text).filter(Boolean))];
  const hasSalesLinkScope = Array.isArray(input.salesLinkIds);
  const requestedSalesLinkIds = [...new Set((input.salesLinkIds ?? []).map(text).filter(Boolean))];
  const cacheable = requestedIdentityIds.length === 0 || requestedIdentityIds.length >= broadIdentityScopeThreshold;
  const cacheKey = cacheable ? contributionCacheKey(identityField, periodStart, periodEnd, requestedIdentityIds, hasSalesLinkScope ? requestedSalesLinkIds : null) : "";
  if (cacheable && options.bypassCache !== true) {
    const cached = readCachedContribution(database, cacheKey);
    if (cached) return cached;
  }
  const requestedIdentities = new Set(requestedIdentityIds);
  const identityPlaceholders = requestedIdentityIds.map(() => "?").join(",");
  const salesLinkPlaceholders = requestedSalesLinkIds.map(() => "?").join(",");
  const queryBroadScope = requestedIdentityIds.length >= broadIdentityScopeThreshold;
  const broadFactCacheKey = requestedIdentityIds.length === 0
    ? `${periodStart}|${periodEnd}|links:${hasSalesLinkScope ? [...requestedSalesLinkIds].sort().join(",") : "all"}`
    : "";
  const cachedFacts = broadFactCacheKey && options.bypassCache !== true ? readCachedFacts(database, broadFactCacheKey) : null;
  const broadScopeCte = queryBroadScope ? `WITH requested_identity_ids(identityId) AS (SELECT value FROM json_each(?)),
    scoped_link_skus(linkSkuId) AS (
      SELECT DISTINCT scoped_relation.linkSkuId
      FROM sales_link_sku_sales_object_relations scoped_relation
      JOIN sales_object_structures scoped_structure ON scoped_structure.salesObjectId=scoped_relation.salesObjectId AND scoped_structure.status IN ('active','superseded')
      JOIN sales_object_structure_components scoped_component ON scoped_component.structureId=scoped_structure.id AND scoped_component.status='active'
      ${identityField === "productId" ? "JOIN product_erp_mappings scoped_mapping ON scoped_mapping.erpSkuId=scoped_component.erpSkuId AND scoped_mapping.currentState='active'" : ""}
      JOIN requested_identity_ids requested ON requested.identityId=${identityField === "productId" ? "scoped_mapping.productId" : "scoped_component.erpSkuId"}
      WHERE scoped_relation.status='active'
    )` : "";
  const facts = cachedFacts?.facts ?? (hasSalesLinkScope && !requestedSalesLinkIds.length ? [] : database.prepare(`${broadScopeCte}
    SELECT f.id,f.saleDate,f.salesLinkId,f.salesLinkSkuId,f.quantity,f.salesAmount,f.costAmount,f.profitAmount,
      r.salesObjectId,o.objectCode,o.objectType
    FROM connection_sku_sales_daily_facts f
    JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=f.salesLinkSkuId AND r.status='active'
    JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active'
    ${queryBroadScope ? "JOIN scoped_link_skus scoped ON scoped.linkSkuId=f.salesLinkSkuId" : ""}
    WHERE f.saleDate BETWEEN ? AND ?${hasSalesLinkScope ? ` AND f.salesLinkId IN (${salesLinkPlaceholders})` : ""}${requestedIdentityIds.length && !queryBroadScope ? ` AND EXISTS (
      SELECT 1 FROM sales_link_sku_sales_object_relations scoped_relation
      JOIN sales_object_structures scoped_structure ON scoped_structure.salesObjectId=scoped_relation.salesObjectId AND scoped_structure.status IN ('active','superseded')
      JOIN sales_object_structure_components scoped_component ON scoped_component.structureId=scoped_structure.id AND scoped_component.status='active'
      ${identityField === "productId" ? "JOIN product_erp_mappings scoped_mapping ON scoped_mapping.erpSkuId=scoped_component.erpSkuId AND scoped_mapping.currentState='active'" : ""}
      WHERE scoped_relation.linkSkuId=f.salesLinkSkuId AND scoped_relation.status='active' AND ${identityField === "productId" ? "scoped_mapping.productId" : "scoped_component.erpSkuId"} IN (${identityPlaceholders})
    )` : ""}
    ORDER BY f.saleDate,f.id`).all(...(queryBroadScope ? [JSON.stringify(requestedIdentityIds)] : []), periodStart, periodEnd, ...requestedSalesLinkIds, ...(queryBroadScope ? [] : requestedIdentityIds)));
  const context = cachedFacts?.context ?? loadContext(database, facts);
  if (broadFactCacheKey && !cachedFacts) rememberFacts(database, broadFactCacheKey, { facts, context });
  const metrics = new Map(requestedIdentityIds.map((identityId) => [identityId, blank(identityId, identityField)]));
  const daily = new Map(); const seenFacts = new Set();
  const unallocated = { contributionQuantity: 0, records: [], productMappingMissingCount: 0, relationConflictCount: 0, structureUnknownFactCount: 0 };
  const companyFacts = { factCount: facts.length, salesAmount: 0, costAmount: 0, profitAmount: 0 };
  const metricFor = (identityId) => { if (!metrics.has(identityId)) metrics.set(identityId, blank(identityId, identityField)); return metrics.get(identityId); };
  const dailyFor = (identityId, saleDate) => {
    const key = `${identityId}|${saleDate}`;
    if (!daily.has(key)) daily.set(key, blank(identityId, identityField));
    return daily.get(key);
  };
  for (const fact of facts) {
    if (seenFacts.has(fact.id)) continue;
    seenFacts.add(fact.id);
    add(companyFacts, "salesAmount", fact.salesAmount); add(companyFacts, "costAmount", fact.costAmount); add(companyFacts, "profitAmount", fact.profitAmount);
    const resolved = structureForFact(fact, context);
    if (!resolved.structure?.components?.length) { unallocated.structureUnknownFactCount += 1; continue; }
    if (fact.objectType === "single") {
      const component = resolved.structure.components[0];
      const identityIds = identityField === "erpSkuId" ? [component.erpSkuId] : (context.productsByErp.get(component.erpSkuId) ?? []);
      if (identityIds.length !== 1) { unallocated.relationConflictCount += identityIds.length > 1 ? 1 : 0; unallocated.productMappingMissingCount += identityIds.length ? 0 : 1; continue; }
      if (requestedIdentities.size && !requestedIdentities.has(identityIds[0])) continue;
      for (const metric of [metricFor(identityIds[0]), dailyFor(identityIds[0], fact.saleDate)]) {
        metric.directFactCount += 1;
        if (fact.quantity !== null) { metric.directSalesQuantity += Number(fact.quantity); metric.directFieldCounts.quantity += 1; }
        if (fact.salesAmount !== null) { metric.directSalesAmount += Number(fact.salesAmount); metric.directFieldCounts.amount += 1; }
        if (fact.costAmount !== null) { metric.directCost += Number(fact.costAmount); metric.directFieldCounts.cost += 1; }
        if (fact.profitAmount !== null) { metric.directProfit += Number(fact.profitAmount); metric.directFieldCounts.profit += 1; }
      }
      const link = metricFor(identityIds[0]).directLinks.get(fact.salesLinkId) ?? { salesLinkId: fact.salesLinkId, quantity: 0, salesAmount: 0, costAmount: 0, profitAmount: 0, factCount: 0 };
      link.factCount += 1; add(link, "quantity", fact.quantity); add(link, "salesAmount", fact.salesAmount); add(link, "costAmount", fact.costAmount); add(link, "profitAmount", fact.profitAmount);
      metricFor(identityIds[0]).directLinks.set(fact.salesLinkId, link);
      continue;
    }
    const touchedIdentities = new Set();
    for (const component of resolved.structure.components) {
      const contribution = Number(fact.quantity || 0) * Number(component.quantity);
      const identityIds = identityField === "erpSkuId" ? [component.erpSkuId] : (context.productsByErp.get(component.erpSkuId) ?? []);
      if (identityIds.length !== 1) {
        if (requestedIdentities.size) continue;
        if (identityIds.length > 1) unallocated.relationConflictCount += 1; else unallocated.productMappingMissingCount += 1;
        unallocated.contributionQuantity += contribution;
        unallocated.records.push({ factId: fact.id, saleDate: fact.saleDate, salesObjectId: fact.salesObjectId, bundleCode: fact.objectCode, erpSkuId: component.erpSkuId, componentQuantity: component.quantity, bundleSalesQuantity: number(fact.quantity), contributionQuantity: contribution, reason: identityIds.length ? "product_mapping_conflict" : "product_mapping_missing", bomEvidenceLevel: resolved.evidence });
        continue;
      }
      const identityId = identityIds[0];
      if (requestedIdentities.size && !requestedIdentities.has(identityId)) continue;
      touchedIdentities.add(identityId);
      for (const metric of [metricFor(identityId), dailyFor(identityId, fact.saleDate)]) {
        metric.bundleContributionQuantity += contribution;
        metric.bomEvidence[resolved.evidence] += 1;
      }
      const bundle = metricFor(identityId).contributingBundles.get(fact.salesObjectId) ?? { salesObjectId: fact.salesObjectId, bundleCode: fact.objectCode, componentQuantityByErp: new Map(), bundleSalesQuantity: 0, contributionQuantity: 0, factCount: 0, bomEvidence: { exact: 0, legacy_evidence: 0, inferred: 0, unknown: 0 } };
      if (!bundle.componentQuantityByErp.has(component.erpSkuId)) bundle.componentQuantityByErp.set(component.erpSkuId, Number(component.quantity));
      bundle.bundleSalesQuantity += Number(fact.quantity || 0); bundle.contributionQuantity += contribution; bundle.factCount += 1; bundle.bomEvidence[resolved.evidence] += 1;
      metricFor(identityId).contributingBundles.set(fact.salesObjectId, bundle);
    }
    for (const identityId of touchedIdentities) {
      metricFor(identityId).bundleParticipationCount += 1;
      dailyFor(identityId, fact.saleDate).bundleParticipationCount += 1;
    }
  }
  for (const metric of metrics.values()) metric.totalPhysicalContribution = metric.directSalesQuantity + metric.bundleContributionQuantity;
  const items = [...metrics.values()].map((metric) => publicMetric(metric, identityField)).sort((left, right) => left[identityField].localeCompare(right[identityField]));
  const dailyItems = [...daily.entries()].map(([key, metric]) => ({ date: key.slice(key.lastIndexOf("|") + 1), ...publicMetric(metric, identityField) })).sort((left, right) => left.date.localeCompare(right.date) || left[identityField].localeCompare(right[identityField]));
  const result = {
    capability: "QueryProductContribution", contractVersion: "1.0", periodStart, periodEnd,
    items, dailyItems, unallocatedContribution: unallocated, companyFacts,
    definitions: {
      directQuantity: "Daily Fact → Single Sales Object → ERP SKU → Product",
      bundleContribution: "Daily Fact → Bundle Sales Object → BOM Component Quantity → Product",
      totalPhysicalContribution: "directSalesQuantity + bundleContributionQuantity",
      economics: "Product仅归属Single直接销售事实；Bundle金额和利润不分摊",
      salesLinkScope: hasSalesLinkScope ? "仅统计指定Sales Link范围" : "全部Sales Link",
      historicalEvidence: "BOM证据等级只读Sales Object Structure版本和来源元数据，不读Legacy Product Structure",
    },
  };
  return cacheable ? rememberContribution(database, cacheKey, result) : result;
}

export function queryProductContributions(input = {}, options = {}) {
  return queryContributions(input, options, "productId");
}

export function queryErpSkuContributions(input = {}, options = {}) {
  const result = queryContributions(input, options, "erpSkuId");
  return {
    ...result,
    capability: "QueryErpSkuContribution",
    contractVersion: "2.0",
    definitions: {
      ...result.definitions,
      directQuantity: "Daily Fact → Single Sales Object → ERP SKU",
      bundleContribution: "Daily Fact → Bundle Sales Object → BOM Component ERP SKU Quantity",
      economics: "ERP SKU仅归属Single直接销售事实；Bundle金额和利润不分摊",
    },
  };
}

export function queryProductContribution(productId, input = {}, options = {}) {
  const id = text(productId); if (!id) throw new Error("产品不能为空。");
  const result = queryProductContributions({ ...input, productIds: [id] }, options);
  return { ...result, item: result.items.find((row) => row.productId === id) ?? publicMetric(blank(id)) };
}

export function queryErpSkuContribution(erpSkuId, input = {}, options = {}) {
  const id = text(erpSkuId); if (!id) throw new Error("ERP SKU不能为空。");
  const result = queryErpSkuContributions({ ...input, erpSkuIds: [id] }, options);
  return { ...result, item: result.items.find((row) => row.erpSkuId === id) ?? publicMetric(blank(id, "erpSkuId"), "erpSkuId") };
}

export default queryProductContributions;
