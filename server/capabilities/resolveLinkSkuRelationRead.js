import { getDatabase } from "../db.js";
import { resolveLinkSkuSalesObjects } from "./resolveLinkSkuSalesObject.js";
import { readV3RelationFeatureFlags } from "../v3RelationFeatureFlags.js";

export const SALES_OBJECT_RESOLVER_FLAG = "salesObjectResolverEnabled";
export const SALES_OBJECT_RESOLVER_ENV = "SALES_OBJECT_RESOLVER_ENABLED";
export const SALES_OBJECT_RESOLVER_SCOPES_ENV = "SALES_OBJECT_RESOLVER_SCOPES";
export const DEFAULT_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze(["comboSkuManagement"]);
export const FORMAL_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze([
  "comboSkuManagement", "linkDetail", "linkSkuManagement", "productWorkspace", "productAssociations", "salesDailyPreview", "anomalyGovernance",
]);

const clean = (value) => String(value ?? "").trim();
const enabledValue = (value) => value === true || value === 1 || ["1", "true", "on", "yes"].includes(clean(value).toLowerCase());

export function readSalesObjectResolverFeature(options = {}) {
  const environment = options.environment || process.env;
  const enabled = options.salesObjectResolverEnabled === undefined
    ? enabledValue(environment[SALES_OBJECT_RESOLVER_ENV])
    : enabledValue(options.salesObjectResolverEnabled);
  const configuredScopes = options.enabledScopes || clean(environment[SALES_OBJECT_RESOLVER_SCOPES_ENV]).split(",").map(clean).filter(Boolean);
  return { flag: SALES_OBJECT_RESOLVER_FLAG, enabled, enabledScopes: configuredScopes.length ? configuredScopes : [...DEFAULT_SALES_OBJECT_RESOLVER_SCOPES] };
}

function asBusinessContract(salesObjectResult, salesLinkId = null) {
  return {
    capability: "ResolveLinkSkuRelationRead",
    contractVersion: "1.0",
    salesLinkSkuId: salesObjectResult.salesLinkSkuId,
    salesLinkId,
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
      productStructureId: null,
      salesObjectId: salesObjectResult.salesObject?.id ?? null,
      salesObjectStructureId: salesObjectResult.structure?.id ?? null,
    })),
    salesObject: salesObjectResult.salesObject,
    salesObjectStructure: salesObjectResult.structure,
    relation: salesObjectResult.relation,
    warnings: salesObjectResult.warnings,
    conflicts: salesObjectResult.conflicts,
    resolverSource: "sales_object",
  };
}

export function resolveLinkSkuRelationsForRead(input = {}, options = {}) {
  const ids = [...new Set((input.salesLinkSkuIds || []).map(clean).filter(Boolean))];
  const database = options.database || getDatabase();
  const scope = clean(options.scope);
  const feature = readSalesObjectResolverFeature(options);
  const v3Feature = readV3RelationFeatureFlags({
    environment: options.environment || process.env,
    relationRead: options.v3RelationReadEnabled,
    projection: options.v3Projection,
    relationWrite: options.v3RelationWriteEnabled,
  });
  const newResults = resolveLinkSkuSalesObjects({ salesLinkSkuIds: ids }, {
    database,
    onQuery: options.onNewQuery,
    relationSourceType: v3Feature.relationRead ? v3Feature.relationSourceType : "",
    excludeProjectionCreated: !v3Feature.relationRead,
  }).results;
  const results = {};
  for (const id of ids) {
    results[id] = asBusinessContract(newResults[id], newResults[id]?.salesLinkId ?? null);
  }
  return {
    capability: "ResolveLinkSkuRelationRead",
    contractVersion: "1.0",
    feature: { ...feature, v3Relation: v3Feature, scope, active: true, mode: "sales_object_single_read" },
    results,
    differences: [],
    diagnostics: options.shadowCompare === true
      ? { mode: "legacy_archived", total: 0, consistent: 0, different: 0, byType: { consistent: 0, added: 0, reduced: 0, conflict: 0 }, comparisons: [] }
      : { mode: "disabled", total: 0, consistent: 0, different: 0, byType: { consistent: 0, added: 0, reduced: 0, conflict: 0 }, comparisons: [] },
  };
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
    const batchIds = linkSkuIds.slice(offset, offset + 500);
    const batch = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: batchIds }, {
      ...options, database, scope: clean(options.scope) || "productAssociations",
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
  if (!salesLinkSkuId) return { capability: "ResolveLinkSkuRelationRead", contractVersion: "1.0", relationStatus: "invalid_input", isUsable: false, mappings: [], resolverSource: "sales_object" };
  return resolveLinkSkuRelationsForRead({ salesLinkSkuIds: [salesLinkSkuId] }, options).results[salesLinkSkuId];
}

export default resolveLinkSkuRelationForRead;
