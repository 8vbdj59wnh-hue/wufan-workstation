import { getDatabase } from "../db.js";

const CONTRACT_VERSION = "1.0";
const clean = (value) => String(value ?? "").trim();
const placeholders = (values) => values.map(() => "?").join(",");

function base(salesLinkSkuId = null) {
  return {
    capability: "ResolveLinkSkuSalesObject", contractVersion: CONTRACT_VERSION, salesLinkSkuId,
    salesLinkId: null,
    status: "missing_sales_object", isComplete: false, isUsable: false,
    salesObject: null, relation: null, structure: null, components: [], warnings: [], conflicts: [],
  };
}

function shape(components) {
  if (!components.length) return null;
  if (components.length > 1) return "multi_component";
  return Number(components[0].quantity) === 1 ? "single_unit" : "single_multi_quantity";
}

function load(database, ids, onQuery) {
  if (!ids.length) return { linkSkus: new Map(), relations: new Map(), objects: new Map(), structures: new Map(), components: new Map(), erpSkus: new Map() };
  const query = (sql, params) => { onQuery?.(sql, params); return database.prepare(sql).all(...params); };
  const sqlIds = placeholders(ids);
  const linkSkuRows = query(`SELECT id,salesLinkId FROM sales_link_skus WHERE id IN (${sqlIds})`, ids);
  const relationRows = query(`SELECT * FROM sales_link_sku_sales_object_relations WHERE linkSkuId IN (${sqlIds}) AND status='active'`, ids);
  const objectIds = [...new Set(relationRows.map((row) => row.salesObjectId))];
  const objectRows = objectIds.length ? query(`SELECT * FROM sales_objects WHERE id IN (${placeholders(objectIds)})`, objectIds) : [];
  const structureRows = objectIds.length ? query(`SELECT * FROM sales_object_structures WHERE salesObjectId IN (${placeholders(objectIds)}) AND status='active'`, objectIds) : [];
  const structureIds = structureRows.map((row) => row.id);
  const componentRows = structureIds.length ? query(`SELECT * FROM sales_object_structure_components WHERE structureId IN (${placeholders(structureIds)}) AND status='active' ORDER BY structureId,sortOrder,erpSkuId,id`, structureIds) : [];
  const erpSkuIds = [...new Set(componentRows.map((row) => row.erpSkuId))];
  const erpRows = erpSkuIds.length ? query(`SELECT id,merchantSkuCode,currentState FROM erp_skus WHERE id IN (${placeholders(erpSkuIds)})`, erpSkuIds) : [];
  const group = (rows, key) => { const result = new Map(); for (const row of rows) { const list = result.get(row[key]) || []; list.push(row); result.set(row[key], list); } return result; };
  return {
    linkSkus: new Map(linkSkuRows.map((row) => [row.id, row])), relations: group(relationRows, "linkSkuId"),
    objects: new Map(objectRows.map((row) => [row.id, row])), structures: group(structureRows, "salesObjectId"),
    components: group(componentRows, "structureId"), erpSkus: new Map(erpRows.map((row) => [row.id, row])),
  };
}

function resolveLoaded(salesLinkSkuId, loaded) {
  const result = base(salesLinkSkuId);
  if (!loaded.linkSkus.has(salesLinkSkuId)) return { ...result, status: "not_found" };
  result.salesLinkId = loaded.linkSkus.get(salesLinkSkuId).salesLinkId;
  const relations = loaded.relations.get(salesLinkSkuId) || [];
  if (!relations.length) return result;
  if (relations.length !== 1) {
    result.status = "conflict"; result.conflicts.push({ code: "multiple_active_sales_objects", relationIds: relations.map((row) => row.id) }); return result;
  }
  const relation = relations[0]; const object = loaded.objects.get(relation.salesObjectId);
  if (!object || object.status !== "active") {
    result.status = "conflict"; result.conflicts.push({ code: "sales_object_not_active", salesObjectId: relation.salesObjectId }); return result;
  }
  result.salesObject = { id: object.id, objectCode: object.objectCode, objectType: object.objectType, source: object.source, sourceCode: object.sourceCode, status: object.status };
  result.relation = { id: relation.id, effectiveFrom: relation.effectiveFrom, effectiveTo: relation.effectiveTo || null, sourceType: relation.sourceType, sourceBatchId: relation.sourceBatchId || null };
  const structures = loaded.structures.get(object.id) || [];
  if (!structures.length) { result.status = "incomplete"; result.warnings.push({ code: "SALES_OBJECT_STRUCTURE_MISSING" }); return result; }
  if (structures.length !== 1) { result.status = "conflict"; result.conflicts.push({ code: "multiple_active_sales_object_structures", structureIds: structures.map((row) => row.id) }); return result; }
  const structure = structures[0]; const components = (loaded.components.get(structure.id) || []).map((row) => ({
    erpSkuId: row.erpSkuId, merchantSkuCode: loaded.erpSkus.get(row.erpSkuId)?.merchantSkuCode || null,
    quantity: Number(row.quantity), sortOrder: Number(row.sortOrder), status: row.status,
  }));
  result.structure = { id: structure.id, version: Number(structure.version), structureHash: structure.structureHash, effectiveFrom: structure.effectiveFrom, effectiveTo: structure.effectiveTo || null, shape: shape(components) };
  result.components = components;
  if (!components.length) { result.status = "incomplete"; result.warnings.push({ code: "SALES_OBJECT_COMPONENTS_MISSING" }); return result; }
  const invalidErps = components.filter((row) => loaded.erpSkus.get(row.erpSkuId)?.currentState !== "active");
  if (invalidErps.length) { result.status = "conflict"; result.conflicts.push({ code: "ERP_SKU_NOT_ACTIVE", erpSkuIds: invalidErps.map((row) => row.erpSkuId) }); return result; }
  const validSingle = object.objectType !== "single" || (components.length === 1 && Number(components[0].quantity) === 1);
  const validBundle = object.objectType !== "bundle" || components.length > 1 || Number(components[0]?.quantity) > 1;
  if (!validSingle || !validBundle) { result.status = "conflict"; result.conflicts.push({ code: "SALES_OBJECT_TYPE_STRUCTURE_MISMATCH" }); return result; }
  result.status = "active_complete"; result.isComplete = true; result.isUsable = true; return result;
}

export function resolveLinkSkuSalesObject(input = {}, options = {}) {
  const salesLinkSkuId = clean(input.salesLinkSkuId);
  if (!salesLinkSkuId) return { ...base(null), status: "invalid_input" };
  const loaded = load(options.database || getDatabase(), [salesLinkSkuId], options.onQuery);
  return resolveLoaded(salesLinkSkuId, loaded);
}

export function resolveLinkSkuSalesObjects(input = {}, options = {}) {
  const ids = [...new Set((Array.isArray(input.salesLinkSkuIds) ? input.salesLinkSkuIds : []).map(clean).filter(Boolean))];
  const response = { capability: "ResolveLinkSkuSalesObjects", contractVersion: CONTRACT_VERSION, results: {} };
  if (!ids.length) return response;
  const loaded = load(options.database || getDatabase(), ids, options.onQuery);
  for (const id of ids) response.results[id] = resolveLoaded(id, loaded);
  return response;
}

export default resolveLinkSkuSalesObject;
