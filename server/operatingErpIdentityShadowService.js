import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const normalizeCode = (value) => String(value ?? "").trim().replace(/\.0+$/u, "").toLowerCase();
const displayCode = (value) => String(value ?? "").trim().replace(/\.0+$/u, "");
const operatingStatuses = new Set(["active", "active_dependency", "sales_active"]);

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function structureHash(components) {
  const shape = [...components]
    .map((item) => [normalizeCode(item.code ?? item.merchantSkuCode), Number(item.quantity)])
    .filter(([code]) => code)
    .sort((left, right) => left[0].localeCompare(right[0]));
  return crypto.createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

export function resolveWangdianIdentityContract(input = {}) {
  const goodsStatus = input.goodsError ? "source_unavailable" : input.goodsFound ? "found" : (input.goodsChecked ? "not_found" : "not_checked");
  const suiteStatus = input.suiteError ? "source_unavailable" : input.suiteFound ? "found" : (input.suiteChecked ? "not_found" : "not_checked");
  if (goodsStatus === "source_unavailable" || suiteStatus === "source_unavailable") {
    return { goodsStatus, suiteStatus, resolvedIdentityType: "unresolved", identityStatus: "source_unavailable" };
  }
  if (goodsStatus === "found" && suiteStatus === "found") {
    return { goodsStatus, suiteStatus, resolvedIdentityType: "conflict", identityStatus: "sku_type_conflict" };
  }
  if ((goodsStatus === "found" && input.goodsDeleted) || (suiteStatus === "found" && input.suiteDeleted)) {
    return {
      goodsStatus,
      suiteStatus,
      resolvedIdentityType: suiteStatus === "found" ? "bundle" : "single",
      identityStatus: "source_conflict",
    };
  }
  if (suiteStatus === "found") return { goodsStatus, suiteStatus, resolvedIdentityType: "bundle", identityStatus: "confirmed" };
  if (goodsStatus === "found") return { goodsStatus, suiteStatus, resolvedIdentityType: "single", identityStatus: "confirmed" };
  if (goodsStatus === "not_found" && suiteStatus === "not_found") {
    return { goodsStatus, suiteStatus, resolvedIdentityType: "unresolved", identityStatus: "erp_not_found" };
  }
  return { goodsStatus, suiteStatus, resolvedIdentityType: "unresolved", identityStatus: "not_checked" };
}

function currentIdentity(member, salesObject, erpSku) {
  if (salesObject?.objectType === "bundle" && erpSku) return "conflict";
  if (salesObject?.objectType === "bundle") return "bundle";
  if (erpSku) return "single";
  if (salesObject?.objectType === "single") return "single";
  return "none";
}

function bundleValidation({ suite, structure, components, erpById, erpByCode, productMappedIds }) {
  if (!suite) return { status: "not_checked", productMappingStatus: "not_checked", detail: {} };
  const liveComponents = (suite.components || []).filter((item) => !item.deleted);
  if (!liveComponents.length) return { status: "bom_missing", productMappingStatus: "not_checked", detail: {} };
  if (liveComponents.some((item) => !normalizeCode(item.skuCode))) return { status: "component_missing", productMappingStatus: "not_checked", detail: {} };
  if (liveComponents.some((item) => !(Number(item.quantity) > 0))) return { status: "quantity_invalid", productMappingStatus: "not_checked", detail: {} };
  const currentComponents = components || [];
  const resolvedLiveComponents = liveComponents.map((item) => ({ ...item, erpSku: item.erpSku || erpByCode.get(normalizeCode(item.skuCode)) || null }));
  const missingErpCodes = resolvedLiveComponents.filter((item) => !item.erpSkuId && !item.erpSku).map((item) => normalizeCode(item.skuCode));
  if (missingErpCodes.length) return { status: "component_missing", productMappingStatus: "not_checked", detail: { missingErpCodes } };
  const liveShape = resolvedLiveComponents.map((item) => ({ code: item.skuCode, quantity: item.quantity }));
  const currentShape = currentComponents.map((item) => ({ code: erpById.get(item.erpSkuId)?.merchantSkuCode, quantity: item.quantity }));
  const status = structure && structureHash(liveShape) !== structureHash(currentShape) ? "structure_conflict" : "complete";
  const componentIds = resolvedLiveComponents.map((item) => item.erpSkuId || item.erpSku?.id).filter(Boolean);
  const mapped = componentIds.filter((id) => productMappedIds.has(id)).length;
  const productMappingStatus = !componentIds.length ? "not_checked" : mapped === componentIds.length ? "complete" : mapped ? "partial" : "missing";
  return { status, productMappingStatus, detail: { componentCount: liveComponents.length, mappedComponents: mapped, structureHash: structureHash(liveShape) } };
}

export function calculateOperatingErpIdentityShadow(options = {}) {
  const database = options.database || getDatabase();
  const calculatedAt = options.calculatedAt || new Date().toISOString();
  if (!tableExists(database, "operating_erp_set_members")) throw new Error("operating_erp_set_missing");
  const live = new Map(Object.entries(options.liveObservations || {}).map(([code, item]) => [normalizeCode(code), item]));
  const members = database.prepare(`SELECT * FROM operating_erp_set_members
    WHERE lifecycleStatus IN ('active','active_dependency','sales_active','unresolved')`).all();
  const erpRows = database.prepare("SELECT id,merchantSkuCode,sourceUpdatedAt,rawSourceData FROM erp_skus").all();
  const erpById = new Map(erpRows.map((item) => [item.id, item]));
  const erpByCode = new Map(erpRows.map((item) => [normalizeCode(item.merchantSkuCode), item]));
  const salesObjects = database.prepare("SELECT * FROM sales_objects").all();
  const objectById = new Map(salesObjects.map((item) => [item.id, item]));
  const objectByCode = new Map(salesObjects.map((item) => [normalizeCode(item.normalizedObjectCode || item.objectCode), item]));
  const structures = database.prepare("SELECT * FROM sales_object_structures WHERE status='active'").all();
  const structureByObject = new Map(structures.map((item) => [item.salesObjectId, item]));
  const componentRows = database.prepare("SELECT * FROM sales_object_structure_components WHERE status='active'").all();
  const componentsByObject = new Map();
  for (const item of componentRows) componentsByObject.set(item.salesObjectId, [...(componentsByObject.get(item.salesObjectId) || []), item]);
  const productMappedIds = new Set(database.prepare("SELECT erpSkuId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL").all().map((item) => item.erpSkuId));

  const observations = [];
  const comparisons = [];
  for (const member of members) {
    const code = normalizeCode(member.normalizedCode || member.merchantSkuCode);
    const erpSku = erpByCode.get(code) || (member.erpSkuId ? erpById.get(member.erpSkuId) : null);
    // Bundle-dependency evidence records its parent Sales Object for traceability.
    // That parent must never be mistaken for the component ERP SKU's own identity.
    const salesObject = objectByCode.get(code) || null;
    const liveItem = live.get(code);
    const materializedSuiteAuthoritative = salesObject?.objectType === "bundle" && salesObject.sourceType === "wangdian_suite_api";
    const goodsFound = liveItem?.goodsChecked ? Boolean(liveItem.goods) : Boolean(erpSku);
    const suiteFound = liveItem?.suiteChecked ? Boolean(liveItem.suite) : materializedSuiteAuthoritative;
    const contract = resolveWangdianIdentityContract({
      goodsFound, suiteFound,
      goodsChecked: liveItem?.goodsChecked ?? Boolean(erpSku),
      suiteChecked: liveItem?.suiteChecked ?? materializedSuiteAuthoritative,
      goodsError: liveItem?.goodsError,
      suiteError: liveItem?.suiteError,
      goodsDeleted: Boolean(liveItem?.goods?.goodsDeleted || liveItem?.goods?.erpStatus === "inactive"),
      suiteDeleted: Boolean(liveItem?.suite?.deleted),
    });
    const sourceMode = liveItem ? (erpSku || materializedSuiteAuthoritative ? "mixed" : "live") : "materialized";
    const observation = {
      normalizedCode: code,
      merchantSkuCode: displayCode(member.merchantSkuCode),
      inOperatingErpSet: operatingStatuses.has(member.lifecycleStatus) && Boolean(member.erpSkuId) ? 1 : 0,
      inOperatingObjectSet: member.lifecycleStatus === "active" || member.lifecycleStatus === "sales_active" || member.lifecycleStatus === "unresolved" ? 1 : 0,
      ...contract,
      goodsErpSkuId: erpSku?.id || null,
      suiteSalesObjectId: salesObject?.objectType === "bundle" ? salesObject.id : null,
      sourceMode,
      sourceCheckedAt: liveItem?.checkedAt || null,
      sourceUpdatedAt: liveItem?.suite?.modifiedAt || erpSku?.sourceUpdatedAt || salesObject?.updatedAt || null,
      detailJson: JSON.stringify({ goodsError: liveItem?.goodsError || null, suiteError: liveItem?.suiteError || null, live: Boolean(liveItem) }),
      calculatedAt,
      updatedAt: calculatedAt,
    };
    observations.push(observation);

    const currentType = currentIdentity(member, salesObject, erpSku);
    let comparisonStatus = contract.identityStatus === "confirmed"
      ? (!salesObject && observation.inOperatingObjectSet ? "v3_fill" : currentType === contract.resolvedIdentityType ? "consistent" : currentType === "none" ? "v3_fill" : "type_conflict")
      : contract.identityStatus === "sku_type_conflict" ? "type_conflict"
        : contract.identityStatus === "source_conflict" ? "source_conflict"
        : contract.identityStatus === "erp_not_found" ? "erp_not_found" : "source_unavailable";
    if (contract.identityStatus === "not_checked") comparisonStatus = currentType === "none" ? "erp_not_found" : "consistent";
    let bundle = { status: "not_applicable", productMappingStatus: erpSku ? (productMappedIds.has(erpSku.id) ? "complete" : "missing") : "not_applicable", detail: {} };
    if (contract.resolvedIdentityType === "bundle") {
      const suite = liveItem?.suite || (materializedSuiteAuthoritative ? {
        components: (componentsByObject.get(salesObject.id) || []).map((item) => ({ ...item, skuCode: erpById.get(item.erpSkuId)?.merchantSkuCode })),
      } : null);
      bundle = bundleValidation({ suite, structure: structureByObject.get(salesObject?.id), components: componentsByObject.get(salesObject?.id), erpById, erpByCode, productMappedIds });
      if (["structure_conflict","component_missing","quantity_invalid","bom_missing"].includes(bundle.status) && comparisonStatus === "consistent") comparisonStatus = "type_conflict";
    }
    comparisons.push({
      normalizedCode: code,
      merchantSkuCode: displayCode(member.merchantSkuCode),
      currentIdentityType: currentType,
      v3IdentityType: contract.resolvedIdentityType,
      comparisonStatus,
      currentSalesObjectId: salesObject?.id || null,
      projectedSalesObjectCode: contract.identityStatus === "confirmed" && observation.inOperatingObjectSet ? displayCode(member.merchantSkuCode) : null,
      bundleStructureStatus: bundle.status,
      productMappingStatus: bundle.productMappingStatus,
      detailJson: JSON.stringify(bundle.detail),
      calculatedAt,
      updatedAt: calculatedAt,
    });
  }

  const count = (items, field, value) => items.filter((item) => item[field] === value).length;
  const operatingErp = observations.filter((item) => item.inOperatingErpSet);
  const operatingObjects = observations.filter((item) => item.inOperatingObjectSet);
  const observationByCode = new Map(observations.map((item) => [item.normalizedCode, item]));
  const bundleComparisons = comparisons.filter((item) => item.v3IdentityType === "bundle");
  const confirmedBundleComparisons = bundleComparisons.filter((item) => observationByCode.get(item.normalizedCode)?.identityStatus === "confirmed");
  const confirmedObjectComparisons = comparisons.filter((item) => item.projectedSalesObjectCode && observationByCode.get(item.normalizedCode)?.identityStatus === "confirmed");
  const completeObjects = comparisons.filter((item) => item.projectedSalesObjectCode
    && ["consistent", "v3_fill"].includes(item.comparisonStatus)
    && item.productMappingStatus === "complete"
    && !["bom_missing","component_missing","quantity_invalid","structure_conflict"].includes(item.bundleStructureStatus));
  return {
    calculatedAt, observations, comparisons,
    summary: {
      operatingErpObjects: operatingErp.length,
      operatingIdentityCandidates: operatingObjects.length,
      identityConfirmed: operatingObjects.filter((item) => item.identityStatus === "confirmed").length,
      singleConfirmed: operatingObjects.filter((item) => item.resolvedIdentityType === "single" && item.identityStatus === "confirmed").length,
      bundleConfirmed: operatingObjects.filter((item) => item.resolvedIdentityType === "bundle" && item.identityStatus === "confirmed").length,
      identityConflict: count(operatingObjects, "identityStatus", "sku_type_conflict"),
      sourceConflict: count(operatingObjects, "identityStatus", "source_conflict"),
      identityNotFound: count(operatingObjects, "identityStatus", "erp_not_found"),
      sourceUnavailable: count(operatingObjects, "identityStatus", "source_unavailable"),
      identityNotChecked: count(operatingObjects, "identityStatus", "not_checked"),
      shadowConsistent: count(comparisons, "comparisonStatus", "consistent"),
      shadowV3Fill: count(comparisons, "comparisonStatus", "v3_fill"),
      shadowConflict: count(comparisons, "comparisonStatus", "type_conflict"),
      completeBundles: count(confirmedBundleComparisons, "bundleStructureStatus", "complete"),
      bundleBomMissing: count(confirmedBundleComparisons, "bundleStructureStatus", "bom_missing"),
      bundleComponentMissing: count(confirmedBundleComparisons, "bundleStructureStatus", "component_missing"),
      bundleQuantityInvalid: count(confirmedBundleComparisons, "bundleStructureStatus", "quantity_invalid"),
      bundleStructureConflict: count(confirmedBundleComparisons, "bundleStructureStatus", "structure_conflict"),
      productMappingComplete: comparisons.filter((item) => item.productMappingStatus === "complete").length,
      productMappingPartial: count(comparisons, "productMappingStatus", "partial"),
      productMappingMissing: count(comparisons, "productMappingStatus", "missing"),
      productMappingCompleteObjects: count(confirmedObjectComparisons, "productMappingStatus", "complete"),
      productMappingPartialObjects: count(confirmedObjectComparisons, "productMappingStatus", "partial"),
      productMappingMissingObjects: count(confirmedObjectComparisons, "productMappingStatus", "missing"),
      projectedSalesObjects: confirmedObjectComparisons.length,
      projectedSalesObjectsNew: confirmedObjectComparisons.filter((item) => !item.currentSalesObjectId).length,
      automaticClosedLoop: completeObjects.length,
    },
  };
}

export function materializeOperatingErpIdentityShadow(options = {}) {
  const database = options.database || getDatabase();
  const result = calculateOperatingErpIdentityShadow({ ...options, database });
  const insertObservation = database.prepare(`INSERT INTO operating_erp_identity_observations
    (normalizedCode,merchantSkuCode,inOperatingErpSet,inOperatingObjectSet,goodsStatus,suiteStatus,resolvedIdentityType,identityStatus,goodsErpSkuId,suiteSalesObjectId,sourceMode,sourceCheckedAt,sourceUpdatedAt,detailJson,calculatedAt,updatedAt)
    VALUES (@normalizedCode,@merchantSkuCode,@inOperatingErpSet,@inOperatingObjectSet,@goodsStatus,@suiteStatus,@resolvedIdentityType,@identityStatus,@goodsErpSkuId,@suiteSalesObjectId,@sourceMode,@sourceCheckedAt,@sourceUpdatedAt,@detailJson,@calculatedAt,@updatedAt)
    ON CONFLICT(normalizedCode) DO UPDATE SET merchantSkuCode=excluded.merchantSkuCode,inOperatingErpSet=excluded.inOperatingErpSet,inOperatingObjectSet=excluded.inOperatingObjectSet,goodsStatus=excluded.goodsStatus,suiteStatus=excluded.suiteStatus,resolvedIdentityType=excluded.resolvedIdentityType,identityStatus=excluded.identityStatus,goodsErpSkuId=excluded.goodsErpSkuId,suiteSalesObjectId=excluded.suiteSalesObjectId,sourceMode=excluded.sourceMode,sourceCheckedAt=excluded.sourceCheckedAt,sourceUpdatedAt=excluded.sourceUpdatedAt,detailJson=excluded.detailJson,calculatedAt=excluded.calculatedAt,updatedAt=excluded.updatedAt`);
  const insertComparison = database.prepare(`INSERT INTO operating_erp_identity_shadow_comparisons
    (normalizedCode,merchantSkuCode,currentIdentityType,v3IdentityType,comparisonStatus,currentSalesObjectId,projectedSalesObjectCode,bundleStructureStatus,productMappingStatus,detailJson,calculatedAt,updatedAt)
    VALUES (@normalizedCode,@merchantSkuCode,@currentIdentityType,@v3IdentityType,@comparisonStatus,@currentSalesObjectId,@projectedSalesObjectCode,@bundleStructureStatus,@productMappingStatus,@detailJson,@calculatedAt,@updatedAt)
    ON CONFLICT(normalizedCode) DO UPDATE SET merchantSkuCode=excluded.merchantSkuCode,currentIdentityType=excluded.currentIdentityType,v3IdentityType=excluded.v3IdentityType,comparisonStatus=excluded.comparisonStatus,currentSalesObjectId=excluded.currentSalesObjectId,projectedSalesObjectCode=excluded.projectedSalesObjectCode,bundleStructureStatus=excluded.bundleStructureStatus,productMappingStatus=excluded.productMappingStatus,detailJson=excluded.detailJson,calculatedAt=excluded.calculatedAt,updatedAt=excluded.updatedAt`);
  database.transaction(() => {
    database.prepare("DELETE FROM operating_erp_identity_shadow_comparisons").run();
    database.prepare("DELETE FROM operating_erp_identity_observations").run();
    for (const item of result.observations) insertObservation.run(item);
    for (const item of result.comparisons) insertComparison.run(item);
  }).immediate();
  return result;
}

export function queryOperatingErpIdentityShadow(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize) || 50));
  const where = [];
  const params = {};
  if (input.identityStatus) { where.push("o.identityStatus=@identityStatus"); params.identityStatus = String(input.identityStatus); }
  if (input.comparisonStatus) { where.push("c.comparisonStatus=@comparisonStatus"); params.comparisonStatus = String(input.comparisonStatus); }
  if (input.keyword) { where.push("(o.merchantSkuCode LIKE @keyword OR o.normalizedCode LIKE @keyword)"); params.keyword = `%${String(input.keyword).trim()}%`; }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(database.prepare(`SELECT COUNT(*) total FROM operating_erp_identity_observations o JOIN operating_erp_identity_shadow_comparisons c USING(normalizedCode) ${filter}`).get(params).total);
  const items = database.prepare(`SELECT o.*,c.currentIdentityType,c.v3IdentityType,c.comparisonStatus,c.currentSalesObjectId,c.projectedSalesObjectCode,c.bundleStructureStatus,c.productMappingStatus,c.detailJson comparisonDetailJson
    FROM operating_erp_identity_observations o JOIN operating_erp_identity_shadow_comparisons c USING(normalizedCode) ${filter}
    ORDER BY CASE o.identityStatus WHEN 'source_unavailable' THEN 0 WHEN 'sku_type_conflict' THEN 1 WHEN 'source_conflict' THEN 2 WHEN 'erp_not_found' THEN 3 WHEN 'not_checked' THEN 4 ELSE 5 END,o.merchantSkuCode LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items };
}

export default calculateOperatingErpIdentityShadow;
