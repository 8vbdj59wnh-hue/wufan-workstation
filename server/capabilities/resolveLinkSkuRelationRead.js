import { getDatabase } from "../db.js";
import { resolveLinkSkuErpRelations } from "./resolveLinkSkuErpRelation.js";
import { resolveLinkSkuSalesObjects } from "./resolveLinkSkuSalesObject.js";

export const SALES_OBJECT_RESOLVER_FLAG = "salesObjectResolverEnabled";
export const SALES_OBJECT_RESOLVER_ENV = "SALES_OBJECT_RESOLVER_ENABLED";
export const SALES_OBJECT_RESOLVER_SCOPES_ENV = "SALES_OBJECT_RESOLVER_SCOPES";
export const DEFAULT_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze(["comboSkuManagement"]);
export const FORMAL_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze([
  "comboSkuManagement", "linkDetail", "linkSkuManagement", "productWorkspace", "productAssociations",
]);

const clean = (value) => String(value ?? "").trim();
const enabledValue = (value) => value === true || value === 1 || ["1", "true", "on", "yes"].includes(clean(value).toLowerCase());
const canonical = (rows = []) => JSON.stringify(rows.map((row) => [row.erpSkuId, Number(row.quantity)]).sort(([left], [right]) => left.localeCompare(right)));

export function readSalesObjectResolverFeature(options = {}) {
  const environment = options.environment || process.env;
  const enabled = options.salesObjectResolverEnabled === undefined
    ? enabledValue(environment[SALES_OBJECT_RESOLVER_ENV])
    : enabledValue(options.salesObjectResolverEnabled);
  const configuredScopes = options.enabledScopes || clean(environment[SALES_OBJECT_RESOLVER_SCOPES_ENV]).split(",").map(clean).filter(Boolean);
  return { flag: SALES_OBJECT_RESOLVER_FLAG, enabled, enabledScopes: configuredScopes.length ? configuredScopes : [...DEFAULT_SALES_OBJECT_RESOLVER_SCOPES] };
}

function asLegacyContract(salesObjectResult, legacyResult) {
  return {
    ...legacyResult,
    capability: "ResolveLinkSkuRelationRead",
    contractVersion: "1.0",
    salesLinkSkuId: salesObjectResult.salesLinkSkuId,
    salesLinkId: legacyResult?.salesLinkId ?? null,
    relationStatus: salesObjectResult.status === "active_complete" ? "active_complete" : salesObjectResult.status === "missing_sales_object" ? "missing" : salesObjectResult.status,
    relationshipShape: salesObjectResult.structure?.shape ?? null,
    isComplete: Boolean(salesObjectResult.isComplete),
    isUsable: Boolean(salesObjectResult.isUsable),
    mappings: salesObjectResult.components.map((component) => ({
      mappingId: null,
      erpSkuId: component.erpSkuId,
      quantity: component.quantity,
      mappingType: salesObjectResult.structure?.shape ?? null,
      sourceType: salesObjectResult.relation?.sourceType ?? "sales_object",
      sourceBatchId: salesObjectResult.relation?.sourceBatchId ?? null,
      currentState: "active",
      comboGroupId: null,
      productStructureId: null,
      salesObjectId: salesObjectResult.salesObject?.id ?? null,
      salesObjectStructureId: salesObjectResult.structure?.id ?? null,
    })),
    salesObject: salesObjectResult.salesObject,
    salesObjectStructure: salesObjectResult.structure,
    resolverSource: "sales_object",
  };
}

function writeDifference(log, detail) {
  if (typeof log === "function") log(detail);
  else console.warn("[sales-object-resolver-shadow]", JSON.stringify(detail));
}

export function resolveLinkSkuRelationsForRead(input = {}, options = {}) {
  const ids = [...new Set((input.salesLinkSkuIds || []).map(clean).filter(Boolean))];
  const database = options.database || getDatabase();
  const scope = clean(options.scope);
  const feature = readSalesObjectResolverFeature(options);
  const scopeEnabled = feature.enabled && feature.enabledScopes.includes(scope);
  const oldResults = resolveLinkSkuErpRelations({ salesLinkSkuIds: ids }, { database, onQuery: options.onOldQuery }).results;
  if (!scopeEnabled && !options.shadowCompare) {
    return { capability: "ResolveLinkSkuRelationRead", contractVersion: "1.0", feature: { ...feature, scope, active: false }, results: oldResults, differences: [] };
  }
  const newResults = resolveLinkSkuSalesObjects({ salesLinkSkuIds: ids }, { database, onQuery: options.onNewQuery }).results;
  const results = {}; const differences = [];
  for (const id of ids) {
    const oldResult = oldResults[id]; const newResult = newResults[id];
    const oldSet = canonical(oldResult?.mappings); const newSet = canonical(newResult?.components);
    const same = oldSet === newSet;
    const oldHas = Boolean(oldResult?.mappings?.length); const newHas = Boolean(newResult?.components?.length);
    const differenceType = same ? "consistent" : !oldHas && newHas ? "added" : oldHas && !newHas ? "reduced" : "conflict";
    if (!same) {
      const detail = { event: "sales_object_resolver_difference", scope, salesLinkSkuId: id, differenceType, oldStatus: oldResult?.relationStatus ?? null, newStatus: newResult?.status ?? null, oldComponents: JSON.parse(oldSet), newComponents: JSON.parse(newSet), occurredAt: new Date().toISOString() };
      differences.push(detail); writeDifference(options.logDifference, detail);
    }
    const safeToUseNew = scopeEnabled && !["reduced", "conflict"].includes(differenceType) && newResult?.isUsable;
    results[id] = safeToUseNew ? asLegacyContract(newResult, oldResult) : { ...oldResult, resolverSource: "legacy", salesObjectFallbackReason: scopeEnabled && !safeToUseNew ? differenceType : null };
  }
  return { capability: "ResolveLinkSkuRelationRead", contractVersion: "1.0", feature: { ...feature, scope, active: scopeEnabled }, results, differences };
}

export function resolveErpSkuSalesObjectLinks(input = {}, options = {}) {
  const erpSkuIds = [...new Set((input.erpSkuIds || []).map(clean).filter(Boolean))];
  const database = options.database || getDatabase();
  const results = Object.fromEntries(erpSkuIds.map((erpSkuId) => [erpSkuId, []]));
  if (!erpSkuIds.length) return { capability: "ResolveErpSkuSalesObjectLinks", contractVersion: "1.0", results, differences: [] };
  const marks = erpSkuIds.map(() => "?").join(",");
  const candidates = database.prepare(`SELECT DISTINCT c.erpSkuId,r.linkSkuId
    FROM sales_object_structure_components c
    JOIN sales_object_structures s ON s.id=c.structureId AND s.status='active'
    JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=s.salesObjectId AND r.status='active'
    WHERE c.status='active' AND c.erpSkuId IN (${marks}) ORDER BY c.erpSkuId,r.linkSkuId`).all(...erpSkuIds);
  const read = { results: {}, differences: [] }; const linkSkuIds = [...new Set(candidates.map((row) => row.linkSkuId))];
  for (let offset = 0; offset < linkSkuIds.length; offset += 500) {
    const batch = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: linkSkuIds.slice(offset, offset + 500) }, {
      ...options, database, scope: clean(options.scope) || "productAssociations",
      salesObjectResolverEnabled: options.salesObjectResolverEnabled ?? true,
      enabledScopes: options.enabledScopes || FORMAL_SALES_OBJECT_RESOLVER_SCOPES,
    });
    Object.assign(read.results, batch.results); read.differences.push(...batch.differences);
  }
  for (const candidate of candidates) {
    const relation = read.results[candidate.linkSkuId];
    if (relation?.isUsable && relation.mappings.some((row) => row.erpSkuId === candidate.erpSkuId)) results[candidate.erpSkuId].push(relation);
  }
  return { capability: "ResolveErpSkuSalesObjectLinks", contractVersion: "1.0", results, differences: read.differences };
}

export function resolveLinkSkuRelationForRead(input = {}, options = {}) {
  const salesLinkSkuId = clean(input.salesLinkSkuId);
  if (!salesLinkSkuId) return { capability: "ResolveLinkSkuRelationRead", contractVersion: "1.0", relationStatus: "invalid_input", isUsable: false, mappings: [], resolverSource: "legacy" };
  return resolveLinkSkuRelationsForRead({ salesLinkSkuIds: [salesLinkSkuId] }, options).results[salesLinkSkuId];
}

export default resolveLinkSkuRelationForRead;
