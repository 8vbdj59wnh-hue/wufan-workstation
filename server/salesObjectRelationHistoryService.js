import crypto from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const normalized = (value) => clean(value).replace(/\.0+$/u, "").toLowerCase();
const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
const parseJson = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const datePart = (value) => clean(value).slice(0, 10);

function sourceModifiedAt(row) {
  const raw = parseJson(row.rawDataJson);
  const sourceTime = clean(raw["最后修改时间"] || raw.lastModifiedAt || raw.updatedAt);
  return sourceTime ? sourceTime.replace(" ", "T") : clean(row.batchCompletedAt || row.batchCreatedAt);
}

export function readPlatformSkuRelationHistory(database, linkSkuId) {
  const identity = database.prepare(`SELECT s.id,s.platformSkuId,l.platformGoodsId
    FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId WHERE s.id=?`).get(clean(linkSkuId));
  if (!identity?.platformSkuId) return [];
  const rows = database.prepare(`SELECT r.batchId,r.rowNumber,r.salesLinkId,r.salesLinkSkuId,r.platformGoodsId,r.platformSkuId,
      r.merchantSkuCode,r.systemGoodsType,r.rawDataJson,b.status batchStatus,b.syncMode,
      b.createdAt batchCreatedAt,b.completedAt batchCompletedAt,b.fileName
    FROM platform_goods_excel_import_rows r
    LEFT JOIN data_sync_batches b ON b.id=r.batchId
    WHERE r.platformSkuId=? AND r.platformGoodsId=? AND trim(COALESCE(r.merchantSkuCode,''))<>''
    ORDER BY COALESCE(b.completedAt,b.createdAt),r.rowNumber`).all(identity.platformSkuId, identity.platformGoodsId);
  const byEvidence = new Map();
  for (const row of rows) {
    const observedAt = sourceModifiedAt(row);
    if (!observedAt) continue;
    const key = `${observedAt}|${normalized(row.merchantSkuCode)}`;
    byEvidence.set(key, {
      batchId: row.batchId,
      rowNumber: Number(row.rowNumber),
      fileName: row.fileName || null,
      batchStatus: row.batchStatus || null,
      syncMode: row.syncMode || null,
      platformGoodsId: row.platformGoodsId,
      platformSkuId: row.platformSkuId,
      merchantSkuCode: clean(row.merchantSkuCode),
      normalizedCode: normalized(row.merchantSkuCode),
      systemGoodsType: clean(row.systemGoodsType) || null,
      observedAt,
    });
  }
  return [...byEvidence.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.rowNumber - right.rowNumber);
}

function structureErpIds(database, salesObjectId) {
  return new Set(database.prepare(`SELECT DISTINCT c.erpSkuId
    FROM sales_object_structures s JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE s.salesObjectId=? AND s.status IN ('active','superseded')`).all(salesObjectId).map((row) => row.erpSkuId));
}

export function analyzeAuthoritativeRelationChange(database, { linkSkuId, currentSalesObjectId, targetSalesObjectId } = {}) {
  const currentObject = database.prepare("SELECT id,objectCode,normalizedObjectCode FROM sales_objects WHERE id=?").get(clean(currentSalesObjectId));
  const targetObject = database.prepare("SELECT id,objectCode,normalizedObjectCode FROM sales_objects WHERE id=?").get(clean(targetSalesObjectId));
  if (!currentObject || !targetObject || currentObject.id === targetObject.id) return { classification: "relation_conflict", reason: "sales_object_identity_invalid" };
  const history = readPlatformSkuRelationHistory(database, linkSkuId);
  if (history.length < 2) return { classification: "relation_conflict", reason: "platform_relation_history_insufficient", history };
  const latest = history.at(-1);
  const prior = [...history].reverse().find((row) => row.observedAt < latest.observedAt && row.normalizedCode !== latest.normalizedCode);
  if (!prior) return { classification: "relation_conflict", reason: "platform_relation_change_not_found", history };
  if (prior.normalizedCode !== normalized(currentObject.normalizedObjectCode || currentObject.objectCode)
    || latest.normalizedCode !== normalized(targetObject.normalizedObjectCode || targetObject.objectCode)) {
    return { classification: "relation_conflict", reason: "platform_relation_history_does_not_explain_current_pair", history, prior, latest };
  }
  if (!latest.batchStatus || !["succeeded", "completed"].includes(latest.batchStatus)) {
    return { classification: "relation_conflict", reason: "latest_platform_evidence_not_committed", history, prior, latest };
  }
  const boundaryDate = datePart(latest.observedAt);
  const oldErpSkuIds = structureErpIds(database, currentObject.id);
  const targetErpSkuIds = structureErpIds(database, targetObject.id);
  const facts = database.prepare(`SELECT f.id,f.saleDate,f.erpSkuId FROM connection_sku_sales_daily_facts f
    WHERE f.salesLinkSkuId=? ORDER BY f.saleDate,f.id`).all(clean(linkSkuId));
  const unexplainedFacts = facts.filter((fact) => {
    if (fact.saleDate < boundaryDate) return !oldErpSkuIds.has(fact.erpSkuId);
    if (fact.saleDate > boundaryDate) return !targetErpSkuIds.has(fact.erpSkuId);
    return true;
  });
  if (unexplainedFacts.length) {
    return { classification: "relation_conflict", reason: "sales_facts_not_explained_by_historical_relation", history, prior, latest, unexplainedFacts };
  }
  return {
    classification: "historical_relation_change",
    reason: "authoritative_platform_relation_changed",
    history, prior, latest,
    effectiveFrom: prior.observedAt,
    effectiveTo: latest.observedAt,
    factsVerified: facts.length,
  };
}

export function applyAuthoritativeRelationChange(database, {
  linkSkuId, currentRelation, targetSalesObjectId, targetSourceType, targetSourceBatchId = null,
  targetSourceReference = {}, actor = null, timestamp = new Date().toISOString(), analysis,
} = {}) {
  if (analysis?.classification !== "historical_relation_change") throw new Error("historical_relation_change_not_verified");
  if (!currentRelation || currentRelation.status !== "active") throw new Error("active_relation_missing_for_history_transition");
  const effectiveFrom = analysis.effectiveFrom;
  const effectiveTo = analysis.effectiveTo;
  const historicalEvidence = {
    classification: "historical_relation_change",
    prior: analysis.prior,
    current: analysis.latest,
    factsVerified: Number(analysis.factsVerified || 0),
  };
  const currentReference = { ...parseJson(currentRelation.sourceReferenceJson), historicalRelationChange: historicalEvidence };
  const targetReference = { ...targetSourceReference, historicalRelationChange: historicalEvidence };
  const relationId = stableId("sales-link-sku-sales-object-v3", linkSkuId, targetSalesObjectId);
  database.prepare(`UPDATE sales_link_sku_sales_object_relations
    SET effectiveFrom=?,effectiveTo=?,status='superseded',sourceReferenceJson=?,updatedAt=? WHERE id=? AND status='active'`)
    .run(effectiveFrom, effectiveTo, JSON.stringify(currentReference), timestamp, currentRelation.id);
  database.prepare(`INSERT INTO sales_link_sku_sales_object_relations
    (id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,createdAt,updatedAt)
    VALUES (?,?,?,?,'active',?,?,?,?,?,?,?)`)
    .run(relationId, linkSkuId, targetSalesObjectId, effectiveTo, targetSourceType, targetSourceBatchId,
      JSON.stringify(targetReference), actor, actor ? timestamp : null, timestamp, timestamp);
  return { relationId, effectiveFrom, effectiveTo, classification: "historical_relation_change" };
}

export function resolveHistoricalRelationForFact(database, { linkSkuId, erpSkuId, businessDate } = {}) {
  const date = datePart(businessDate);
  if (!clean(linkSkuId) || !clean(erpSkuId) || !date) return null;
  const relations = database.prepare(`SELECT r.*,o.objectCode,o.objectType
    FROM sales_link_sku_sales_object_relations r JOIN sales_objects o ON o.id=r.salesObjectId
    WHERE r.linkSkuId=? AND r.status IN ('active','superseded')
      AND substr(r.effectiveFrom,1,10)<=?
      AND (r.effectiveTo IS NULL OR ?<substr(r.effectiveTo,1,10))
    ORDER BY r.effectiveFrom DESC,r.id`).all(linkSkuId, date, date);
  if (relations.length !== 1) return null;
  const relation = relations[0];
  const component = database.prepare(`SELECT c.erpSkuId,c.quantity,s.id structureId
    FROM sales_object_structures s JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE s.salesObjectId=? AND s.status IN ('active','superseded') AND c.erpSkuId=?
    ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,s.version DESC LIMIT 1`).get(relation.salesObjectId, erpSkuId);
  if (!component) return null;
  return {
    relationId: relation.id,
    salesObjectId: relation.salesObjectId,
    salesObjectCode: relation.objectCode,
    structureId: component.structureId,
    erpSkuId: component.erpSkuId,
    quantity: Number(component.quantity),
    effectiveFrom: relation.effectiveFrom,
    effectiveTo: relation.effectiveTo,
    classification: relation.status === "superseded" ? "historical_relation_change" : "current_relation",
  };
}
