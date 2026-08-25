import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { getLatestCompletePlatformBatch } from "./v3PlatformBatchService.js";

const normalizeCode = (value) => String(value ?? "").trim().replace(/\.0+$/u, "").toLowerCase();
const displayCode = (value) => String(value ?? "").trim().replace(/\.0+$/u, "");
const stableId = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
const dayMs = 86400000;

function daySpan(start, end) {
  const left = new Date(`${start}T00:00:00Z`).getTime();
  const right = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) return 0;
  return Math.floor((right - left) / dayMs) + 1;
}

function subtractDays(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - Math.max(0, days) * dayMs).toISOString().slice(0, 10);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name));
}

export function deriveSalesActivePolicy(options = {}) {
  const database = options.database || getDatabase();
  const batches = database.prepare(`SELECT sourceBatchId,MIN(saleDate) periodStart,MAX(saleDate) periodEnd,
      COUNT(DISTINCT saleDate) coverageDays
    FROM connection_sku_sales_daily_facts
    GROUP BY sourceBatchId
    ORDER BY periodEnd DESC`).all();
  const maxSaleDate = options.asOfDate || batches[0]?.periodEnd || null;
  if (!maxSaleDate) return { asOfDate: null, windowDays: 0, cutoffDate: null, basis: "no_sales_facts", batches: [] };
  const latestSpan = batches[0] ? daySpan(batches[0].periodStart, batches[0].periodEnd) : 0;
  const ends = [...new Set(batches.map((item) => item.periodEnd).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const cadenceCandidates = ends.slice(0, 6).map((date, index) => {
    if (!ends[index + 1]) return 0;
    return Math.max(1, daySpan(ends[index + 1], date) - 1);
  }).filter((value) => value > 0 && (!latestSpan || value <= latestSpan * 2));
  const cadenceDays = cadenceCandidates.length >= 2 ? median(cadenceCandidates) : 0;
  const requested = Number(options.salesWindowDays || 0);
  const windowDays = requested > 0 ? Math.floor(requested) : Math.max(1, latestSpan, cadenceDays ? cadenceDays * 3 : 0);
  return {
    asOfDate: maxSaleDate,
    windowDays,
    cutoffDate: subtractDays(maxSaleDate, windowDays - 1),
    basis: requested > 0 ? "explicit" : cadenceDays ? "latest_coverage_or_three_import_cycles" : "latest_committed_coverage",
    latestCoverageDays: latestSpan,
    observedCadenceDays: cadenceDays || null,
    batches: batches.slice(0, 6),
  };
}

function sourceRank(sources) {
  if (sources.has("platform_active")) return "active";
  if (sources.has("bundle_dependency")) return "active_dependency";
  if (sources.has("sales_active")) return "sales_active";
  return null;
}

export function calculateOperatingErpSet(options = {}) {
  const database = options.database || getDatabase();
  const calculatedAt = options.calculatedAt || new Date().toISOString();
  const platformBatch = getLatestCompletePlatformBatch(database);
  if (!platformBatch) throw new Error("operating_erp_platform_complete_batch_missing");
  const salesPolicy = deriveSalesActivePolicy({ database, asOfDate: options.asOfDate, salesWindowDays: options.salesWindowDays });

  const erpRows = database.prepare(`SELECT id,merchantSkuCode,currentState,createdAt,updatedAt
    FROM erp_skus ORDER BY id`).all();
  const erpById = new Map(erpRows.map((item) => [item.id, item]));
  const erpByCode = new Map(erpRows.map((item) => [normalizeCode(item.merchantSkuCode), item]));
  const salesObjects = database.prepare(`SELECT id,objectCode,normalizedObjectCode,objectType,status,firstSeenAt,lastSeenAt
    FROM sales_objects`).all();
  const salesObjectById = new Map(salesObjects.map((item) => [item.id, item]));
  const salesObjectByCode = new Map(salesObjects.map((item) => [normalizeCode(item.normalizedObjectCode || item.objectCode), item]));
  const activeRelations = database.prepare(`SELECT linkSkuId,salesObjectId,effectiveFrom,effectiveTo,sourceBatchId
    FROM sales_link_sku_sales_object_relations WHERE status='active'`).all();
  const relationByLinkSku = new Map(activeRelations.map((item) => [item.linkSkuId, item]));
  const componentRows = database.prepare(`SELECT s.salesObjectId,s.id structureId,s.version,s.sourceType,c.erpSkuId,c.quantity
    FROM sales_object_structures s
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE s.status='active'`).all();
  const structureStateRows = database.prepare(`SELECT salesObjectId,sourceType,status,sourceState
    FROM sales_object_structures`).all();
  const structureStatesByObject = new Map();
  for (const item of structureStateRows) {
    const rows = structureStatesByObject.get(item.salesObjectId) || [];
    rows.push(item);
    structureStatesByObject.set(item.salesObjectId, rows);
  }
  const componentsByObject = new Map();
  const authoritativeBundleComponentsByObject = new Map();
  for (const item of componentRows) {
    const rows = componentsByObject.get(item.salesObjectId) || [];
    rows.push(item);
    componentsByObject.set(item.salesObjectId, rows);
    if (item.sourceType === "wangdian_suite_api" && salesObjectById.get(item.salesObjectId)?.objectType === "bundle") {
      const authoritativeRows = authoritativeBundleComponentsByObject.get(item.salesObjectId) || [];
      authoritativeRows.push(item);
      authoritativeBundleComponentsByObject.set(item.salesObjectId, authoritativeRows);
    }
  }

  const members = new Map();
  const evidence = [];
  const exceptions = [];
  const historicalErpIds = new Set();
  const operatingBundleIds = new Set();

  const ensureMember = ({ code, erpSkuId = null, salesObjectId = null, seed = null }) => {
    const normalizedCode = normalizeCode(code);
    if (!normalizedCode) return null;
    let member = members.get(normalizedCode);
    if (!member) {
      member = {
        normalizedCode,
        merchantSkuCode: displayCode(code),
        erpSkuId,
        salesObjectId,
        sources: new Set(),
        firstSeenAt: seed?.createdAt || seed?.firstSeenAt || calculatedAt,
        lastSeenAt: seed?.updatedAt || seed?.lastSeenAt || calculatedAt,
      };
      members.set(normalizedCode, member);
    } else {
      member.erpSkuId ||= erpSkuId;
      member.salesObjectId ||= salesObjectId;
    }
    return member;
  };

  const addEvidence = ({ code, sourceType, sourceObjectType, sourceObjectId, sourceBatchId = null, erpSkuId = null, salesObjectId = null, metadata = {}, seed = null }) => {
    const member = ensureMember({ code, erpSkuId, salesObjectId, seed });
    if (!member) return;
    member.sources.add(sourceType);
    member.lastSeenAt = calculatedAt;
    evidence.push({
      id: stableId("operating-erp-evidence", `${member.normalizedCode}|${sourceType}|${sourceObjectType}|${sourceObjectId}`),
      normalizedCode: member.normalizedCode,
      sourceType,
      sourceObjectType,
      sourceObjectId,
      sourceBatchId,
      firstSeenAt: seed?.createdAt || seed?.firstSeenAt || calculatedAt,
      lastSeenAt: calculatedAt,
      active: 1,
      calculatedAt,
      metadataJson: JSON.stringify(metadata),
      createdAt: calculatedAt,
      updatedAt: calculatedAt,
    });
  };

  const platformSkus = database.prepare(`SELECT DISTINCT s.id,s.salesLinkId,s.platformSkuCode,s.normalizedPlatformSkuCode,s.createdAt,s.updatedAt
    FROM platform_goods_excel_import_rows r JOIN sales_link_skus s ON s.id=r.salesLinkSkuId
    WHERE r.batchId=?`).all(platformBatch.id);
  for (const sku of platformSkus) {
    const code = displayCode(sku.normalizedPlatformSkuCode || sku.platformSkuCode);
    if (!code) {
      exceptions.push({ type: "platform_erp_code_missing", objectType: "link_sku", objectId: sku.id, code: null });
      continue;
    }
    const relation = relationByLinkSku.get(sku.id);
    const salesObject = relation ? salesObjectById.get(relation.salesObjectId) : salesObjectByCode.get(normalizeCode(code));
    const erpSku = erpByCode.get(normalizeCode(code)) || null;
    const resolvedErpSku = salesObject?.objectType === "single"
      ? (componentsByObject.get(salesObject.id)?.map((item) => erpById.get(item.erpSkuId)).find(Boolean) || erpSku)
      : erpSku;
    if (salesObject?.objectType === "bundle") operatingBundleIds.add(salesObject.id);
    if (!salesObject && !resolvedErpSku) {
      exceptions.push({ type: "platform_erp_not_found", objectType: "link_sku", objectId: sku.id, code });
    }
    if (salesObject?.objectType === "bundle") {
      addEvidence({ code: salesObject.objectCode, sourceType: "platform_active", sourceObjectType: "link_sku", sourceObjectId: sku.id,
        sourceBatchId: platformBatch.id, salesObjectId: salesObject.id, metadata: { salesLinkId: sku.salesLinkId, objectType: "bundle" }, seed: salesObject });
    } else {
      addEvidence({ code: resolvedErpSku?.merchantSkuCode || code, sourceType: "platform_active", sourceObjectType: "link_sku", sourceObjectId: sku.id,
        sourceBatchId: platformBatch.id, erpSkuId: resolvedErpSku?.id || null, salesObjectId: salesObject?.id || null,
        metadata: { salesLinkId: sku.salesLinkId, objectType: salesObject?.objectType || (resolvedErpSku ? "single" : "unresolved") }, seed: resolvedErpSku || salesObject });
    }
    if (resolvedErpSku) historicalErpIds.add(resolvedErpSku.id);
  }

  const salesFacts = salesPolicy.cutoffDate ? database.prepare(`SELECT DISTINCT salesLinkSkuId,erpSkuId
    FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?`).all(salesPolicy.cutoffDate, salesPolicy.asOfDate) : [];
  for (const fact of salesFacts) {
    const relation = relationByLinkSku.get(fact.salesLinkSkuId);
    const salesObject = relation ? salesObjectById.get(relation.salesObjectId) : null;
    if (salesObject?.objectType === "bundle") {
      operatingBundleIds.add(salesObject.id);
      addEvidence({ code: salesObject.objectCode, sourceType: "sales_active", sourceObjectType: "link_sku", sourceObjectId: fact.salesLinkSkuId,
        sourceBatchId: null, salesObjectId: salesObject.id, metadata: { objectType: "bundle", cutoffDate: salesPolicy.cutoffDate }, seed: salesObject });
      continue;
    }
    const directErp = salesObject
      ? componentsByObject.get(salesObject.id)?.map((item) => erpById.get(item.erpSkuId)).find(Boolean)
      : erpById.get(fact.erpSkuId);
    if (!directErp) {
      exceptions.push({ type: "sales_fact_erp_master_missing", objectType: "link_sku", objectId: fact.salesLinkSkuId, code: null });
      continue;
    }
    addEvidence({ code: directErp.merchantSkuCode, sourceType: "sales_active", sourceObjectType: "link_sku", sourceObjectId: fact.salesLinkSkuId,
      erpSkuId: directErp.id, salesObjectId: salesObject?.id || null, metadata: { objectType: "single", cutoffDate: salesPolicy.cutoffDate }, seed: directErp });
    historicalErpIds.add(directErp.id);
  }

  for (const salesObjectId of operatingBundleIds) {
    const salesObject = salesObjectById.get(salesObjectId);
    const components = authoritativeBundleComponentsByObject.get(salesObjectId) || [];
    if (!components.length) {
      const historicalSources = [...new Set((componentsByObject.get(salesObjectId) || []).map((item) => item.sourceType).filter(Boolean))];
      const sourceRemoved = (structureStatesByObject.get(salesObjectId) || []).some((item) => item.sourceType === "wangdian_suite_api" && item.sourceState === "source_removed");
      exceptions.push({ type: sourceRemoved ? "bundle_source_conflict" : "bundle_authoritative_bom_missing",
        objectType: "sales_object", objectId: salesObjectId, code: salesObject?.objectCode || null,
        historicalSources, requiredSource: "wangdian_suite_api", sourceRemoved });
      continue;
    }
    for (const component of components) {
      const erpSku = erpById.get(component.erpSkuId);
      if (!erpSku) {
        exceptions.push({ type: "bundle_component_erp_not_found", objectType: "sales_object", objectId: salesObjectId, code: component.erpSkuId });
        continue;
      }
      addEvidence({ code: erpSku.merchantSkuCode, sourceType: "bundle_dependency", sourceObjectType: "sales_object_structure", sourceObjectId: component.structureId,
        erpSkuId: erpSku.id, salesObjectId, metadata: { bundleCode: salesObject?.objectCode || null, quantity: component.quantity,
          version: component.version, structureSourceType: component.sourceType }, seed: erpSku });
      historicalErpIds.add(erpSku.id);
    }
  }

  for (const row of database.prepare("SELECT DISTINCT erpSkuId FROM connection_sku_sales_daily_facts").all()) historicalErpIds.add(row.erpSkuId);
  const allHistoricallyLinkedComponents = database.prepare(`SELECT DISTINCT c.erpSkuId
    FROM sales_link_sku_sales_object_relations r
    JOIN sales_object_structures s ON s.salesObjectId=r.salesObjectId
    JOIN sales_object_structure_components c ON c.structureId=s.id`).all();
  for (const row of allHistoricallyLinkedComponents) historicalErpIds.add(row.erpSkuId);
  const historicalPlatformCodes = database.prepare(`SELECT DISTINCT COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode) code
    FROM sales_link_skus WHERE trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode,''))<>''`).all();
  for (const row of historicalPlatformCodes) {
    const erpSku = erpByCode.get(normalizeCode(row.code));
    if (erpSku) historicalErpIds.add(erpSku.id);
  }

  for (const erpSku of erpRows) {
    const member = ensureMember({ code: erpSku.merchantSkuCode, erpSkuId: erpSku.id, seed: erpSku });
    const activeStatus = sourceRank(member.sources);
    member.lifecycleStatus = activeStatus || (historicalErpIds.has(erpSku.id) ? "archived" : "external_unused");
  }
  for (const member of members.values()) {
    member.lifecycleStatus ||= (!member.erpSkuId && !member.salesObjectId)
      ? "unresolved"
      : sourceRank(member.sources) || "unresolved";
    member.sourceCount = member.sources.size;
    member.calculatedAt = calculatedAt;
    delete member.sources;
  }

  const normalizedDuplicates = database.prepare(`SELECT lower(trim(merchantSkuCode)) code,COUNT(*) total
    FROM erp_skus GROUP BY lower(trim(merchantSkuCode)) HAVING COUNT(*)>1`).all();
  for (const item of normalizedDuplicates) exceptions.push({ type: "erp_code_conflict", objectType: "erp_sku", objectId: null, code: item.code, total: item.total });
  for (const objectId of operatingBundleIds) {
    const object = salesObjectById.get(objectId);
    if (object && erpByCode.has(normalizeCode(object.objectCode))) {
      exceptions.push({ type: "erp_object_type_conflict", objectType: "sales_object", objectId, code: object.objectCode });
    }
  }

  const memberRows = [...members.values()].sort((a, b) => a.normalizedCode.localeCompare(b.normalizedCode));
  const erpMembers = memberRows.filter((item) => item.erpSkuId);
  const evidenceTypesByCode = new Map();
  for (const item of evidence) {
    const values = evidenceTypesByCode.get(item.normalizedCode) || new Set();
    values.add(item.sourceType);
    evidenceTypesByCode.set(item.normalizedCode, values);
  }
  const has = (member, type) => evidenceTypesByCode.get(member.normalizedCode)?.has(type) || false;
  const operatingErp = erpMembers.filter((item) => ["active", "active_dependency", "sales_active"].includes(item.lifecycleStatus));
  const summary = {
    erpSkuTotal: erpMembers.length,
    platformActive: erpMembers.filter((item) => has(item, "platform_active")).length,
    bundleDependencyOnly: erpMembers.filter((item) => has(item, "bundle_dependency") && !has(item, "platform_active") && !has(item, "sales_active")).length,
    salesActiveOnly: erpMembers.filter((item) => has(item, "sales_active") && !has(item, "platform_active") && !has(item, "bundle_dependency")).length,
    multipleSources: erpMembers.filter((item) => (evidenceTypesByCode.get(item.normalizedCode)?.size || 0) > 1).length,
    operatingErpSet: operatingErp.length,
    operatingObjectSet: memberRows.filter((item) => ["active", "active_dependency", "sales_active"].includes(item.lifecycleStatus)).length,
    operatingBundles: operatingBundleIds.size,
    archived: erpMembers.filter((item) => item.lifecycleStatus === "archived").length,
    externalUnused: erpMembers.filter((item) => item.lifecycleStatus === "external_unused").length,
    unresolvedObjects: memberRows.filter((item) => item.lifecycleStatus === "unresolved").length,
    operatingRatio: erpMembers.length ? operatingErp.length / erpMembers.length : 0,
    evidenceCount: evidence.length,
    exceptionCount: exceptions.length,
  };

  return { calculatedAt, platformBatch, salesPolicy, members: memberRows, evidence, exceptions, summary };
}

export function materializeOperatingErpSet(options = {}) {
  const database = options.database || getDatabase();
  const result = calculateOperatingErpSet({ ...options, database });
  const batchSize = Math.max(25, Number(options.writeBatchSize || process.env.V3_SHADOW_WRITE_BATCH_SIZE || 250));
  const materialization = { writeBatchSize: batchSize, batchCount: 0, longestTransactionMs: 0, membersChanged: 0, evidenceChanged: 0, evidenceDeactivated: 0, lifecycleEventsChanged: 0 };
  const writeBatches = (items, operation) => {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const batch = items.slice(offset, offset + batchSize);
      const started = performance.now();
      database.transaction(() => batch.forEach(operation)).immediate();
      materialization.batchCount += 1;
      materialization.longestTransactionMs = Math.max(materialization.longestTransactionMs, performance.now() - started);
    }
  };
  const insertMember = database.prepare(`INSERT INTO operating_erp_set_members
    (normalizedCode,merchantSkuCode,erpSkuId,salesObjectId,lifecycleStatus,sourceCount,firstSeenAt,lastSeenAt,calculatedAt,updatedAt)
    VALUES (@normalizedCode,@merchantSkuCode,@erpSkuId,@salesObjectId,@lifecycleStatus,@sourceCount,@firstSeenAt,@lastSeenAt,@calculatedAt,@updatedAt)
    ON CONFLICT(normalizedCode) DO UPDATE SET merchantSkuCode=excluded.merchantSkuCode,erpSkuId=COALESCE(excluded.erpSkuId,operating_erp_set_members.erpSkuId),
      salesObjectId=COALESCE(excluded.salesObjectId,operating_erp_set_members.salesObjectId),lifecycleStatus=excluded.lifecycleStatus,
      sourceCount=excluded.sourceCount,lastSeenAt=excluded.lastSeenAt,calculatedAt=excluded.calculatedAt,updatedAt=excluded.updatedAt
    WHERE operating_erp_set_members.merchantSkuCode IS NOT excluded.merchantSkuCode
       OR operating_erp_set_members.erpSkuId IS NOT COALESCE(excluded.erpSkuId,operating_erp_set_members.erpSkuId)
       OR operating_erp_set_members.salesObjectId IS NOT COALESCE(excluded.salesObjectId,operating_erp_set_members.salesObjectId)
       OR operating_erp_set_members.lifecycleStatus IS NOT excluded.lifecycleStatus
       OR operating_erp_set_members.sourceCount IS NOT excluded.sourceCount`);
  const insertEvidence = database.prepare(`INSERT INTO operating_erp_set_evidence
    (id,normalizedCode,sourceType,sourceObjectType,sourceObjectId,sourceBatchId,firstSeenAt,lastSeenAt,active,calculatedAt,metadataJson,createdAt,updatedAt)
    VALUES (@id,@normalizedCode,@sourceType,@sourceObjectType,@sourceObjectId,@sourceBatchId,@firstSeenAt,@lastSeenAt,@active,@calculatedAt,@metadataJson,@createdAt,@updatedAt)
    ON CONFLICT(normalizedCode,sourceType,sourceObjectType,sourceObjectId) DO UPDATE SET sourceBatchId=excluded.sourceBatchId,lastSeenAt=excluded.lastSeenAt,
      active=1,calculatedAt=excluded.calculatedAt,metadataJson=excluded.metadataJson,updatedAt=excluded.updatedAt
    WHERE operating_erp_set_evidence.sourceBatchId IS NOT excluded.sourceBatchId
       OR operating_erp_set_evidence.active IS NOT 1
       OR operating_erp_set_evidence.metadataJson IS NOT excluded.metadataJson`);
  const desiredEvidenceKeys = new Set(result.evidence.map((item) => `${item.normalizedCode}\u0000${item.sourceType}\u0000${item.sourceObjectType}\u0000${item.sourceObjectId}`));
  const memberRows = database.prepare(`SELECT normalizedCode,merchantSkuCode,erpSkuId,salesObjectId,lifecycleStatus,sourceCount
    FROM operating_erp_set_members`).all();
  const memberByCode = new Map(memberRows.map((item) => [item.normalizedCode, item]));
  const lifecycleSourceTypesByCode = new Map();
  for (const item of result.evidence) {
    const sources = lifecycleSourceTypesByCode.get(item.normalizedCode) || new Set();
    sources.add(item.sourceType);
    lifecycleSourceTypesByCode.set(item.normalizedCode, sources);
  }
  const desiredMemberCodes = new Set(result.members.map((item) => item.normalizedCode));
  const changedMembers = result.members.filter((member) => {
    const current = memberByCode.get(member.normalizedCode);
    if (!current) return true;
    return current.merchantSkuCode !== member.merchantSkuCode
      || current.erpSkuId !== (member.erpSkuId || current.erpSkuId)
      || current.salesObjectId !== (member.salesObjectId || current.salesObjectId)
      || current.lifecycleStatus !== member.lifecycleStatus
      || Number(current.sourceCount) !== Number(member.sourceCount);
  });
  const lifecycleChanges = changedMembers.filter((member) => member.erpSkuId && memberByCode.get(member.normalizedCode)?.lifecycleStatus !== member.lifecycleStatus)
    .map((member) => ({
      id: stableId("operating-erp-lifecycle-event", `${member.normalizedCode}|${memberByCode.get(member.normalizedCode)?.lifecycleStatus || "initial"}|${member.lifecycleStatus}|${result.calculatedAt}`),
      normalizedCode: member.normalizedCode,
      erpSkuId: member.erpSkuId,
      fromStatus: memberByCode.get(member.normalizedCode)?.lifecycleStatus || null,
      toStatus: member.lifecycleStatus,
      sourceTypesJson: JSON.stringify([...(lifecycleSourceTypesByCode.get(member.normalizedCode) || [])].sort()),
      reason: member.lifecycleStatus === "active" ? "latest_platform_batch"
        : member.lifecycleStatus === "active_dependency" ? "current_bundle_dependency"
          : member.lifecycleStatus === "sales_active" ? "recent_daily_fact"
            : member.lifecycleStatus === "archived" ? "historical_business_evidence_without_current_operating_evidence"
              : "no_reliable_business_evidence",
      calculatedAt: result.calculatedAt,
      createdAt: result.calculatedAt,
    }));
  const evidenceRows = database.prepare(`SELECT id,normalizedCode,sourceType,sourceObjectType,sourceObjectId,sourceBatchId,active,metadataJson
    FROM operating_erp_set_evidence`).all();
  const evidenceByKey = new Map(evidenceRows.map((item) => [`${item.normalizedCode}\u0000${item.sourceType}\u0000${item.sourceObjectType}\u0000${item.sourceObjectId}`, item]));
  const changedEvidence = result.evidence.filter((item) => {
    const key = `${item.normalizedCode}\u0000${item.sourceType}\u0000${item.sourceObjectType}\u0000${item.sourceObjectId}`;
    const current = evidenceByKey.get(key);
    return !current || current.sourceBatchId !== item.sourceBatchId || Number(current.active) !== 1 || current.metadataJson !== item.metadataJson;
  });
  const staleEvidence = evidenceRows.filter((item) => item.active === 1 && (
    !desiredEvidenceKeys.has(`${item.normalizedCode}\u0000${item.sourceType}\u0000${item.sourceObjectType}\u0000${item.sourceObjectId}`)
  ));
  const deactivateEvidence = database.prepare("UPDATE operating_erp_set_evidence SET active=0,calculatedAt=?,updatedAt=? WHERE id=? AND active=1");
  const clearStaleMemberSources = database.prepare("UPDATE operating_erp_set_members SET sourceCount=0,calculatedAt=?,updatedAt=? WHERE normalizedCode=? AND sourceCount<>0");
  const insertLifecycleEvent = database.prepare(`INSERT OR IGNORE INTO operating_erp_lifecycle_events
    (id,normalizedCode,erpSkuId,fromStatus,toStatus,sourceTypesJson,reason,calculatedAt,createdAt)
    VALUES (@id,@normalizedCode,@erpSkuId,@fromStatus,@toStatus,@sourceTypesJson,@reason,@calculatedAt,@createdAt)`);
  writeBatches(changedMembers, (member) => {
    const info = insertMember.run({ ...member, updatedAt: result.calculatedAt });
    materialization.membersChanged += Number(info.changes || 0);
  });
  writeBatches(lifecycleChanges, (event) => {
    const info = insertLifecycleEvent.run(event);
    materialization.lifecycleEventsChanged += Number(info.changes || 0);
  });
  writeBatches(changedEvidence, (item) => {
    const info = insertEvidence.run(item);
    materialization.evidenceChanged += Number(info.changes || 0);
  });
  writeBatches(staleEvidence, (item) => {
    const info = deactivateEvidence.run(result.calculatedAt, result.calculatedAt, item.id);
    materialization.evidenceDeactivated += Number(info.changes || 0);
  });
  writeBatches(memberRows.filter((item) => Number(item.sourceCount) !== 0 && !desiredMemberCodes.has(item.normalizedCode)), (item) => {
    const info = clearStaleMemberSources.run(result.calculatedAt, result.calculatedAt, item.normalizedCode);
    materialization.membersChanged += Number(info.changes || 0);
  });
  result.materialization = materialization;
  return result;
}

export function queryOperatingErpSet(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize) || 50));
  const where = [];
  const params = {};
  if (input.lifecycleStatus) { where.push("m.lifecycleStatus=@lifecycleStatus"); params.lifecycleStatus = String(input.lifecycleStatus); }
  if (input.sourceType) {
    where.push("EXISTS (SELECT 1 FROM operating_erp_set_evidence e WHERE e.normalizedCode=m.normalizedCode AND e.active=1 AND e.sourceType=@sourceType)");
    params.sourceType = String(input.sourceType);
  }
  if (input.keyword) { where.push("(m.merchantSkuCode LIKE @keyword OR m.normalizedCode LIKE @keyword)"); params.keyword = `%${String(input.keyword).trim()}%`; }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(database.prepare(`SELECT COUNT(*) total FROM operating_erp_set_members m ${filter}`).get(params).total);
  const items = database.prepare(`SELECT m.*,
      (SELECT group_concat(sourceType,',') FROM (SELECT DISTINCT sourceType FROM operating_erp_set_evidence e WHERE e.normalizedCode=m.normalizedCode AND e.active=1 ORDER BY sourceType)) sourceTypes
    FROM operating_erp_set_members m ${filter}
    ORDER BY CASE m.lifecycleStatus WHEN 'active' THEN 0 WHEN 'active_dependency' THEN 1 WHEN 'sales_active' THEN 2 WHEN 'unresolved' THEN 3 WHEN 'archived' THEN 4 ELSE 5 END,
      m.merchantSkuCode LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items };
}

export function readOperatingErpSetSummary(options = {}) {
  const database = options.database || getDatabase();
  const counts = database.prepare(`SELECT lifecycleStatus,COUNT(*) total FROM operating_erp_set_members GROUP BY lifecycleStatus`).all();
  const sources = database.prepare(`SELECT sourceType,COUNT(DISTINCT normalizedCode) total FROM operating_erp_set_evidence WHERE active=1 GROUP BY sourceType`).all();
  return {
    calculatedAt: database.prepare("SELECT MAX(calculatedAt) value FROM operating_erp_set_members").get()?.value || null,
    total: counts.reduce((sum, item) => sum + Number(item.total), 0),
    counts: Object.fromEntries(counts.map((item) => [item.lifecycleStatus, Number(item.total)])),
    sources: Object.fromEntries(sources.map((item) => [item.sourceType, Number(item.total)])),
  };
}

export function simulateOperatingErpImpacts(calculation, options = {}) {
  const database = options.database || getDatabase();
  const operatingIds = new Set(calculation.members.filter((item) => item.erpSkuId && ["active", "active_dependency", "sales_active"].includes(item.lifecycleStatus)).map((item) => item.erpSkuId));
  const operatingProducts = new Set();
  let mappedOperatingSkus = 0;
  for (const item of database.prepare("SELECT erpSkuId,productId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL").all()) {
    if (!operatingIds.has(item.erpSkuId)) continue;
    mappedOperatingSkus += 1;
    operatingProducts.add(item.productId);
  }
  const latestInventoryDate = database.prepare("SELECT MAX(businessDate) value FROM erp_sku_inventory_daily_summaries").get()?.value || null;
  const inventoryRows = latestInventoryDate ? database.prepare(`SELECT erpSkuId,stockNum,availableSendStock,inventoryCostAmount
    FROM erp_sku_inventory_daily_summaries WHERE businessDate=?`).all(latestInventoryDate) : [];
  const nonOperatingInventory = inventoryRows.filter((item) => !operatingIds.has(item.erpSkuId));
  const positive = nonOperatingInventory.filter((item) => Number(item.stockNum) !== 0 || Number(item.availableSendStock) !== 0);
  const unresolvedCodes = calculation.members.filter((item) => item.lifecycleStatus === "unresolved").length;
  const v3GoodsQueryTargets = operatingIds.size + unresolvedCodes;
  return {
    currentErpSkus: calculation.summary.erpSkuTotal,
    operatingErpSkus: operatingIds.size,
    defaultHiddenErpSkus: calculation.summary.erpSkuTotal - operatingIds.size,
    operatingProducts: operatingProducts.size,
    mappedOperatingSkus,
    latestInventoryDate,
    nonOperatingInventorySkus: positive.length,
    nonOperatingStockQuantity: positive.reduce((sum, item) => sum + Number(item.stockNum || 0), 0),
    nonOperatingInventoryCostAmount: positive.reduce((sum, item) => sum + Number(item.inventoryCostAmount || 0), 0),
    legacyGoodsQueryTargets: calculation.summary.erpSkuTotal,
    unresolvedQueryCandidates: unresolvedCodes,
    v3GoodsQueryTargets,
    v3SuiteQueryTargets: calculation.summary.operatingBundles + unresolvedCodes,
    goodsQueryReductionRatio: calculation.summary.erpSkuTotal ? 1 - v3GoodsQueryTargets / calculation.summary.erpSkuTotal : 0,
  };
}

export default calculateOperatingErpSet;
