import { getDatabase } from "../db.js";

const CAPABILITY = "ResolveLinkSkuErpRelation";
const CONTRACT_VERSION = "1.0";

// Diagnostic-only legacy resolver. Formal business reads must use
// ResolveLinkSkuRelationRead, whose runtime result comes from Sales Object.
export const LEGACY_RESOLVER_MODE = "diagnostic_only";

function clean(value) {
  return String(value ?? "").trim();
}

function conflict(code, message, details = {}) {
  return { code, severity: "blocking", message, ...details };
}

function baseResult(salesLinkSkuId = null) {
  return {
    capability: CAPABILITY,
    contractVersion: CONTRACT_VERSION,
    salesLinkSkuId,
    salesLinkId: null,
    relationStatus: "missing",
    relationshipShape: null,
    isComplete: false,
    isUsable: false,
    mappings: [],
    combo: null,
    productStructure: null,
    relationSources: [],
    relationshipEvidence: [],
    governance: {
      hasPendingCandidate: false,
      pendingCandidateCount: 0,
      pendingCandidateTypes: [],
      requiresReview: false,
    },
    conflicts: [],
    warnings: [],
  };
}

function shapeFor(mappings) {
  if (!mappings.length) return null;
  if (mappings.length > 1) return "multi_component";
  return Number(mappings[0].quantity) === 1 ? "single_unit" : "single_multi_quantity";
}

function mappingOutput(row) {
  return {
    mappingId: row.mappingId,
    erpSkuId: row.erpSkuId,
    quantity: row.quantity,
    mappingType: row.mappingType,
    sourceType: row.sourceType,
    sourceBatchId: row.sourceBatchId ?? null,
    currentState: row.currentState,
    productStructureId: row.productStructureId ?? null,
  };
}

function readGovernance(candidates) {
  const pendingCandidateCount = candidates.reduce((total, row) => total + Number(row.count || 0), 0);
  return {
    hasPendingCandidate: pendingCandidateCount > 0,
    pendingCandidateCount,
    pendingCandidateTypes: candidates.map((row) => row.candidateType),
    requiresReview: pendingCandidateCount > 0,
  };
}

function appendBy(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

// Legacy archive comparison only. Current business code must use resolveLinkSkuRelationRead.js.
function loadRelationData(database, salesLinkSkuIds, onQuery = null) {
  const queryAll = (sql, params = []) => {
    onQuery?.(sql, params);
    return database.prepare(sql).all(...params);
  };
  const empty = {
    linkSkusById: new Map(), mappingsBySkuId: new Map(), candidatesBySkuId: new Map(),
    structuresById: new Map(), structuresBySkuId: new Map(), structureComponentsById: new Map(),
  };
  if (!salesLinkSkuIds.length) return empty;

  const idsSql = placeholders(salesLinkSkuIds);
  const linkSkus = queryAll(`SELECT id,salesLinkId FROM sales_link_skus WHERE id IN (${idsSql})`, salesLinkSkuIds);
  const mappings = queryAll(`
    SELECT id mappingId,salesLinkSkuId,erpSkuId,quantity,mappingType,sourceType,sourceBatchId,currentState,
      (SELECT archived.legacyStructureId
       FROM legacy_link_product_structure_sales_object_map archived
       WHERE archived.salesLinkSkuId=sales_link_sku_erp_mappings.salesLinkSkuId
         AND archived.salesObjectStructureId=sales_link_sku_erp_mappings.salesObjectStructureId
       ORDER BY archived.legacyStructureId LIMIT 1) productStructureId
    FROM sales_link_sku_erp_mappings
    WHERE salesLinkSkuId IN (${idsSql}) AND currentState='active'
  `, salesLinkSkuIds);

  const erpSkuIds = [...new Set(mappings.map((row) => clean(row.erpSkuId)).filter(Boolean))];
  const erpSkus = erpSkuIds.length
    ? queryAll(`SELECT id,currentState FROM erp_skus WHERE id IN (${placeholders(erpSkuIds)})`, erpSkuIds)
    : [];
  const erpSkusById = new Map(erpSkus.map((row) => [row.id, row]));
  const enrichedMappings = mappings.map((row) => ({
    ...row,
    existingErpSkuId: erpSkusById.get(row.erpSkuId)?.id ?? null,
    erpSkuCurrentState: erpSkusById.get(row.erpSkuId)?.currentState ?? null,
  }));

  const mappingStructureIds = [...new Set(mappings.map((row) => clean(row.productStructureId)).filter(Boolean))];
  const structureConditions = [`salesLinkSkuId IN (${idsSql}) AND status='active'`];
  const structureParams = [...salesLinkSkuIds];
  if (mappingStructureIds.length) {
    structureConditions.push(`id IN (${placeholders(mappingStructureIds)})`);
    structureParams.push(...mappingStructureIds);
  }
  const structures = queryAll(`SELECT * FROM legacy_link_product_structures WHERE ${structureConditions.join(" OR ")}`, structureParams);
  const structureIds = [...new Set(structures.map((row) => row.id))];
  const structureComponents = structureIds.length
    ? queryAll(`SELECT * FROM legacy_link_product_structure_components WHERE productStructureId IN (${placeholders(structureIds)})`, structureIds)
    : [];
  const candidates = queryAll(`
    SELECT salesLinkSkuId,candidateType,COUNT(*) count
    FROM sales_link_sku_erp_mapping_candidates
    WHERE salesLinkSkuId IN (${idsSql}) AND status='pending'
    GROUP BY salesLinkSkuId,candidateType
  `, salesLinkSkuIds);

  const loaded = {
    linkSkusById: new Map(linkSkus.map((row) => [row.id, row])),
    mappingsBySkuId: new Map(), candidatesBySkuId: new Map(),
    structuresById: new Map(structures.map((row) => [row.id, row])), structuresBySkuId: new Map(), structureComponentsById: new Map(),
  };
  for (const row of enrichedMappings) appendBy(loaded.mappingsBySkuId, row.salesLinkSkuId, row);
  for (const row of structures) appendBy(loaded.structuresBySkuId, row.salesLinkSkuId, row);
  for (const row of structureComponents) appendBy(loaded.structureComponentsById, row.productStructureId, row);
  for (const row of candidates) appendBy(loaded.candidatesBySkuId, row.salesLinkSkuId, row);
  for (const rows of loaded.structureComponentsById.values()) rows.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.erpSkuId.localeCompare(b.erpSkuId) || a.id.localeCompare(b.id));
  for (const rows of loaded.candidatesBySkuId.values()) rows.sort((a, b) => a.candidateType.localeCompare(b.candidateType));
  const componentSortOrder = new Map();
  for (const [structureId, rows] of loaded.structureComponentsById) {
    for (const row of rows) componentSortOrder.set(`${structureId}|${row.erpSkuId}`, Number(row.sortOrder));
  }
  for (const rows of loaded.mappingsBySkuId.values()) rows.sort((a, b) => {
    const aOrder = componentSortOrder.get(`${a.productStructureId}|${a.erpSkuId}`) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = componentSortOrder.get(`${b.productStructureId}|${b.erpSkuId}`) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.erpSkuId.localeCompare(b.erpSkuId) || a.mappingId.localeCompare(b.mappingId);
  });
  return loaded;
}

function evidenceFor(mappings, structuresById) {
  const grouped = new Map();
  for (const mapping of mappings) {
    const key = [mapping.sourceType, mapping.sourceBatchId || "", mapping.productStructureId || ""].join("|");
    if (!grouped.has(key)) {
      const structure = mapping.productStructureId ? structuresById.get(mapping.productStructureId) : null;
      grouped.set(key, {
        sourceType: mapping.sourceType,
        sourceBatchId: mapping.sourceBatchId ?? null,
        mappingIds: [],
        productStructureId: mapping.productStructureId ?? null,
        reviewedBy: structure?.reviewedBy ?? null,
        reviewedAt: structure?.reviewedAt ?? null,
      });
    }
    grouped.get(key).mappingIds.push(mapping.mappingId);
  }
  return [...grouped.values()].map((item) => ({ ...item, mappingIds: item.mappingIds.sort() }));
}

function compareProductStructureSet(mappings, components) {
  if (components.length !== mappings.length) return false;
  const mappingByErpSkuId = new Map(mappings.map((item) => [item.erpSkuId, item]));
  return components.every((component) => {
    const mapping = mappingByErpSkuId.get(component.erpSkuId);
    return mapping && Number(mapping.quantity) === Number(component.quantity) && Number(component.quantity) > 0;
  });
}

function resolveLoadedRelation(salesLinkSkuId, loaded) {
  const result = baseResult(salesLinkSkuId || null);
  const linkSku = loaded.linkSkusById.get(salesLinkSkuId);
  if (!linkSku) return { ...result, relationStatus: "not_found" };

  result.salesLinkId = linkSku.salesLinkId;
  result.governance = readGovernance(loaded.candidatesBySkuId.get(salesLinkSkuId) || []);

  const rows = loaded.mappingsBySkuId.get(salesLinkSkuId) || [];
  result.mappings = rows.map(mappingOutput);
  result.relationshipShape = shapeFor(rows);
  result.relationSources = [...new Set(rows.map((row) => row.sourceType).filter(Boolean))].sort();

  if (!rows.length) {
    result.relationStatus = result.governance.requiresReview ? "pending" : "missing";
    return result;
  }

  const erpCounts = new Map();
  for (const row of rows) erpCounts.set(row.erpSkuId, (erpCounts.get(row.erpSkuId) || 0) + 1);
  const duplicates = [...erpCounts].filter(([, count]) => count > 1).map(([erpSkuId]) => erpSkuId);
  if (duplicates.length) result.conflicts.push(conflict(
    "duplicate_active_erp_mapping",
    "同一链接SKU与ERP SKU存在重复active关系。",
    { erpSkuIds: duplicates },
  ));

  const missingErpSkuIds = rows.filter((row) => !row.existingErpSkuId).map((row) => row.erpSkuId);
  if (missingErpSkuIds.length) result.conflicts.push(conflict(
    "erp_sku_missing",
    "正式关系引用的ERP SKU不存在。",
    { erpSkuIds: [...new Set(missingErpSkuIds)] },
  ));

  const invalidMappingIds = rows
    .filter((row) => row.quantity === null || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0)
    .map((row) => row.mappingId);
  if (invalidMappingIds.length) {
    result.relationshipShape = "unknown";
    result.conflicts.push(conflict(
      "invalid_quantity",
      "正式关系存在无效组件数量。",
      { mappingIds: invalidMappingIds },
    ));
  }

  const inactiveErpSkuIds = rows
    .filter((row) => row.existingErpSkuId && row.erpSkuCurrentState !== "active")
    .map((row) => row.erpSkuId);
  if (inactiveErpSkuIds.length) result.conflicts.push(conflict(
    "erp_sku_inactive",
    "正式关系引用的ERP SKU当前不可用。",
    { erpSkuIds: [...new Set(inactiveErpSkuIds)] },
  ));

  const activeStructures = loaded.structuresBySkuId.get(salesLinkSkuId) || [];
  const mappingStructureIds = [...new Set(rows.map((row) => clean(row.productStructureId)).filter(Boolean))];
  if (activeStructures.length > 1) result.conflicts.push(conflict(
    "multiple_active_product_structures",
    "同一链接SKU存在多个active Product Structure。",
    { productStructureIds: activeStructures.map((structure) => structure.id) },
  ));
  let validProductStructure = null;
  if (mappingStructureIds.length || activeStructures.length) {
    if (mappingStructureIds.length !== 1 || rows.some((row) => row.productStructureId !== mappingStructureIds[0])) {
      result.conflicts.push(conflict("product_structure_incomplete", "active mappings没有整组关联同一个Product Structure。", { productStructureIds: mappingStructureIds }));
    } else {
      const structure = loaded.structuresById.get(mappingStructureIds[0]);
      const structureComponents = loaded.structureComponentsById.get(mappingStructureIds[0]) || [];
      if (!structure || structure.salesLinkSkuId !== salesLinkSkuId || structure.status !== "active") {
        result.conflicts.push(conflict("product_structure_incomplete", "mapping关联的Product Structure不存在、未激活或不属于当前链接SKU。", { productStructureId: mappingStructureIds[0] }));
      } else if (!compareProductStructureSet(rows, structureComponents)) {
        result.conflicts.push(conflict("product_structure_mismatch", "Product Structure组件集合或quantity与active mappings不一致。", { productStructureId: structure.id }));
      } else {
        validProductStructure = structure;
        result.productStructure = { productStructureId: structure.id, status: structure.status, structureHash: structure.structureHash, componentCount: structureComponents.length, isConsistent: true };
      }
    }
  }
  if (!validProductStructure && (rows.length > 1 || rows.some((row) => row.mappingType === "combo"))) {
    result.conflicts.push(conflict(
      "legacy_structure_unavailable",
      "Legacy诊断关系缺少可验证的Product Structure；Combo Group已退出关系解释。",
      { mappingIds: rows.map((row) => row.mappingId) },
    ));
  }
  result.relationshipEvidence = evidenceFor(rows, loaded.structuresById);

  if (result.governance.requiresReview) {
    result.warnings.push({
      code: "pending_governance_exists",
      severity: "warning",
      message: "当前正式关系之外仍存在待审核关系证据。",
    });
  }

  if (result.conflicts.length) {
    result.relationStatus = "conflict";
    return result;
  }
  result.relationStatus = "active_complete";
  result.isComplete = true;
  result.isUsable = true;
  return result;
}

export function resolveLinkSkuErpRelation(input = {}, options = {}) {
  const salesLinkSkuId = clean(input?.salesLinkSkuId);
  if (!salesLinkSkuId) return { ...baseResult(null), relationStatus: "invalid_input" };
  const database = options.database || getDatabase();
  const loaded = loadRelationData(database, [salesLinkSkuId], options.onQuery);
  return resolveLoadedRelation(salesLinkSkuId, loaded);
}

export function resolveLinkSkuErpRelations(input = {}, options = {}) {
  const requested = Array.isArray(input?.salesLinkSkuIds) ? input.salesLinkSkuIds : [];
  const salesLinkSkuIds = [...new Set(requested.map(clean).filter(Boolean))];
  const response = { capability: "ResolveLinkSkuErpRelations", contractVersion: CONTRACT_VERSION, results: {} };
  if (!salesLinkSkuIds.length) return response;
  const database = options.database || getDatabase();
  const loaded = loadRelationData(database, salesLinkSkuIds, options.onQuery);
  for (const salesLinkSkuId of salesLinkSkuIds) response.results[salesLinkSkuId] = resolveLoadedRelation(salesLinkSkuId, loaded);
  return response;
}

export default resolveLinkSkuErpRelation;
