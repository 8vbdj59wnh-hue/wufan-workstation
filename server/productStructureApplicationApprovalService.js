import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { deriveProductStructureShape, hashProductStructure } from "./productStructureMasterDataService.js";
import { assertWangdianBomManualOverrideAllowed } from "./wangdianBomAuthorityService.js";

const clean = (value) => String(value ?? "").trim();
const json = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const canonical = (rows = []) => [...rows]
  .map((row) => ({ erpSkuId: clean(row.erpSkuId), quantity: Number(row.quantity) }))
  .sort((left, right) => left.erpSkuId.localeCompare(right.erpSkuId));

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function isV3AutoProjectableTarget(database, salesLinkSkuId, targetComponents) {
  if (!tableExists(database, "operating_erp_identity_observations") || !tableExists(database, "operating_erp_identity_shadow_comparisons")) return false;
  const identity = database.prepare(`SELECT o.resolvedIdentityType,o.identityStatus,o.goodsErpSkuId,o.suiteSalesObjectId,c.bundleStructureStatus
    FROM sales_link_skus sku JOIN operating_erp_identity_observations o
      ON o.normalizedCode=lower(trim(COALESCE(NULLIF(sku.normalizedPlatformSkuCode,''),sku.platformSkuCode,'')))
    JOIN operating_erp_identity_shadow_comparisons c USING(normalizedCode)
    WHERE sku.id=? AND o.inOperatingObjectSet=1`).get(salesLinkSkuId);
  if (!identity || identity.identityStatus !== "confirmed") return false;
  const target = canonical(targetComponents);
  if (identity.resolvedIdentityType === "single") return target.length === 1 && target[0].erpSkuId === identity.goodsErpSkuId && Number(target[0].quantity) === 1;
  if (identity.resolvedIdentityType !== "bundle" || identity.bundleStructureStatus !== "complete" || !identity.suiteSalesObjectId) return false;
  const authoritative = canonical(database.prepare(`SELECT c.erpSkuId,c.quantity FROM sales_object_structures s
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE s.salesObjectId=? AND s.status='active' ORDER BY c.erpSkuId`).all(identity.suiteSalesObjectId));
  return JSON.stringify(authoritative) === JSON.stringify(target);
}

export function classifyStructureApplication(previewStatus) {
  return previewStatus === "new_structure" ? "ready_to_apply" : previewStatus;
}

export function buildComponentDiff(currentMappings = [], targetComponents = []) {
  const current = new Map(canonical(currentMappings).map((item) => [item.erpSkuId, item.quantity]));
  const target = new Map(canonical(targetComponents).map((item) => [item.erpSkuId, item.quantity]));
  const added = []; const removed = []; const quantityChanged = [];
  for (const [erpSkuId, quantity] of target) {
    if (!current.has(erpSkuId)) added.push({ erpSkuId, quantity });
    else if (Number(current.get(erpSkuId)) !== Number(quantity)) quantityChanged.push({ erpSkuId, from: current.get(erpSkuId), to: quantity });
  }
  for (const [erpSkuId, quantity] of current) if (!target.has(erpSkuId)) removed.push({ erpSkuId, quantity });
  return { added, removed, quantityChanged, unchangedCount: [...target].filter(([id, qty]) => current.get(id) === qty).length };
}

function defaultApprovalStatus(classification) {
  if (classification === "already_consistent") return "not_required";
  if (["conflict", "incomplete"].includes(classification)) return "blocked";
  return "pending";
}

function readActiveSalesObjectState(database, salesLinkSkuId) {
  const relation = database.prepare(`SELECT r.*,o.objectType,o.status salesObjectStatus
    FROM sales_link_sku_sales_object_relations r
    JOIN sales_objects o ON o.id=r.salesObjectId
    WHERE r.linkSkuId=? AND r.status='active'
    ORDER BY r.createdAt DESC,r.id DESC LIMIT 1`).get(salesLinkSkuId);
  if (!relation) return { relation: null, structure: null, components: [] };
  const structure = database.prepare(`SELECT * FROM sales_object_structures
    WHERE salesObjectId=? AND status='active' ORDER BY version DESC,id DESC LIMIT 1`).get(relation.salesObjectId);
  const components = structure
    ? database.prepare(`SELECT erpSkuId,quantity FROM sales_object_structure_components
      WHERE structureId=? AND status='active' ORDER BY erpSkuId,id`).all(structure.id)
    : [];
  return { relation, structure, components: canonical(components) };
}

function applySalesObjectStructure(database, { salesLinkSkuId, target, sourceBatchId, applicationItemId, actor, timestamp, failAfterSupersede = false }) {
  const current = readActiveSalesObjectState(database, salesLinkSkuId);
  let currentRelation = current.relation;
  const linkSku = database.prepare("SELECT platformSkuCode,platformSkuId FROM sales_link_skus WHERE id=?").get(salesLinkSkuId);
  if (!linkSku) throw new Error("链接SKU不存在，不能应用Sales Object关系。");
  if (JSON.stringify(current.components) === JSON.stringify(canonical(target)) && current.structure) {
    return { salesObjectId: currentRelation.salesObjectId, structureId: current.structure.id, structureVersion: Number(current.structure.version), outcome: "idempotent" };
  }
  assertWangdianBomManualOverrideAllowed(current.structure, current.components, target);
  let salesObjectId = currentRelation?.salesObjectId || `sales-object-${stableId("product-structure", salesLinkSkuId)}`;
  let activeStructure = current.structure;
  if (currentRelation && activeStructure) {
    const activeRelationCount = Number(database.prepare(`SELECT COUNT(*) total FROM sales_link_sku_sales_object_relations
      WHERE salesObjectId=? AND status='active'`).get(currentRelation.salesObjectId).total);
    if (activeRelationCount > 1) {
      database.prepare("UPDATE sales_link_sku_sales_object_relations SET status='superseded',effectiveTo=?,updatedAt=? WHERE id=?")
        .run(timestamp, timestamp, currentRelation.id);
      currentRelation = null;
      activeStructure = null;
      salesObjectId = `sales-object-${stableId("product-structure", salesLinkSkuId)}`;
    }
  }
  const objectType = target.length === 1 && Number(target[0].quantity) === 1 ? "single" : "bundle";
  const objectCode = clean(linkSku?.platformSkuCode) || clean(linkSku?.platformSkuId) || salesLinkSkuId;
  const sourceReferenceJson = JSON.stringify({
    applicationItemId: clean(applicationItemId) || null,
    applicationBatchId: clean(sourceBatchId) || null,
    previousSalesObjectStructureId: activeStructure?.id || null,
    relationModel: "sales_object",
  });
  if (!currentRelation) {
    database.prepare(`INSERT OR IGNORE INTO sales_objects
      (id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,sourceBatchId,status,firstSeenAt,lastSeenAt,createdAt,updatedAt)
      VALUES (?,?,?,?, 'product_structure','product_structure_application',?,?, 'active',?,?,?,?)`)
      .run(salesObjectId, objectCode, `product-structure:${salesLinkSkuId}`.toLowerCase(), objectType, salesLinkSkuId, sourceBatchId || null, timestamp, timestamp, timestamp, timestamp);
    database.prepare(`INSERT INTO sales_link_sku_sales_object_relations
      (id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,createdAt,updatedAt)
      VALUES (?,?,?,?,'active','product_structure_application',?,?,?,?,?,?)`)
      .run(`sales-object-relation-${crypto.randomUUID()}`, salesLinkSkuId, salesObjectId, timestamp, sourceBatchId || null, sourceReferenceJson, actor, timestamp, timestamp, timestamp);
  }
  database.prepare("UPDATE sales_objects SET objectType=?,status='active',lastSeenAt=?,updatedAt=? WHERE id=?")
    .run(objectType, timestamp, timestamp, salesObjectId);
  if (activeStructure) {
    database.prepare("UPDATE sales_object_structures SET status='superseded',effectiveTo=?,updatedAt=? WHERE id=?")
      .run(timestamp, timestamp, activeStructure.id);
  }
  if (failAfterSupersede) throw new Error("isolated_failure_after_sales_object_supersede");
  const version = Number(database.prepare("SELECT COALESCE(MAX(version),0)+1 version FROM sales_object_structures WHERE salesObjectId=?").get(salesObjectId).version);
  const signature = hashProductStructure(target);
  const structureId = `sales-object-structure-${stableId(salesObjectId, signature, String(version))}`;
  database.prepare(`INSERT INTO sales_object_structures
    (id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,supersedesStructureId,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'draft','product_structure_application',?,?,?,?,?)`)
    .run(structureId, salesObjectId, version, signature, timestamp, sourceBatchId || null, sourceReferenceJson, activeStructure?.id || null, timestamp, timestamp);
  const insertComponent = database.prepare(`INSERT INTO sales_object_structure_components
    (id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,'active','product_structure_application',?,?,?)`);
  canonical(target).forEach((component, index) => insertComponent.run(
    `sales-object-component-${stableId(structureId, component.erpSkuId)}`,
    structureId, salesObjectId, component.erpSkuId, component.quantity, index + 1, sourceReferenceJson, timestamp, timestamp,
  ));
  database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=?")
    .run(actor, timestamp, timestamp, timestamp, structureId);
  return { salesObjectId, structureId, structureVersion: version, outcome: "applied" };
}

export function createProductStructureApplicationBatch({ batchCode, sourceType, sourceFileHashes = {}, previewItems = [], createdBy = null } = {}, { database = getDatabase() } = {}) {
  const code = clean(batchCode);
  if (!code || !clean(sourceType)) throw new Error("应用批次缺少批次编码或来源类型。");
  const timestamp = new Date().toISOString();
  const batchId = `product-structure-application-${stableId(code)}`;
  const existing = database.prepare("SELECT id FROM product_structure_application_batches WHERE batchCode=?").get(code);
  if (existing) return { batchId: existing.id, idempotent: true, itemCount: database.prepare("SELECT COUNT(*) total FROM product_structure_application_items WHERE applicationBatchId=?").get(existing.id).total };
  let itemCount = 0;
  let autoProjectedSkipped = 0;
  database.transaction(() => {
    database.prepare(`INSERT INTO product_structure_application_batches
      (id,batchCode,sourceType,sourceFileHashesJson,status,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?, 'pending_review',?,?,?)`).run(batchId, code, clean(sourceType), JSON.stringify(sourceFileHashes), clean(createdBy) || null, timestamp, timestamp);
    const insertItem = database.prepare(`INSERT INTO product_structure_application_items
      (id,applicationBatchId,productStructureId,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of previewItems) {
      const classification = classifyStructureApplication(item.previewStatus);
      const components = canonical(item.components);
      if (isV3AutoProjectableTarget(database, item.salesLinkSkuId, components)) {
        autoProjectedSkipped += 1;
        continue;
      }
      const current = canonical(item.currentMappings);
      const diff = buildComponentDiff(current, components);
      insertItem.run(`product-structure-application-item-${stableId(batchId, item.salesLinkSkuId)}`, batchId, null, item.salesLinkSkuId, classification, defaultApprovalStatus(classification), item.relationshipShape || deriveProductStructureShape(components), JSON.stringify([...new Set(item.components.map((component) => component.sourceType).filter(Boolean))]), JSON.stringify(current), JSON.stringify(components), JSON.stringify(diff), Number(item.impactSalesAmount || 0), Number(item.impactProfitAmount || 0), timestamp, timestamp);
      itemCount += 1;
    }
    if (itemCount === 0) database.prepare("UPDATE product_structure_application_batches SET status='closed',updatedAt=? WHERE id=?").run(timestamp, batchId);
  })();
  return { batchId, idempotent: false, itemCount, autoProjectedSkipped };
}

export function queryProductStructureApplicationQueue(applicationBatchId, options = {}, { database = getDatabase() } = {}) {
  const where = ["i.applicationBatchId=?"]; const params = [clean(applicationBatchId)];
  if (clean(options.classification)) { where.push("i.classification=?"); params.push(clean(options.classification)); }
  if (clean(options.approvalStatus)) { where.push("i.approvalStatus=?"); params.push(clean(options.approvalStatus)); }
  const rows = database.prepare(`SELECT i.*,sku.platformSkuId,sku.specificationName,l.title linkName,l.platformGoodsId,
    sh.shopName,sh.displayName shopDisplayName,sh.platform
    FROM product_structure_application_items i
    JOIN sales_link_skus sku ON sku.id=i.salesLinkSkuId JOIN sales_links l ON l.id=sku.salesLinkId
    JOIN sales_shops sh ON sh.id=l.shopId WHERE ${where.join(" AND ")}
    ORDER BY i.impactSalesAmount DESC,i.salesLinkSkuId`).all(...params);
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 30)));
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
    ...row,
    sourceTypes: json(row.sourceTypesJson, []),
    currentMappings: json(row.currentMappingsJson, []),
    targetComponents: json(row.targetComponentsJson, []),
    componentDiff: json(row.componentDiffJson, {}),
  }));
  return { items, pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) } };
}

export function listProductStructureApplicationBatches({ database = getDatabase() } = {}) {
  return database.prepare(`SELECT b.*,
    COUNT(i.id) itemCount,
    SUM(CASE WHEN i.approvalStatus='pending' THEN 1 ELSE 0 END) pendingCount,
    SUM(CASE WHEN i.approvalStatus='approved' THEN 1 ELSE 0 END) approvedCount,
    SUM(COALESCE(i.impactSalesAmount,0)) impactSalesAmount
    FROM product_structure_application_batches b
    LEFT JOIN product_structure_application_items i ON i.applicationBatchId=b.id
    GROUP BY b.id ORDER BY b.createdAt DESC,b.id`).all();
}

export function readProductStructureApplicationPreview(itemId, { database = getDatabase() } = {}) {
  const item = database.prepare("SELECT * FROM product_structure_application_items WHERE id=?").get(clean(itemId));
  if (!item) throw new Error("货品结构应用项不存在。");
  const oldMappings = json(item.currentMappingsJson, []); const targetComponents = json(item.targetComponentsJson, []);
  const current = readActiveSalesObjectState(database, item.salesLinkSkuId);
  return {
    itemId: item.id,
    salesLinkSkuId: item.salesLinkSkuId,
    classification: item.classification,
    approvalStatus: item.approvalStatus,
    oldMappings,
    currentStructure: current.structure ? { salesObjectId: current.relation.salesObjectId, salesObjectStructureId: current.structure.id, version: Number(current.structure.version) } : null,
    newStructure: { salesObjectStructureId: null, nextVersion: Number(current.structure?.version || 0) + 1, relationshipShape: item.relationshipShape, components: targetComponents },
    generatedMappings: [],
    generatedSalesObjectComponents: targetComponents,
    componentDiff: json(item.componentDiffJson, {}),
  };
}

export function reviewProductStructureApplicationItem(itemId, { decision, reviewedBy, reviewNote } = {}, { database = getDatabase() } = {}) {
  const reviewer = clean(reviewedBy); const note = clean(reviewNote); const normalizedDecision = clean(decision);
  if (!reviewer || !note) throw new Error("审批人和审批说明不能为空。");
  if (!['approved', 'rejected'].includes(normalizedDecision)) throw new Error("审批决定无效。");
  const item = database.prepare("SELECT * FROM product_structure_application_items WHERE id=?").get(clean(itemId));
  if (!item) throw new Error("货品结构应用项不存在。");
  if (!['ready_to_apply', 'structure_upgrade'].includes(item.classification)) throw new Error("当前分类不允许审批应用。");
  if (item.approvalStatus === normalizedDecision) return { itemId: item.id, approvalStatus: normalizedDecision, idempotent: true };
  if (item.approvalStatus !== "pending") throw new Error("当前审批状态已变化。");
  const timestamp = new Date().toISOString();
  database.prepare("UPDATE product_structure_application_items SET approvalStatus=?,reviewedBy=?,reviewedAt=?,reviewNote=?,updatedAt=? WHERE id=? AND approvalStatus='pending'")
    .run(normalizedDecision, reviewer, timestamp, note, timestamp, item.id);
  const counts = database.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN approvalStatus='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN approvalStatus IN ('approved','rejected') THEN 1 ELSE 0 END) reviewed
    FROM product_structure_application_items WHERE applicationBatchId=?`).get(item.applicationBatchId);
  const batchStatus = Number(counts.pending || 0) === 0 ? "reviewed" : Number(counts.reviewed || 0) > 0 ? "partially_reviewed" : "pending_review";
  database.prepare("UPDATE product_structure_application_batches SET status=?,updatedAt=? WHERE id=?").run(batchStatus, timestamp, item.applicationBatchId);
  return { itemId: item.id, approvalStatus: normalizedDecision, idempotent: false };
}

function executeApprovedProductStructureApplication(itemId, { appliedBy, failAfterDeactivate = false, executionMode } = {}, { database = getDatabase() } = {}) {
  if (!["isolated_simulation", "production"].includes(executionMode)) throw new Error("货品结构应用执行模式无效。");
  const actor = clean(appliedBy); if (!actor) throw new Error("无法识别模拟执行人。");
  const item = database.prepare("SELECT * FROM product_structure_application_items WHERE id=?").get(clean(itemId));
  if (!item || item.approvalStatus !== "approved") throw new Error("仅已批准且结构完整的应用项可以执行。");
  const frozenTarget = canonical(json(item.targetComponentsJson, []));
  if (!frozenTarget.length || frozenTarget.some((component) => !component.erpSkuId || !(component.quantity > 0))) throw new Error("目标Sales Object结构不完整。");
  const targetErpSkuIds = [...new Set(frozenTarget.map((component) => component.erpSkuId))];
  const marks = targetErpSkuIds.map(() => "?").join(",");
  const activeErpSkuCount = Number(database.prepare(`SELECT COUNT(*) total FROM erp_skus WHERE id IN (${marks}) AND currentState='active'`).get(...targetErpSkuIds).total);
  if (activeErpSkuCount !== targetErpSkuIds.length) throw new Error("目标Sales Object结构包含不存在或非active的ERP SKU。");
  const target = frozenTarget;
  const frozenCurrent = canonical(json(item.currentMappingsJson, []));
  const timestamp = new Date().toISOString(); const auditId = `product-structure-application-audit-${crypto.randomUUID()}`;
  const liveSalesObject = readActiveSalesObjectState(database, item.salesLinkSkuId);
  const currentSnapshot = {
    source: "sales_object",
    salesObjectId: liveSalesObject.relation?.salesObjectId || null,
    salesObjectStructureId: liveSalesObject.structure?.id || null,
    salesObjectStructureVersion: Number(liveSalesObject.structure?.version || 0) || null,
    components: liveSalesObject.components,
  };
  const generated = target.map((component) => ({ erpSkuId: component.erpSkuId, quantity: component.quantity, sourceType: "product_structure_application" }));
  if (JSON.stringify(liveSalesObject.components) === JSON.stringify(frozenTarget) && liveSalesObject.structure) {
    database.prepare(`UPDATE product_structure_application_items SET salesObjectStructureId=?,structureVersion=?,updatedAt=? WHERE id=?`)
      .run(liveSalesObject.structure.id, Number(liveSalesObject.structure.version), timestamp, item.id);
    database.prepare(`INSERT INTO product_structure_application_audits
      (id,applicationItemId,productStructureId,salesObjectStructureId,structureVersion,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
      VALUES (?,?,?,?,?,?,'idempotent',?,?,?,?,?)`).run(auditId, item.id, item.productStructureId || null, liveSalesObject.structure.id, Number(liveSalesObject.structure.version), executionMode, JSON.stringify(currentSnapshot), JSON.stringify({ ...currentSnapshot, components: generated }), actor, timestamp, timestamp);
    return { itemId: item.id, outcome: "idempotent", oldMappingCount: liveSalesObject.components.length, oldComponentCount: liveSalesObject.components.length, generatedMappingCount: 0, generatedComponentCount: 0, salesObjectId: liveSalesObject.relation.salesObjectId, salesObjectStructureId: liveSalesObject.structure.id, salesObjectStructureVersion: Number(liveSalesObject.structure.version), auditId };
  }
  if (JSON.stringify(liveSalesObject.components) !== JSON.stringify(frozenCurrent)) throw new Error("当前Sales Object结构已变化，请重新生成审批预览。");
  let appliedSalesObject = null;
  try {
    database.transaction(() => {
      appliedSalesObject = applySalesObjectStructure(database, {
        salesLinkSkuId: item.salesLinkSkuId,
        target,
        sourceBatchId: item.applicationBatchId,
        applicationItemId: item.id,
        actor,
        timestamp,
        failAfterSupersede: failAfterDeactivate,
      });
      database.prepare("UPDATE product_structure_application_items SET salesObjectStructureId=?,structureVersion=?,updatedAt=? WHERE id=?")
        .run(appliedSalesObject.structureId, appliedSalesObject.structureVersion, timestamp, item.id);
      database.prepare(`INSERT INTO product_structure_application_audits
        (id,applicationItemId,productStructureId,salesObjectStructureId,structureVersion,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
        VALUES (?,?,?,?,?,?,'applied',?,?,?,?,?)`).run(auditId, item.id, item.productStructureId || null, appliedSalesObject.structureId, appliedSalesObject.structureVersion, executionMode, JSON.stringify(currentSnapshot), JSON.stringify({ source: "sales_object", salesObjectId: appliedSalesObject.salesObjectId, salesObjectStructureId: appliedSalesObject.structureId, salesObjectStructureVersion: appliedSalesObject.structureVersion, components: generated }), actor, timestamp, timestamp);
    })();
    return { itemId: item.id, outcome: "applied", oldMappingCount: liveSalesObject.components.length, oldComponentCount: liveSalesObject.components.length, generatedMappingCount: 0, generatedComponentCount: target.length, salesObjectId: appliedSalesObject.salesObjectId, salesObjectStructureId: appliedSalesObject.structureId, salesObjectStructureVersion: appliedSalesObject.structureVersion, auditId };
  } catch (error) {
    database.prepare(`INSERT INTO product_structure_application_audits
      (id,applicationItemId,productStructureId,salesObjectStructureId,structureVersion,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,errorMessage,appliedBy,appliedAt,createdAt)
      VALUES (?,?,?,?,?,?,'rolled_back',?,?,?,?,?,?)`).run(auditId, item.id, item.productStructureId || null, currentSnapshot.salesObjectStructureId, currentSnapshot.salesObjectStructureVersion, executionMode, JSON.stringify(currentSnapshot), JSON.stringify({ source: "sales_object", components: generated }), String(error.message), actor, timestamp, timestamp);
    return { itemId: item.id, outcome: "rolled_back", error: String(error.message), auditId };
  }
}

export function simulateApprovedProductStructureApplication(itemId, options = {}, context = {}) {
  return executeApprovedProductStructureApplication(itemId, { ...options, executionMode: "isolated_simulation" }, context);
}

export function applyApprovedProductStructureApplication(itemId, options = {}, context = {}) {
  return executeApprovedProductStructureApplication(itemId, { ...options, executionMode: "production" }, context);
}
