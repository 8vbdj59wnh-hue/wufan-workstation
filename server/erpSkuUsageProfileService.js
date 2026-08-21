import { getDatabase } from "./db.js";

export const ERP_SKU_PRIMARY_USAGES = Object.freeze([
  "sale_goods",
  "packaging_material",
  "consumable_auxiliary",
  "unknown",
]);

const text = (value) => String(value ?? "").trim();
const enabled = (value) => value === true || text(value) === "1" || text(value).toLowerCase() === "true";
const placeholders = (values) => values.map(() => "?").join(",");
const parseJson = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const SELLABLE_STRUCTURED_CATEGORY = /花瓶|仿真花|干花|假花|杯子|摆件|家居用品|叉勺/;

function latestInventorySql() {
  return `SELECT * FROM (
    SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.erpSkuId ORDER BY i.businessDate DESC,i.updatedAt DESC,i.id DESC) position
    FROM erp_sku_inventory_daily_summaries i
  ) WHERE position=1`;
}

function loadEvidence(database, erpSkuIds = null) {
  const ids = Array.isArray(erpSkuIds) ? [...new Set(erpSkuIds.map(text).filter(Boolean))] : null;
  const idFilter = ids?.length ? ` WHERE s.id IN (${placeholders(ids)})` : "";
  const profileReady = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='erp_sku_usage_profiles'").get());
  const profileFields = profileReady
    ? `up.confirmedPrimaryUsage,up.confirmedSaleGoods,up.confirmedBundleComponent,up.confirmedBy,up.confirmedAt,
      up.evidenceNote,up.createdAt confirmationCreatedAt,up.updatedAt confirmationUpdatedAt`
    : `NULL confirmedPrimaryUsage,0 confirmedSaleGoods,0 confirmedBundleComponent,NULL confirmedBy,NULL confirmedAt,
      NULL evidenceNote,NULL confirmationCreatedAt,NULL confirmationUpdatedAt`;
  const rows = database.prepare(`SELECT s.id erpSkuId,s.merchantSkuCode,s.specificationName,s.rawSourceData skuRaw,
      g.goodsName,g.shortName,g.category,g.productType,g.rawSourceData goodsRaw,m.lifecycleStatus,
      pm.productId,p.name productName,${profileFields}
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN operating_erp_set_members m ON m.erpSkuId=s.id
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=s.id AND pm.currentState='active'
    LEFT JOIN products p ON p.id=pm.productId
    ${profileReady ? "LEFT JOIN erp_sku_usage_profiles up ON up.erpSkuId=s.id" : ""}${idFilter}`).all(...(ids || []));
  if (!rows.length) return [];
  const rowIds = rows.map((row) => row.erpSkuId);
  const inSql = placeholders(rowIds);
  const directFact = new Set(database.prepare(`SELECT DISTINCT erpSkuId FROM connection_sku_sales_daily_facts WHERE erpSkuId IN (${inSql})`).all(...rowIds).map((row) => row.erpSkuId));
  const platformEvidence = new Set(database.prepare(`SELECT DISTINCT m.erpSkuId FROM operating_erp_set_members m
    JOIN operating_erp_set_evidence e ON e.normalizedCode=m.normalizedCode AND e.sourceType='platform_active'
    WHERE m.erpSkuId IN (${inSql})`).all(...rowIds).map((row) => row.erpSkuId));
  const singleRelation = new Set(database.prepare(`SELECT DISTINCT c.erpSkuId FROM sales_object_structure_components c
    JOIN sales_object_structures st ON st.id=c.structureId AND st.status='active'
    JOIN sales_objects o ON o.id=st.salesObjectId AND o.objectType='single'
    JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=o.id AND r.status='active'
    WHERE c.status='active' AND c.erpSkuId IN (${inSql})`).all(...rowIds).map((row) => row.erpSkuId));
  const bundleComponent = new Set(database.prepare(`SELECT DISTINCT c.erpSkuId FROM sales_object_structure_components c
    JOIN sales_object_structures st ON st.id=c.structureId AND st.status='active' AND st.sourceType='wangdian_suite_api'
    JOIN sales_objects o ON o.id=st.salesObjectId AND o.objectType='bundle' AND o.status='active'
    JOIN operating_erp_set_members parent ON parent.salesObjectId=o.id AND parent.lifecycleStatus IN ('active','sales_active')
    WHERE c.status='active' AND c.erpSkuId IN (${inSql})`).all(...rowIds).map((row) => row.erpSkuId));
  return rows.map((row) => ({ ...row, evidence: {
    directDailyFact: directFact.has(row.erpSkuId),
    platformEvidence: platformEvidence.has(row.erpSkuId),
    activeSingleRelation: singleRelation.has(row.erpSkuId),
    currentBundleComponent: bundleComponent.has(row.erpSkuId),
    productMapping: Boolean(row.productId),
  } }));
}

function classifyAutomatic(row) {
  const goodsRaw = parseJson(row.goodsRaw);
  const skuRaw = parseJson(row.skuRaw);
  const structuredCategory = text(row.category || goodsRaw.class_name);
  const searchableName = [row.merchantSkuCode,row.goodsName,row.shortName,row.specificationName].map(text).join(" ").toLowerCase();
  const structuredPackaging = /打包材料|包装材料|包装耗材/.test(structuredCategory);
  const structuredConsumable = /耗材|辅料|原料|辅助材料|生产物料/.test(structuredCategory) && !structuredPackaging;
  const structuredSellable = SELLABLE_STRUCTURED_CATEGORY.test(structuredCategory)
    && !structuredPackaging && !structuredConsumable;
  const packagingCandidate = !structuredPackaging && /包装|包材|纸箱|泡沫|内衬|胶带|气泡膜|充气膜|气柱|打包/.test(searchableName);
  const consumableCandidate = !structuredConsumable && /耗材|辅料|原料|辅助材料/.test(searchableName);
  const saleGoods = row.evidence.directDailyFact || row.evidence.platformEvidence || row.evidence.activeSingleRelation;
  const bundleComponent = row.evidence.currentBundleComponent;
  let primaryUsage = "unknown";
  let confidence = "unknown";
  let classificationStatus = "unknown";
  const reasonCodes = [];
  if (structuredPackaging) {
    primaryUsage = "packaging_material"; confidence = "high"; classificationStatus = "auto_confirmed";
    reasonCodes.push("WANGDIAN_STRUCTURED_PACKAGING_CATEGORY");
  } else if (structuredConsumable) {
    primaryUsage = "consumable_auxiliary"; confidence = "high"; classificationStatus = "auto_confirmed";
    reasonCodes.push("WANGDIAN_STRUCTURED_CONSUMABLE_CATEGORY");
  } else if (saleGoods) {
    primaryUsage = "sale_goods"; confidence = "high"; classificationStatus = "auto_confirmed";
    reasonCodes.push("DIRECT_SALES_EVIDENCE");
  } else if (packagingCandidate) {
    classificationStatus = "packaging_candidate"; confidence = "candidate";
    reasonCodes.push("NAME_PACKAGING_CANDIDATE_ONLY");
  } else if (consumableCandidate) {
    classificationStatus = "consumable_candidate"; confidence = "candidate";
    reasonCodes.push("NAME_CONSUMABLE_CANDIDATE_ONLY");
  }
  if (row.evidence.directDailyFact) reasonCodes.push("DIRECT_DAILY_FACT");
  if (row.evidence.platformEvidence) reasonCodes.push("PLATFORM_EVIDENCE");
  if (row.evidence.activeSingleRelation) reasonCodes.push("ACTIVE_SINGLE_RELATION");
  if (bundleComponent) reasonCodes.push("CURRENT_WANGDIAN_BOM_COMPONENT");
  if (row.evidence.productMapping) reasonCodes.push("PRODUCT_MAPPING_PRESENT");
  const usageConflict = (structuredPackaging || structuredConsumable) && saleGoods;
  if (usageConflict) {
    classificationStatus = "usage_conflict";
    reasonCodes.push("STRUCTURED_USAGE_DIRECT_SALES_CONFLICT");
  }
  return { primaryUsage, saleGoods, bundleComponent, confidence, classificationStatus, reasonCodes,
    usageConflict,
    sourceFields: { category: structuredCategory || null, structuredSellable, productType: text(row.productType || goodsRaw.goods_type) || null,
      goodsType: goodsRaw.goods_type ?? null, classId: goodsRaw.class_id ?? null, skuLargeType: skuRaw.large_type ?? null } };
}

function overlayConfirmation(row, automatic) {
  if (!row.confirmedPrimaryUsage) return { ...automatic, confirmation: null, usageConflict: Boolean(automatic.usageConflict) };
  const confirmed = {
    primaryUsage: row.confirmedPrimaryUsage,
    saleGoods: Boolean(row.confirmedSaleGoods),
    bundleComponent: Boolean(row.confirmedBundleComponent) || automatic.bundleComponent,
  };
  const conflicts = [];
  if (automatic.confidence === "high" && automatic.primaryUsage !== "unknown" && automatic.primaryUsage !== confirmed.primaryUsage) conflicts.push("PRIMARY_USAGE_SOURCE_CONFLICT");
  if (automatic.saleGoods && !confirmed.saleGoods) conflicts.push("DIRECT_SALES_TAG_CONFLICT");
  const usageConflict = automatic.usageConflict || conflicts.length > 0;
  return {
    ...automatic,
    ...confirmed,
    confidence: "manual",
    classificationStatus: usageConflict ? "usage_conflict" : "manual_confirmed",
    reasonCodes: [...automatic.reasonCodes, "MANUAL_CONFIRMATION", ...conflicts],
    usageConflict,
    confirmation: { confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt, evidenceNote: row.evidenceNote,
      createdAt: row.confirmationCreatedAt, updatedAt: row.confirmationUpdatedAt },
  };
}

export function classifyErpSkuUsages(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const rows = loadEvidence(database, input.erpSkuIds);
  return rows.map((row) => {
    const classified = overlayConfirmation(row, classifyAutomatic(row));
    return { erpSkuId: row.erpSkuId, merchantSkuCode: row.merchantSkuCode, goodsName: row.goodsName,
      specificationName: row.specificationName, productId: row.productId || null, productName: row.productName || null,
      operatingLifecycleStatus: row.lifecycleStatus || null, evidence: row.evidence, ...classified };
  });
}

function recommendUnknownUsage(item) {
  if (item.primaryUsage !== "unknown") return {
    recommendedPrimaryUsage: item.primaryUsage,
    recommendationConfidence: item.confidence,
    recommendationStatus: "already_classified",
    recommendationReasons: [...item.reasonCodes],
  };
  if (item.sourceFields.structuredSellable && item.evidence.productMapping) return {
    recommendedPrimaryUsage: "sale_goods",
    recommendationConfidence: "high",
    recommendationStatus: "recommended_not_applied",
    recommendationReasons: ["WANGDIAN_STRUCTURED_SELLABLE_CATEGORY", "PRODUCT_MAPPING_PRESENT"],
  };
  if (item.classificationStatus === "packaging_candidate") return {
    recommendedPrimaryUsage: "packaging_material",
    recommendationConfidence: "candidate",
    recommendationStatus: "candidate_only",
    recommendationReasons: ["NAME_PACKAGING_CANDIDATE_ONLY"],
  };
  if (item.classificationStatus === "consumable_candidate") return {
    recommendedPrimaryUsage: "consumable_auxiliary",
    recommendationConfidence: "candidate",
    recommendationStatus: "candidate_only",
    recommendationReasons: ["NAME_CONSUMABLE_CANDIDATE_ONLY"],
  };
  return { recommendedPrimaryUsage: "unknown", recommendationConfidence: "unknown",
    recommendationStatus: "insufficient_evidence", recommendationReasons: [] };
}

export function readUnknownErpUsageConvergence(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const inventory = new Map(database.prepare(`WITH latest_inventory AS (${latestInventorySql()})
    SELECT erpSkuId,businessDate inventoryDate,COALESCE(stockNum,0) inventoryQuantity,
      COALESCE(availableSendStock,0) availableInventoryQuantity,COALESCE(inventoryCostAmount,0) inventoryAmount
    FROM latest_inventory`).all().map((row) => [row.erpSkuId,row]));
  let items = classifyErpSkuUsages({}, { database }).filter((item) => item.primaryUsage === "unknown").map((item) => {
    const stock = inventory.get(item.erpSkuId) || { inventoryDate: null, inventoryQuantity: 0, availableInventoryQuantity: 0, inventoryAmount: 0 };
    const recommendation = recommendUnknownUsage(item);
    const hasInventory = Number(stock.inventoryQuantity || 0) > 0 || Number(stock.availableInventoryQuantity || 0) > 0;
    const hasHistoricalSalesEvidence = item.evidence.directDailyFact || item.evidence.platformEvidence || item.evidence.activeSingleRelation;
    const priority = item.evidence.productMapping ? "P1_product_mapping" : hasInventory ? "P2_inventory"
      : hasHistoricalSalesEvidence ? "P3_historical_sales" : "P4_no_operating_evidence";
    const operating = ["active","active_dependency","sales_active"].includes(item.operatingLifecycleStatus);
    const bundleEvidenceGap = item.operatingLifecycleStatus === "active_dependency" && !item.bundleComponent;
    return { ...item, ...stock, ...recommendation, priority, hasInventory, hasHistoricalSalesEvidence,
      affectsCurrentProductView: operating && Boolean(item.productId), bundleEvidenceGap };
  });
  const keyword = text(input.keyword).toLowerCase();
  if (keyword) items = items.filter((item) => [item.merchantSkuCode,item.goodsName,item.specificationName,item.productName].some((value) => text(value).toLowerCase().includes(keyword)));
  if (text(input.priority)) items = items.filter((item) => item.priority === text(input.priority));
  if (enabled(input.productMappingOnly)) items = items.filter((item) => item.evidence.productMapping);
  if (enabled(input.inventoryOnly)) items = items.filter((item) => item.hasInventory);
  if (enabled(input.nonOperatingInventoryOnly)) items = items.filter((item) => item.hasInventory && ["archived","external_unused"].includes(item.operatingLifecycleStatus));
  items.sort((a,b) => a.priority.localeCompare(b.priority) || Number(b.inventoryAmount)-Number(a.inventoryAmount)
    || Number(b.inventoryQuantity)-Number(a.inventoryQuantity) || a.merchantSkuCode.localeCompare(b.merchantSkuCode));
  const summarize = (rows) => ({ erpSkuCount: rows.length, productCount: new Set(rows.map((row) => row.productId).filter(Boolean)).size,
    inventoryQuantity: rows.reduce((sum,row) => sum+Number(row.inventoryQuantity || 0),0),
    inventoryAmount: rows.reduce((sum,row) => sum+Number(row.inventoryAmount || 0),0) });
  const nonOperatingInventory = items.filter((item) => ["archived","external_unused"].includes(item.operatingLifecycleStatus) && item.hasInventory);
  const projectedSaleGoods = nonOperatingInventory.filter((item) => item.recommendedPrimaryUsage === "sale_goods" && item.recommendationConfidence === "high");
  const remainingInventoryUnknown = nonOperatingInventory.filter((item) => item.recommendedPrimaryUsage === "unknown" || item.recommendationConfidence === "candidate");
  const p1 = items.filter((item) => item.priority === "P1_product_mapping" && ["archived","external_unused"].includes(item.operatingLifecycleStatus) && item.hasInventory);
  const page = Math.max(1,Number(input.page || 1)); const pageSize = Math.min(200,Math.max(1,Number(input.pageSize || 50)));
  const highConfidenceRecommendations = items.filter((item) => item.recommendationStatus === "recommended_not_applied" && item.recommendationConfidence === "high");
  const remainingUnknown = items.filter((item) => item.recommendedPrimaryUsage === "unknown" || item.recommendationConfidence === "candidate");
  return { summary: { totalUnknown: summarize(items),
      highConfidenceRecommendations: summarize(highConfidenceRecommendations), remainingUnknown: summarize(remainingUnknown),
      p1UnknownProductMappingInventory: summarize(p1),
      p1Recommendations: {
        saleGoods: summarize(p1.filter((item) => item.recommendedPrimaryUsage === "sale_goods" && item.recommendationConfidence === "high")),
        packagingMaterial: summarize(p1.filter((item) => item.recommendedPrimaryUsage === "packaging_material" && item.recommendationConfidence === "high")),
        consumableAuxiliary: summarize(p1.filter((item) => item.recommendedPrimaryUsage === "consumable_auxiliary" && item.recommendationConfidence === "high")),
        unknown: summarize(p1.filter((item) => item.recommendedPrimaryUsage === "unknown" || item.recommendationConfidence === "candidate")),
      },
      projectedNonOperatingSaleGoodsInventory: summarize(projectedSaleGoods),
      remainingNonOperatingInventoryUnknown: summarize(remainingInventoryUnknown),
      affectsCurrentProductView: summarize(items.filter((item) => item.affectsCurrentProductView)),
      remainingUnknownAffectingProductView: summarize(remainingUnknown.filter((item) => item.affectsCurrentProductView)),
      bundleEvidenceGap: summarize(items.filter((item) => item.bundleEvidenceGap)),
      completelyWithoutOperatingEvidence: summarize(items.filter((item) => item.priority === "P4_no_operating_evidence")),
    }, items: items.slice((page-1)*pageSize,page*pageSize),
    pagination: { page,pageSize,total:items.length,totalPages:Math.max(1,Math.ceil(items.length/pageSize)) } };
}

export function readErpSkuUsageInventoryGovernance(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const inventoryRows = database.prepare(`WITH latest_inventory AS (${latestInventorySql()})
    SELECT m.erpSkuId,i.businessDate inventoryDate,COALESCE(i.stockNum,0) inventoryQuantity,
      COALESCE(i.availableSendStock,0) availableInventoryQuantity,COALESCE(i.inventoryCostAmount,0) inventoryAmount
    FROM operating_erp_set_members m JOIN latest_inventory i ON i.erpSkuId=m.erpSkuId
    WHERE m.erpSkuId IS NOT NULL AND m.lifecycleStatus IN ('archived','external_unused')
      AND (COALESCE(i.stockNum,0)>0 OR COALESCE(i.availableSendStock,0)>0)`).all();
  const inventoryById = new Map(inventoryRows.map((row) => [row.erpSkuId, row]));
  let items = classifyErpSkuUsages({ erpSkuIds: inventoryRows.map((row) => row.erpSkuId) }, { database }).map((item) => {
    const inventory = inventoryById.get(item.erpSkuId);
    const governanceBucket = item.usageConflict || ["unknown","packaging_candidate","consumable_candidate"].includes(item.classificationStatus)
      ? "data_governance"
      : item.primaryUsage === "sale_goods" ? "product_inventory_risk" : "supply_chain_inventory";
    return { ...item, ...inventory, governanceBucket };
  });
  const keyword = text(input.keyword).toLowerCase();
  if (keyword) items = items.filter((item) => [item.merchantSkuCode,item.goodsName,item.specificationName,item.productName].some((value) => text(value).toLowerCase().includes(keyword)));
  if (text(input.primaryUsage)) items = items.filter((item) => item.primaryUsage === text(input.primaryUsage));
  if (text(input.governanceBucket)) items = items.filter((item) => item.governanceBucket === text(input.governanceBucket));
  if (enabled(input.bundleComponentOnly)) items = items.filter((item) => item.bundleComponent);
  items.sort((a,b) => Number(b.inventoryAmount)-Number(a.inventoryAmount) || Number(b.inventoryQuantity)-Number(a.inventoryQuantity) || a.merchantSkuCode.localeCompare(b.merchantSkuCode));
  const summarize = (selected) => ({ erpSkuCount: selected.length,
    inventoryQuantity: selected.reduce((sum,row) => sum + Number(row.inventoryQuantity || 0),0),
    inventoryAmount: selected.reduce((sum,row) => sum + Number(row.inventoryAmount || 0),0) });
  const primaryUsages = Object.fromEntries(ERP_SKU_PRIMARY_USAGES.map((usage) => [usage, summarize(items.filter((row) => row.primaryUsage === usage))]));
  const buckets = Object.fromEntries(["product_inventory_risk","supply_chain_inventory","data_governance"].map((bucket) => [bucket, summarize(items.filter((row) => row.governanceBucket === bucket))]));
  const tags = { saleGoods: summarize(items.filter((row) => row.saleGoods)), bundleComponent: summarize(items.filter((row) => row.bundleComponent)),
    saleGoodsAndBundleComponent: summarize(items.filter((row) => row.saleGoods && row.bundleComponent)) };
  const mappingConflicts = items.filter((row) => ["packaging_material","consumable_auxiliary"].includes(row.primaryUsage) && row.evidence.productMapping);
  const page = Math.max(1,Number(input.page || 1)); const pageSize = Math.min(200,Math.max(1,Number(input.pageSize || 50)));
  const classificationStatuses = Object.fromEntries(["auto_confirmed","manual_confirmed","packaging_candidate","consumable_candidate","unknown","usage_conflict"]
    .map((status) => [status,summarize(items.filter((row) => row.classificationStatus === status))]));
  return { summary: { total: summarize(items), primaryUsages, classificationStatuses, tags, buckets,
      usageConflictCount: items.filter((row) => row.usageConflict).length, productMappingConflictCount: mappingConflicts.length,
      unknownWithProductMappingCount: items.filter((row) => row.primaryUsage === "unknown" && row.evidence.productMapping).length },
    items: items.slice((page-1)*pageSize,page*pageSize), pagination: { page,pageSize,total:items.length,totalPages:Math.max(1,Math.ceil(items.length/pageSize)) } };
}

export function confirmErpSkuUsageProfile(erpSkuId, input = {}, options = {}) {
  const database = options.database || getDatabase();
  const id = text(erpSkuId); const primaryUsage = text(input.primaryUsage); const confirmedBy = text(options.confirmedBy || input.confirmedBy);
  const evidenceNote = text(input.evidenceNote);
  if (!database.prepare("SELECT 1 FROM erp_skus WHERE id=?").get(id)) throw new Error("ERP SKU不存在。");
  if (!ERP_SKU_PRIMARY_USAGES.includes(primaryUsage)) throw new Error("ERP SKU用途无效。");
  if (!database.prepare("SELECT 1 FROM persons WHERE id=?").get(confirmedBy)) throw new Error("确认人不存在。");
  if (!evidenceNote) throw new Error("人工确认必须填写证据说明。");
  const existing = database.prepare("SELECT * FROM erp_sku_usage_profiles WHERE erpSkuId=?").get(id);
  const saleGoods = enabled(input.saleGoods) ? 1 : 0; const bundleComponent = enabled(input.bundleComponent) ? 1 : 0;
  if (existing && existing.confirmedPrimaryUsage === primaryUsage && existing.confirmedSaleGoods === saleGoods
    && existing.confirmedBundleComponent === bundleComponent && existing.evidenceNote === evidenceNote) return { profile: existing, idempotent: true };
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO erp_sku_usage_profiles
    (erpSkuId,confirmedPrimaryUsage,confirmedSaleGoods,confirmedBundleComponent,confirmedBy,confirmedAt,evidenceNote,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(erpSkuId) DO UPDATE SET
      confirmedPrimaryUsage=excluded.confirmedPrimaryUsage,confirmedSaleGoods=excluded.confirmedSaleGoods,
      confirmedBundleComponent=excluded.confirmedBundleComponent,confirmedBy=excluded.confirmedBy,
      confirmedAt=excluded.confirmedAt,evidenceNote=excluded.evidenceNote,updatedAt=excluded.updatedAt`).run(
    id,primaryUsage,saleGoods,bundleComponent,confirmedBy,timestamp,evidenceNote,existing?.createdAt || timestamp,timestamp);
  return { profile: database.prepare("SELECT * FROM erp_sku_usage_profiles WHERE erpSkuId=?").get(id), idempotent: false };
}

export default classifyErpSkuUsages;
