import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { calculateBomStructureHash, canonicalizeBomComponents, openBomEffectivePeriod } from "./wangdianBomAuthorityService.js";
import { getLatestCompletePlatformBatch } from "./v3PlatformBatchService.js";
import { V3_RELATION_SOURCE_TYPE } from "./v3RelationFeatureFlags.js";

const clean = (value) => String(value ?? "").trim();
const normalized = (value) => clean(value).replace(/\.0+$/u, "").toLowerCase();
const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;

function activeStructure(database, salesObjectId) {
  const structure = database.prepare("SELECT * FROM sales_object_structures WHERE salesObjectId=? AND status='active' ORDER BY version DESC,id DESC LIMIT 1").get(salesObjectId);
  const components = structure ? database.prepare("SELECT erpSkuId,quantity FROM sales_object_structure_components WHERE structureId=? AND status='active' ORDER BY erpSkuId").all(structure.id) : [];
  return { structure, components: canonicalizeBomComponents(components) };
}

function candidates(database) {
  return database.prepare(`SELECT o.normalizedCode,o.merchantSkuCode,o.resolvedIdentityType,o.identityStatus,o.goodsErpSkuId,o.suiteSalesObjectId,
      o.sourceMode,o.sourceCheckedAt,o.sourceUpdatedAt,o.detailJson,
      c.currentSalesObjectId,c.bundleStructureStatus,c.productMappingStatus,c.comparisonStatus
    FROM operating_erp_identity_observations o JOIN operating_erp_identity_shadow_comparisons c USING(normalizedCode)
    WHERE o.inOperatingObjectSet=1 ORDER BY o.normalizedCode`).all();
}

function reviewer(database) {
  return database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE authRole WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1").get()?.id || null;
}

function updateSalesObjectAuthority(database, object, objectType, displayCode, timestamp) {
  const sourceType = objectType === "bundle" ? "wangdian_suite_api" : "wangdian_goods_api";
  if (object.objectCode === displayCode
    && object.source === "wangdian"
    && object.sourceType === sourceType
    && object.sourceCode === displayCode
    && object.status === "active") return false;
  database.prepare(`UPDATE sales_objects SET objectCode=?,source='wangdian',sourceType=?,sourceCode=?,status='active',lastSeenAt=?,updatedAt=? WHERE id=?`)
    .run(displayCode, sourceType, displayCode, timestamp, timestamp, object.id);
  return true;
}

function createSingleProjection(database, candidate, timestamp, actor) {
  const code = normalized(candidate.normalizedCode || candidate.merchantSkuCode);
  const displayCode = clean(candidate.merchantSkuCode) || code;
  const existing = database.prepare("SELECT * FROM sales_objects WHERE normalizedObjectCode=?").get(code);
  if (existing && existing.objectType !== "single") return { status: "type_conflict", salesObjectId: existing.id };
  const salesObjectId = existing?.id || stableId("sales-object-v3", "single", code);
  let objectUpdated = false;
  if (!existing) {
    database.prepare(`INSERT INTO sales_objects
      (id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt)
      VALUES (?,?,?,'single','wangdian','wangdian_goods_api',?,'active',?,?,?,?)`)
      .run(salesObjectId, displayCode, code, displayCode, timestamp, timestamp, timestamp, timestamp);
  } else {
    objectUpdated = updateSalesObjectAuthority(database, existing, "single", displayCode, timestamp);
  }
  const current = activeStructure(database, salesObjectId);
  const target = [{ erpSkuId: candidate.goodsErpSkuId, quantity: 1 }];
  if (current.structure) {
    if (JSON.stringify(current.components) !== JSON.stringify(target)) return { status: "relation_conflict", salesObjectId };
    const structureUpdated = current.structure.sourceType !== "wangdian_goods_api"
      || current.structure.validityBasis !== "exact"
      || current.structure.sourceState !== "active";
    if (structureUpdated) database.prepare(`UPDATE sales_object_structures SET sourceType='wangdian_goods_api',validityBasis='exact',sourceState='active',
      lastVerifiedAt=?,syncedAt=?,updatedAt=? WHERE id=?`).run(timestamp, timestamp, timestamp, current.structure.id);
    return {
      status: existing ? "same" : "created", createdObject: !existing, objectUpdated,
      createdStructure: false, structureUpdated, componentCount: 0, salesObjectId, structureId: current.structure.id,
    };
  }
  if (!actor) throw new Error("sales_object_projection_reviewer_missing");
  const structureHash = calculateBomStructureHash(target);
  const structureId = stableId("sales-object-structure-v3", salesObjectId, structureHash);
  database.prepare(`INSERT INTO sales_object_structures
    (id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,validityBasis,sourceState,lastVerifiedAt,syncedAt,reviewedBy,reviewedAt,activatedAt,createdAt,updatedAt)
    VALUES (?,?,1,?,?,'draft','wangdian_goods_api',?,'exact','active',?,?,?,?,?,?,?)`)
    .run(structureId, salesObjectId, structureHash, timestamp, JSON.stringify({ erpSkuId: candidate.goodsErpSkuId, projection: "v3" }), timestamp, timestamp, actor, timestamp, timestamp, timestamp, timestamp);
  database.prepare(`INSERT INTO sales_object_structure_components
    (id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt)
    VALUES (?,?,?,?,1,1,'active','wangdian_goods_api',?,?,?)`)
    .run(stableId("sales-object-component-v3", structureId, candidate.goodsErpSkuId), structureId, salesObjectId, candidate.goodsErpSkuId, JSON.stringify({ projection: "v3" }), timestamp, timestamp);
  database.prepare("UPDATE sales_object_structures SET status='active',updatedAt=? WHERE id=?").run(timestamp, structureId);
  return { status: "created", createdObject: !existing, objectUpdated, createdStructure: true, structureUpdated: false, componentCount: 1, salesObjectId, structureId };
}

function createBundleStructureVersion(database, object, sourceComponents, candidate, timestamp, actor, bundleSource, current = null) {
  if (!actor) throw new Error("sales_object_projection_reviewer_missing");
  const structureHash = calculateBomStructureHash(sourceComponents);
  const version = Number(current?.structure?.version || 0) + 1;
  const structureId = stableId("sales-object-structure-v3", object.id, version, structureHash);
  if (current?.structure) {
    database.prepare(`UPDATE sales_object_structures SET status='superseded',effectiveTo=?,updatedAt=? WHERE id=? AND status='active'`)
      .run(timestamp, timestamp, current.structure.id);
  }
  database.prepare(`INSERT INTO sales_object_structures
    (id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,validityBasis,sourceState,sourceUpdatedAt,lastVerifiedAt,syncedAt,supersedesStructureId,reviewedBy,reviewedAt,activatedAt,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'draft','wangdian_suite_api',?,'exact','active',?,?,?,?,?,?,?,?,?)`)
    .run(structureId, object.id, version, structureHash, timestamp,
      JSON.stringify({ suiteCode: clean(candidate.merchantSkuCode), projection: "v3" }), bundleSource?.sourceUpdatedAt || null,
      timestamp, timestamp, current?.structure?.id || null, actor, timestamp, timestamp, timestamp, timestamp);
  const insertComponent = database.prepare(`INSERT INTO sales_object_structure_components
    (id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,'active','wangdian_suite_api',?,?,?)`);
  sourceComponents.forEach((component, index) => insertComponent.run(
    stableId("sales-object-component-v3", structureId, component.erpSkuId), structureId, object.id, component.erpSkuId,
    component.quantity, index + 1, JSON.stringify({ projection: "v3" }), timestamp, timestamp,
  ));
  database.prepare("UPDATE sales_object_structures SET status='active',updatedAt=? WHERE id=?").run(timestamp, structureId);
  openBomEffectivePeriod({
    structureId, salesObjectId: object.id, validFrom: timestamp, validityBasis: "exact",
    sourceUpdatedAt: bundleSource?.sourceUpdatedAt, sourceReferenceJson: JSON.stringify({ suiteCode: clean(candidate.merchantSkuCode), projection: "v3" }),
  }, { database });
  return { structureId, version, superseded: Boolean(current?.structure), componentCount: sourceComponents.length };
}

function resolveBundleProjection(database, candidate, timestamp, actor, bundleSource = null) {
  const code = normalized(candidate.normalizedCode || candidate.merchantSkuCode);
  let object = database.prepare("SELECT * FROM sales_objects WHERE normalizedObjectCode=?").get(code);
  const sourceComponents = bundleSource?.components?.length ? canonicalizeBomComponents(bundleSource.components) : null;
  if (!object && !sourceComponents) return { status: "bundle_bom_missing", salesObjectId: null };
  let createdObject = false;
  let objectUpdated = false;
  if (!object) {
    const salesObjectId = stableId("sales-object-v3", "bundle", code);
    database.prepare(`INSERT INTO sales_objects
      (id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt)
      VALUES (?,?,?,'bundle','wangdian','wangdian_suite_api',?,'active',?,?,?,?)`)
      .run(salesObjectId, clean(candidate.merchantSkuCode) || code, code, clean(candidate.merchantSkuCode) || code, timestamp, timestamp, timestamp, timestamp);
    object = database.prepare("SELECT * FROM sales_objects WHERE id=?").get(salesObjectId);
    createdObject = true;
  }
  if (object.objectType !== "bundle") return { status: "type_conflict", salesObjectId: object.id };
  let current = activeStructure(database, object.id);
  let createdStructure = false;
  if (!current.structure && sourceComponents) {
    createBundleStructureVersion(database, object, sourceComponents, candidate, timestamp, actor, bundleSource);
    current = activeStructure(database, object.id);
    createdStructure = true;
  }
  if (!current.structure || !current.components.length) return { status: "bundle_bom_missing", salesObjectId: object.id };
  if (current.structure.sourceType !== "wangdian_suite_api") {
    if (!sourceComponents) return { status: "source_conflict", salesObjectId: object.id };
    if (JSON.stringify(current.components) === JSON.stringify(sourceComponents)) {
      database.prepare(`UPDATE sales_object_structures SET sourceType='wangdian_suite_api',sourceReferenceJson=?,validityBasis='exact',sourceState='active',
        sourceUpdatedAt=?,lastVerifiedAt=?,syncedAt=?,updatedAt=? WHERE id=?`)
        .run(JSON.stringify({ suiteCode: clean(candidate.merchantSkuCode), projection: "v3", authorityTransition: true }),
          bundleSource.sourceUpdatedAt || null, timestamp, timestamp, timestamp, current.structure.id);
      objectUpdated = updateSalesObjectAuthority(database, object, "bundle", clean(candidate.merchantSkuCode) || code, timestamp);
      return { status: "same", createdObject, objectUpdated, createdStructure: false, structureUpdated: true, structureSuperseded: false, componentCount: 0, salesObjectId: object.id, structureId: current.structure.id };
    }
    const version = createBundleStructureVersion(database, object, sourceComponents, candidate, timestamp, actor, bundleSource, current);
    objectUpdated = updateSalesObjectAuthority(database, object, "bundle", clean(candidate.merchantSkuCode) || code, timestamp);
    return { status: "created", createdObject, objectUpdated, createdStructure: true, structureUpdated: false, structureSuperseded: version.superseded, componentCount: version.componentCount, salesObjectId: object.id, structureId: version.structureId };
  }
  if (sourceComponents && JSON.stringify(current.components) !== JSON.stringify(sourceComponents)) {
    const version = createBundleStructureVersion(database, object, sourceComponents, candidate, timestamp, actor, bundleSource, current);
    current = activeStructure(database, object.id);
    objectUpdated = updateSalesObjectAuthority(database, object, "bundle", clean(candidate.merchantSkuCode) || code, timestamp);
    return { status: "created", createdObject, objectUpdated, createdStructure: true, structureUpdated: false, structureSuperseded: version.superseded, componentCount: version.componentCount, salesObjectId: object.id, structureId: version.structureId };
  }
  objectUpdated = updateSalesObjectAuthority(database, object, "bundle", clean(candidate.merchantSkuCode) || code, timestamp);
  return {
    status: createdStructure ? "created" : "same", createdObject, objectUpdated, createdStructure, structureUpdated: false,
    structureSuperseded: false, componentCount: createdStructure ? sourceComponents?.length || 0 : 0,
    salesObjectId: object.id, structureId: current.structure.id,
  };
}

export function compareV3ProjectionResolver(options = {}) {
  const database = options.database || getDatabase();
  const batch = options.batchId ? { id: options.batchId } : getLatestCompletePlatformBatch(database);
  if (!batch) throw new Error("latest_complete_platform_batch_missing");
  const candidateByCode = new Map(candidates(database).map((item) => [normalized(item.normalizedCode), item]));
  const projectedByCode = new Map();
  for (const [code, candidate] of candidateByCode) {
    if (candidate.identityStatus !== "confirmed") continue;
    const object = database.prepare("SELECT id,objectType FROM sales_objects WHERE normalizedObjectCode=?").get(code);
    if (object && object.objectType === candidate.resolvedIdentityType) projectedByCode.set(code, object.id);
    else if (!object) projectedByCode.set(code, stableId("sales-object-v3", candidate.resolvedIdentityType, code));
  }
  const rows = database.prepare(`SELECT DISTINCT s.id,COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode,'') sourceCode
    FROM platform_goods_excel_import_rows r JOIN sales_link_skus s ON s.id=r.salesLinkSkuId
    WHERE r.batchId=? ORDER BY s.id`).all(batch.id);
  const summary = { total: rows.length, same: 0, v3_missing_current: 0, current_missing_v3: 0, relation_conflict: 0, type_conflict: 0, source_conflict: 0, unresolved: 0 };
  const details = [];
  const detailLimit = Math.max(0, Number(options.detailLimit ?? 200));
  for (const row of rows) {
    const code = normalized(row.sourceCode);
    const candidate = candidateByCode.get(code);
    const targetId = projectedByCode.get(code) || null;
    const current = database.prepare("SELECT salesObjectId FROM sales_link_sku_sales_object_relations WHERE linkSkuId=? AND status='active'").get(row.id)?.salesObjectId || null;
    let status = "unresolved";
    if (!code) status = "unresolved";
    else if (candidate?.identityStatus === "source_conflict") status = "source_conflict";
    else if (candidate?.identityStatus === "sku_type_conflict") status = "type_conflict";
    else if (targetId && current === targetId) status = "same";
    else if (targetId && !current) status = "v3_missing_current";
    else if (!targetId && current) status = "current_missing_v3";
    else if (targetId && current !== targetId) status = "relation_conflict";
    summary[status] += 1;
    if (status !== "same" && details.length < detailLimit) details.push({ linkSkuId: row.id, sourceCode: clean(row.sourceCode), status, currentSalesObjectId: current, projectedSalesObjectId: targetId });
  }
  return { batch, summary, detailCount: summary.total - summary.same, details };
}

export function projectOperatingSalesObjects(options = {}) {
  const database = options.database || getDatabase();
  const timestamp = options.timestamp || new Date().toISOString();
  const actor = options.actor || reviewer(database);
  const batch = options.batchId ? { id: options.batchId } : getLatestCompletePlatformBatch(database);
  if (!batch) throw new Error("latest_complete_platform_batch_missing");
  const rows = candidates(database);
  const candidateByCode = new Map(rows.map((item) => [normalized(item.normalizedCode), item]));
  const result = {
    candidateCount: rows.length, confirmedCount: 0, singleCount: 0, bundleCount: 0,
    objectsCreated: 0, objectsUpdated: 0, structuresCreated: 0, structuresUpdated: 0, structuresSuperseded: 0, componentsCreated: 0, relationsCreated: 0,
    relationsWouldCreate: 0, relationsProvenanceUpdated: 0, relationsUnchanged: 0, relationConflicts: 0, productMappingGovernance: 0,
    exceptions: [], projectedByCode: new Map(),
    engineering: { writeBatchSize: 0, batchCount: 0, longestTransactionMs: 0 },
  };
  const batchSize = Math.max(10, Number(options.writeBatchSize || process.env.V3_PROJECTION_WRITE_BATCH_SIZE || 100));
  result.engineering.writeBatchSize = batchSize;
  const writeBatches = (items, operation) => {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const batch = items.slice(offset, offset + batchSize);
      const started = performance.now();
      const changesBefore = Number(database.prepare("SELECT total_changes()").pluck().get());
      database.transaction(() => batch.forEach(operation)).deferred();
      if (Number(database.prepare("SELECT total_changes()").pluck().get()) > changesBefore) {
        result.engineering.batchCount += 1;
        result.engineering.longestTransactionMs = Math.max(result.engineering.longestTransactionMs, performance.now() - started);
      }
    }
  };
  const beforeDailyFacts = Number(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total);
  const confirmedRows = [];
  for (const candidate of rows) {
    const code = normalized(candidate.normalizedCode);
    if (candidate.identityStatus !== "confirmed") result.exceptions.push({ code, type: candidate.identityStatus });
    else confirmedRows.push(candidate);
  }
  writeBatches(confirmedRows, (candidate) => {
      const code = normalized(candidate.normalizedCode);
      result.confirmedCount += 1;
      if (candidate.productMappingStatus !== "complete") result.productMappingGovernance += 1;
      let projected;
      if (candidate.resolvedIdentityType === "single") {
        result.singleCount += 1;
        if (!candidate.goodsErpSkuId) projected = { status: "erp_not_found" };
        else projected = createSingleProjection(database, candidate, timestamp, actor);
      } else if (candidate.resolvedIdentityType === "bundle") {
        result.bundleCount += 1;
        projected = resolveBundleProjection(database, candidate, timestamp, actor, options.bundleSources?.[code] || null);
      } else projected = { status: "type_conflict" };
      if (!["same", "created"].includes(projected.status)) {
        result.exceptions.push({ code, type: projected.status, salesObjectId: projected.salesObjectId || null });
        return;
      }
      result.projectedByCode.set(code, projected.salesObjectId);
      result.objectsCreated += projected.createdObject ? 1 : 0;
      result.objectsUpdated += projected.objectUpdated ? 1 : 0;
      result.structuresCreated += projected.createdStructure ? 1 : 0;
      result.structuresUpdated += projected.structureUpdated ? 1 : 0;
      result.structuresSuperseded += projected.structureSuperseded ? 1 : 0;
      result.componentsCreated += Number(projected.componentCount || 0);
      if (options.failAfterCode && code === normalized(options.failAfterCode)) throw new Error("isolated_sales_object_projection_failure");
  });
  const linkSkus = database.prepare(`SELECT DISTINCT s.id,COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode,'') sourceCode
    FROM platform_goods_excel_import_rows r JOIN sales_link_skus s ON s.id=r.salesLinkSkuId
    WHERE r.batchId=? ORDER BY s.id`).all(batch.id);
  const insert = database.prepare(`INSERT INTO sales_link_sku_sales_object_relations
      (id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,createdAt,updatedAt)
      VALUES (?,?,?,?,'active',?,?,?,?,?,?,?)`);
  const processLinkSku = (linkSku) => {
      const code = normalized(linkSku.sourceCode);
      if (!code) return;
      const targetId = result.projectedByCode.get(code);
      if (!targetId) return;
      const current = database.prepare("SELECT * FROM sales_link_sku_sales_object_relations WHERE linkSkuId=? AND status='active'").get(linkSku.id);
      const candidate = candidateByCode.get(code);
      const structure = database.prepare("SELECT id,version,structureHash,sourceType,sourceUpdatedAt,lastVerifiedAt FROM sales_object_structures WHERE salesObjectId=? AND status='active'").get(targetId);
      let currentEvidence = {};
      try { currentEvidence = JSON.parse(current?.sourceReferenceJson || "{}"); } catch { currentEvidence = {}; }
      const evidence = JSON.stringify({
        projectionVersion: "v3", createdByProjection: current ? currentEvidence.createdByProjection === true : true,
        platformBatch: { id: batch.id, source: batch.source || null, fileName: batch.fileName || null, fileHash: batch.fileHash || null },
        platformErpOrSuiteCode: clean(linkSku.sourceCode),
        wangdianIdentity: { type: candidate?.resolvedIdentityType || null, status: candidate?.identityStatus || null, mode: candidate?.sourceMode || null, checkedAt: candidate?.sourceCheckedAt || null, updatedAt: candidate?.sourceUpdatedAt || null },
        salesObjectId: targetId,
        structure: structure ? { id: structure.id, version: Number(structure.version), hash: structure.structureHash, sourceType: structure.sourceType, sourceUpdatedAt: structure.sourceUpdatedAt || null } : null,
      });
      if (current?.salesObjectId === targetId) {
        if (options.relationWriteEnabled !== false && (current.sourceType !== V3_RELATION_SOURCE_TYPE || current.sourceBatchId !== batch.id || current.sourceReferenceJson !== evidence)) {
          database.prepare("UPDATE sales_link_sku_sales_object_relations SET sourceType=?,sourceBatchId=?,sourceReferenceJson=?,updatedAt=? WHERE id=?")
            .run(V3_RELATION_SOURCE_TYPE, batch.id, evidence, timestamp, current.id);
          result.relationsProvenanceUpdated += 1;
        } else result.relationsUnchanged += 1;
        return;
      }
      if (current) {
        result.relationConflicts += 1;
        result.exceptions.push({ code, linkSkuId: linkSku.id, type: "relation_conflict", currentSalesObjectId: current.salesObjectId, targetSalesObjectId: targetId });
        return;
      }
      if (options.relationWriteEnabled === false) { result.relationsWouldCreate += 1; return; }
      insert.run(stableId("sales-link-sku-sales-object-v3", linkSku.id, targetId), linkSku.id, targetId, timestamp, V3_RELATION_SOURCE_TYPE, batch.id, evidence, actor, timestamp, timestamp, timestamp);
      result.relationsCreated += 1;
  };
  if (options.relationWriteEnabled === false) linkSkus.forEach(processLinkSku);
  else writeBatches(linkSkus, processLinkSku);
  const afterDailyFacts = Number(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total);
  if (beforeDailyFacts !== afterDailyFacts) throw new Error("daily_facts_changed_by_projection");
  result.projectedByCode = Object.fromEntries(result.projectedByCode);
  return { ...result, batch };
}

export function classifySalesObjectLifecycle(options = {}) {
  const database = options.database || getDatabase();
  const operating = new Set(candidates(database).filter((item) => item.identityStatus === "confirmed").map((item) => normalized(item.normalizedCode)));
  const rows = database.prepare(`SELECT o.id,o.normalizedObjectCode,o.status,o.sourceType,
    EXISTS(SELECT 1 FROM sales_object_structures s WHERE s.salesObjectId=o.id AND s.sourceState='source_removed') sourceRemoved
    FROM sales_objects o`).all();
  const summary = { operating: 0, historical: 0, source_removed: 0, legacy_only: 0 };
  for (const row of rows) {
    if (operating.has(normalized(row.normalizedObjectCode))) summary.operating += 1;
    else if (row.status === "inactive" || row.sourceRemoved) summary.source_removed += 1;
    else if (!["wangdian_goods_api", "wangdian_suite_api"].includes(row.sourceType)) summary.legacy_only += 1;
    else summary.historical += 1;
  }
  return { total: rows.length, ...summary };
}
