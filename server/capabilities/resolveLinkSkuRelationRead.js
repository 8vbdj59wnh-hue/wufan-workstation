import { getDatabase } from "../db.js";
import { resolveLinkSkuErpRelations } from "./resolveLinkSkuErpRelation.js";
import { resolveLinkSkuSalesObjects } from "./resolveLinkSkuSalesObject.js";

export const SALES_OBJECT_RESOLVER_FLAG = "salesObjectResolverEnabled";
export const SALES_OBJECT_RESOLVER_ENV = "SALES_OBJECT_RESOLVER_ENABLED";
export const SALES_OBJECT_RESOLVER_SCOPES_ENV = "SALES_OBJECT_RESOLVER_SCOPES";
export const DEFAULT_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze(["comboSkuManagement"]);
export const FORMAL_SALES_OBJECT_RESOLVER_SCOPES = Object.freeze([
  "comboSkuManagement", "linkDetail", "linkSkuManagement", "productWorkspace", "productAssociations", "salesDailyPreview", "anomalyGovernance",
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
      comboGroupId: null,
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

function compareResolverResults(ids, oldResults, newResults, scope, options) {
  const comparisons = [];
  const differences = [];
  const counts = { consistent: 0, added: 0, reduced: 0, conflict: 0 };
  for (const salesLinkSkuId of ids) {
    const oldResult = oldResults[salesLinkSkuId];
    const newResult = newResults[salesLinkSkuId];
    const oldSet = canonical(oldResult?.mappings);
    const newSet = canonical(newResult?.components);
    const same = oldSet === newSet;
    const oldHas = Boolean(oldResult?.mappings?.length);
    const newHas = Boolean(newResult?.components?.length);
    const differenceType = same ? "consistent" : !oldHas && newHas ? "added" : oldHas && !newHas ? "reduced" : "conflict";
    const reason = differenceType === "consistent"
      ? "component_set_equal"
      : differenceType === "added"
        ? "sales_object_only"
        : differenceType === "reduced"
          ? "legacy_only"
          : "component_set_mismatch";
    const detail = {
      event: "sales_object_resolver_shadow_compare",
      scope,
      salesLinkSkuId,
      status: same ? "consistent" : "different",
      differenceType,
      reason,
      oldStatus: oldResult?.relationStatus ?? null,
      newStatus: newResult?.status ?? null,
      oldComponents: JSON.parse(oldSet),
      newComponents: JSON.parse(newSet),
      occurredAt: new Date().toISOString(),
    };
    counts[differenceType] += 1;
    comparisons.push(detail);
    if (!same) {
      differences.push(detail);
      writeDifference(options.logDifference, detail);
    }
  }
  return {
    comparisons,
    differences,
    summary: {
      total: comparisons.length,
      consistent: counts.consistent,
      different: comparisons.length - counts.consistent,
      byType: counts,
    },
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
  const newResults = resolveLinkSkuSalesObjects({ salesLinkSkuIds: ids }, { database, onQuery: options.onNewQuery }).results;
  const results = {};
  for (const id of ids) {
    results[id] = asBusinessContract(newResults[id], newResults[id]?.salesLinkId ?? null);
  }
  let shadow = null;
  let legacyDiagnosticUnavailable = false;
  if (options.shadowCompare === true) {
    const legacyTables = ["sales_link_sku_erp_mappings", "sales_link_sku_product_structures", "sales_link_sku_product_structure_components"];
    const available = legacyTables.every((name) => database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (available) {
      const oldResults = resolveLinkSkuErpRelations({ salesLinkSkuIds: ids }, { database, onQuery: options.onOldQuery }).results;
      shadow = compareResolverResults(ids, oldResults, newResults, scope, options);
    } else legacyDiagnosticUnavailable = true;
  }
  return {
    capability: "ResolveLinkSkuRelationRead",
    contractVersion: "1.0",
    feature: { ...feature, scope, active: true, mode: "sales_object_single_read" },
    results,
    differences: shadow?.differences ?? [],
    diagnostics: legacyDiagnosticUnavailable
      ? { mode: "legacy_unavailable", total: 0, consistent: 0, different: 0, byType: { consistent: 0, added: 0, reduced: 0, conflict: 0 }, comparisons: [] }
      : shadow
      ? { mode: "shadow_compare", ...shadow.summary, comparisons: shadow.comparisons }
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
