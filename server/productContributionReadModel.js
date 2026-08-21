import { getDatabase } from "./db.js";

const EVIDENCE_LEVELS = ["exact", "legacy_evidence", "inferred", "unknown"];

function text(value) { return String(value ?? "").trim(); }
function number(value) { return value === null || value === undefined ? null : Number(value); }
function date(value) { const result = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : ""; }
function add(metric, field, value) { if (value !== null && value !== undefined) metric[field] += Number(value); }
function blank(productId) {
  return {
    productId, directSalesQuantity: 0, bundleContributionQuantity: 0, totalPhysicalContribution: 0,
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
function publicMetric(metric) {
  const hasDirect = metric.directFactCount > 0;
  const hasBundle = metric.bundleParticipationCount > 0;
  const result = {
    productId: metric.productId,
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

export function queryProductContributions(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const periodStart = date(input.periodStart || input.startDate); const periodEnd = date(input.periodEnd || input.endDate);
  if (!periodStart || !periodEnd || periodStart > periodEnd) throw new Error("Product Contribution日期范围无效。");
  const requestedProductIds = [...new Set((input.productIds ?? []).map(text).filter(Boolean))];
  const requestedProducts = new Set(requestedProductIds);
  const productPlaceholders = requestedProductIds.map(() => "?").join(",");
  const facts = database.prepare(`SELECT f.id,f.saleDate,f.salesLinkId,f.salesLinkSkuId,f.quantity,f.salesAmount,f.costAmount,f.profitAmount,
      r.salesObjectId,o.objectCode,o.objectType
    FROM connection_sku_sales_daily_facts f
    JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=f.salesLinkSkuId AND r.status='active'
    JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active'
    WHERE f.saleDate BETWEEN ? AND ?${requestedProductIds.length ? ` AND EXISTS (
      SELECT 1 FROM sales_link_sku_sales_object_relations scoped_relation
      JOIN sales_object_structures scoped_structure ON scoped_structure.salesObjectId=scoped_relation.salesObjectId AND scoped_structure.status IN ('active','superseded')
      JOIN sales_object_structure_components scoped_component ON scoped_component.structureId=scoped_structure.id AND scoped_component.status='active'
      JOIN product_erp_mappings scoped_mapping ON scoped_mapping.erpSkuId=scoped_component.erpSkuId AND scoped_mapping.currentState='active'
      WHERE scoped_relation.linkSkuId=f.salesLinkSkuId AND scoped_relation.status='active' AND scoped_mapping.productId IN (${productPlaceholders})
    )` : ""}
    ORDER BY f.saleDate,f.id`).all(periodStart, periodEnd, ...requestedProductIds);
  const context = loadContext(database, facts);
  const metrics = new Map(requestedProductIds.map((productId) => [productId, blank(productId)]));
  const daily = new Map(); const seenFacts = new Set();
  const unallocated = { contributionQuantity: 0, records: [], productMappingMissingCount: 0, relationConflictCount: 0, structureUnknownFactCount: 0 };
  const companyFacts = { factCount: facts.length, salesAmount: 0, costAmount: 0, profitAmount: 0 };
  const metricFor = (productId) => { if (!metrics.has(productId)) metrics.set(productId, blank(productId)); return metrics.get(productId); };
  const dailyFor = (productId, saleDate) => {
    const key = `${productId}|${saleDate}`;
    if (!daily.has(key)) daily.set(key, blank(productId));
    return daily.get(key);
  };
  for (const fact of facts) {
    if (seenFacts.has(fact.id)) continue;
    seenFacts.add(fact.id);
    add(companyFacts, "salesAmount", fact.salesAmount); add(companyFacts, "costAmount", fact.costAmount); add(companyFacts, "profitAmount", fact.profitAmount);
    const resolved = structureForFact(fact, context);
    if (!resolved.structure?.components?.length) { unallocated.structureUnknownFactCount += 1; continue; }
    if (fact.objectType === "single") {
      const component = resolved.structure.components[0]; const productIds = context.productsByErp.get(component.erpSkuId) ?? [];
      if (productIds.length !== 1) { unallocated.relationConflictCount += productIds.length > 1 ? 1 : 0; unallocated.productMappingMissingCount += productIds.length ? 0 : 1; continue; }
      if (requestedProducts.size && !requestedProducts.has(productIds[0])) continue;
      for (const metric of [metricFor(productIds[0]), dailyFor(productIds[0], fact.saleDate)]) {
        metric.directFactCount += 1;
        if (fact.quantity !== null) { metric.directSalesQuantity += Number(fact.quantity); metric.directFieldCounts.quantity += 1; }
        if (fact.salesAmount !== null) { metric.directSalesAmount += Number(fact.salesAmount); metric.directFieldCounts.amount += 1; }
        if (fact.costAmount !== null) { metric.directCost += Number(fact.costAmount); metric.directFieldCounts.cost += 1; }
        if (fact.profitAmount !== null) { metric.directProfit += Number(fact.profitAmount); metric.directFieldCounts.profit += 1; }
      }
      const link = metricFor(productIds[0]).directLinks.get(fact.salesLinkId) ?? { salesLinkId: fact.salesLinkId, quantity: 0, salesAmount: 0, costAmount: 0, profitAmount: 0, factCount: 0 };
      link.factCount += 1; add(link, "quantity", fact.quantity); add(link, "salesAmount", fact.salesAmount); add(link, "costAmount", fact.costAmount); add(link, "profitAmount", fact.profitAmount);
      metricFor(productIds[0]).directLinks.set(fact.salesLinkId, link);
      continue;
    }
    const touchedProducts = new Set();
    for (const component of resolved.structure.components) {
      const contribution = Number(fact.quantity || 0) * Number(component.quantity);
      const productIds = context.productsByErp.get(component.erpSkuId) ?? [];
      if (productIds.length !== 1) {
        if (requestedProducts.size) continue;
        if (productIds.length > 1) unallocated.relationConflictCount += 1; else unallocated.productMappingMissingCount += 1;
        unallocated.contributionQuantity += contribution;
        unallocated.records.push({ factId: fact.id, saleDate: fact.saleDate, salesObjectId: fact.salesObjectId, bundleCode: fact.objectCode, erpSkuId: component.erpSkuId, componentQuantity: component.quantity, bundleSalesQuantity: number(fact.quantity), contributionQuantity: contribution, reason: productIds.length ? "product_mapping_conflict" : "product_mapping_missing", bomEvidenceLevel: resolved.evidence });
        continue;
      }
      const productId = productIds[0];
      if (requestedProducts.size && !requestedProducts.has(productId)) continue;
      touchedProducts.add(productId);
      for (const metric of [metricFor(productId), dailyFor(productId, fact.saleDate)]) {
        metric.bundleContributionQuantity += contribution;
        metric.bomEvidence[resolved.evidence] += 1;
      }
      const bundle = metricFor(productId).contributingBundles.get(fact.salesObjectId) ?? { salesObjectId: fact.salesObjectId, bundleCode: fact.objectCode, componentQuantityByErp: new Map(), bundleSalesQuantity: 0, contributionQuantity: 0, factCount: 0, bomEvidence: { exact: 0, legacy_evidence: 0, inferred: 0, unknown: 0 } };
      if (!bundle.componentQuantityByErp.has(component.erpSkuId)) bundle.componentQuantityByErp.set(component.erpSkuId, Number(component.quantity));
      bundle.bundleSalesQuantity += Number(fact.quantity || 0); bundle.contributionQuantity += contribution; bundle.factCount += 1; bundle.bomEvidence[resolved.evidence] += 1;
      metricFor(productId).contributingBundles.set(fact.salesObjectId, bundle);
    }
    for (const productId of touchedProducts) {
      metricFor(productId).bundleParticipationCount += 1;
      dailyFor(productId, fact.saleDate).bundleParticipationCount += 1;
    }
  }
  for (const metric of metrics.values()) metric.totalPhysicalContribution = metric.directSalesQuantity + metric.bundleContributionQuantity;
  const items = [...metrics.values()].map(publicMetric).sort((left, right) => left.productId.localeCompare(right.productId));
  const dailyItems = [...daily.entries()].map(([key, metric]) => ({ date: key.slice(key.lastIndexOf("|") + 1), ...publicMetric(metric) })).sort((left, right) => left.date.localeCompare(right.date) || left.productId.localeCompare(right.productId));
  return {
    capability: "QueryProductContribution", contractVersion: "1.0", periodStart, periodEnd,
    items, dailyItems, unallocatedContribution: unallocated, companyFacts,
    definitions: {
      directQuantity: "Daily Fact → Single Sales Object → ERP SKU → Product",
      bundleContribution: "Daily Fact → Bundle Sales Object → BOM Component Quantity → Product",
      totalPhysicalContribution: "directSalesQuantity + bundleContributionQuantity",
      economics: "Product仅归属Single直接销售事实；Bundle金额和利润不分摊",
      historicalEvidence: "BOM证据等级只读Sales Object Structure版本和来源元数据，不读Legacy Product Structure",
    },
  };
}

export function queryProductContribution(productId, input = {}, options = {}) {
  const id = text(productId); if (!id) throw new Error("产品不能为空。");
  const result = queryProductContributions({ ...input, productIds: [id] }, options);
  return { ...result, item: result.items.find((row) => row.productId === id) ?? publicMetric(blank(id)) };
}

export default queryProductContributions;
