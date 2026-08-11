import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { deriveProductStructureShape, hashProductStructure } from "./productStructureMasterDataService.js";

const clean = (value) => String(value ?? "").trim();
const json = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const canonical = (rows = []) => [...rows]
  .map((row) => ({ erpSkuId: clean(row.erpSkuId), quantity: Number(row.quantity) }))
  .sort((left, right) => left.erpSkuId.localeCompare(right.erpSkuId));

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

export function createProductStructureApplicationBatch({ batchCode, sourceType, sourceFileHashes = {}, previewItems = [], createdBy = null } = {}, { database = getDatabase() } = {}) {
  const code = clean(batchCode);
  if (!code || !clean(sourceType)) throw new Error("应用批次缺少批次编码或来源类型。");
  const timestamp = new Date().toISOString();
  const batchId = `product-structure-application-${stableId(code)}`;
  const existing = database.prepare("SELECT id FROM product_structure_application_batches WHERE batchCode=?").get(code);
  if (existing) return { batchId: existing.id, idempotent: true, itemCount: database.prepare("SELECT COUNT(*) total FROM product_structure_application_items WHERE applicationBatchId=?").get(existing.id).total };
  database.transaction(() => {
    database.prepare(`INSERT INTO product_structure_application_batches
      (id,batchCode,sourceType,sourceFileHashesJson,status,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?, 'pending_review',?,?,?)`).run(batchId, code, clean(sourceType), JSON.stringify(sourceFileHashes), clean(createdBy) || null, timestamp, timestamp);
    const insertStructure = database.prepare(`INSERT INTO sales_link_sku_product_structures
      (id,salesLinkSkuId,structureCode,structureHash,status,sourceType,sourceFileHash,sourceReferenceJson,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?, 'pending_review',?,?,?,?,?,?)`);
    const insertComponent = database.prepare(`INSERT INTO sales_link_sku_product_structure_components
      (id,productStructureId,erpSkuId,quantity,sortOrder,sourceType,sourceReferenceJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const insertItem = database.prepare(`INSERT INTO product_structure_application_items
      (id,applicationBatchId,productStructureId,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of previewItems) {
      const classification = classifyStructureApplication(item.previewStatus);
      const components = canonical(item.components);
      const structureId = components.length ? `product-structure-${stableId(batchId, item.salesLinkSkuId, item.structureHash || hashProductStructure(components))}` : null;
      if (structureId) {
        const sources = [...new Set(item.components.map((component) => component.sourceType).filter(Boolean))];
        insertStructure.run(structureId, item.salesLinkSkuId, `PS-${stableId(item.salesLinkSkuId, item.structureHash).slice(0, 16)}`, item.structureHash || hashProductStructure(components), sources.length > 1 ? "master_data_integrated" : sources[0] || clean(sourceType), null, JSON.stringify({ applicationBatchId: batchId, sourceRows: item.sourceRows || [] }), clean(createdBy) || null, timestamp, timestamp);
        components.forEach((component, index) => insertComponent.run(`product-structure-component-${stableId(structureId, component.erpSkuId)}`, structureId, component.erpSkuId, component.quantity, index + 1, item.components.find((entry) => entry.erpSkuId === component.erpSkuId)?.sourceType || clean(sourceType), "{}", timestamp, timestamp));
      }
      const current = canonical(item.currentMappings);
      const diff = buildComponentDiff(current, components);
      insertItem.run(`product-structure-application-item-${stableId(batchId, item.salesLinkSkuId)}`, batchId, structureId, item.salesLinkSkuId, classification, defaultApprovalStatus(classification), item.relationshipShape || deriveProductStructureShape(components), JSON.stringify([...new Set(item.components.map((component) => component.sourceType).filter(Boolean))]), JSON.stringify(current), JSON.stringify(components), JSON.stringify(diff), Number(item.impactSalesAmount || 0), Number(item.impactProfitAmount || 0), timestamp, timestamp);
    }
  })();
  return { batchId, idempotent: false, itemCount: previewItems.length };
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
  return {
    itemId: item.id,
    salesLinkSkuId: item.salesLinkSkuId,
    classification: item.classification,
    approvalStatus: item.approvalStatus,
    oldMappings,
    newStructure: { productStructureId: item.productStructureId, relationshipShape: item.relationshipShape, components: targetComponents },
    generatedMappings: targetComponents.map((component) => ({ erpSkuId: component.erpSkuId, quantity: component.quantity, mappingType: targetComponents.length > 1 ? "combo" : "single", productStructureId: item.productStructureId })),
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
  if (!item || item.approvalStatus !== "approved" || !item.productStructureId) throw new Error("仅已批准且结构完整的应用项可以模拟执行。");
  const target = database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=? ORDER BY sortOrder,id").all(item.productStructureId);
  const frozenTarget = canonical(json(item.targetComponentsJson, []));
  if (JSON.stringify(canonical(target)) !== JSON.stringify(frozenTarget)) throw new Error("目标结构已变化，请重新生成审批预览。");
  const liveMappings = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active' ORDER BY erpSkuId,id").all(item.salesLinkSkuId);
  const allExistingMappings = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? ORDER BY erpSkuId,id").all(item.salesLinkSkuId);
  const frozenCurrent = canonical(json(item.currentMappingsJson, []));
  const timestamp = new Date().toISOString(); const auditId = `product-structure-application-audit-${crypto.randomUUID()}`;
  const existingByErpSku = new Map(allExistingMappings.map((mapping) => [mapping.erpSkuId, mapping]));
  const generated = target.map((component) => ({ id: existingByErpSku.get(component.erpSkuId)?.id || `sales-link-sku-erp-map-${crypto.randomUUID()}`, erpSkuId: component.erpSkuId, quantity: component.quantity, mappingType: target.length > 1 ? "combo" : "single" }));
  const liveMatchesTarget = JSON.stringify(canonical(liveMappings)) === JSON.stringify(frozenTarget)
    && liveMappings.every((mapping) => mapping.productStructureId === item.productStructureId)
    && database.prepare("SELECT status FROM sales_link_sku_product_structures WHERE id=?").get(item.productStructureId)?.status === "active";
  if (liveMatchesTarget) {
    database.prepare(`INSERT INTO product_structure_application_audits
      (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
      VALUES (?,?,?,?,'idempotent',?,?,?,?,?)`).run(auditId, item.id, item.productStructureId, executionMode, JSON.stringify(allExistingMappings), JSON.stringify(generated), actor, timestamp, timestamp);
    return { itemId: item.id, outcome: "idempotent", oldMappingCount: liveMappings.length, generatedMappingCount: 0, auditId };
  }
  if (JSON.stringify(canonical(liveMappings)) !== JSON.stringify(frozenCurrent)) throw new Error("当前mapping已变化，请重新生成审批预览。");
  try {
    database.transaction(() => {
      database.prepare("UPDATE sales_link_sku_erp_mappings SET currentState='inactive',invalidatedAt=?,updatedAt=? WHERE salesLinkSkuId=? AND currentState='active'").run(timestamp, timestamp, item.salesLinkSkuId);
      if (failAfterDeactivate) throw new Error("isolated_failure_after_deactivate");
      const insert = database.prepare(`INSERT INTO sales_link_sku_erp_mappings
        (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,productStructureId,createdAt,updatedAt)
        VALUES (?,?,?,?,?,'active','product_structure_application',?,?,?)`);
      const reactivate = database.prepare(`UPDATE sales_link_sku_erp_mappings
        SET mappingType=?,quantity=?,currentState='active',sourceType='product_structure_application',sourceBatchId=NULL,
          comboGroupId=NULL,productStructureId=?,invalidatedAt=NULL,updatedAt=? WHERE id=?`);
      for (const mapping of generated) {
        if (existingByErpSku.has(mapping.erpSkuId)) reactivate.run(mapping.mappingType, mapping.quantity, item.productStructureId, timestamp, mapping.id);
        else insert.run(mapping.id, item.salesLinkSkuId, mapping.erpSkuId, mapping.mappingType, mapping.quantity, item.productStructureId, timestamp, timestamp);
      }
      database.prepare("UPDATE sales_link_sku_product_structures SET status='active',reviewedBy=?,reviewedAt=COALESCE(reviewedAt,?),activatedAt=?,updatedAt=? WHERE id=? AND status='pending_review'").run(actor, timestamp, timestamp, timestamp, item.productStructureId);
      database.prepare(`INSERT INTO product_structure_application_audits
        (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
        VALUES (?,?,?,?,'applied',?,?,?,?,?)`).run(auditId, item.id, item.productStructureId, executionMode, JSON.stringify(allExistingMappings), JSON.stringify(generated), actor, timestamp, timestamp);
    })();
    return { itemId: item.id, outcome: "applied", oldMappingCount: liveMappings.length, generatedMappingCount: generated.length, auditId };
  } catch (error) {
    database.prepare(`INSERT INTO product_structure_application_audits
      (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,errorMessage,appliedBy,appliedAt,createdAt)
      VALUES (?,?,?,?,'rolled_back',?,?,?,?,?,?)`).run(auditId, item.id, item.productStructureId, executionMode, JSON.stringify(allExistingMappings), JSON.stringify(generated), String(error.message), actor, timestamp, timestamp);
    return { itemId: item.id, outcome: "rolled_back", error: String(error.message), auditId };
  }
}

export function simulateApprovedProductStructureApplication(itemId, options = {}, context = {}) {
  return executeApprovedProductStructureApplication(itemId, { ...options, executionMode: "isolated_simulation" }, context);
}

export function applyApprovedProductStructureApplication(itemId, options = {}, context = {}) {
  return executeApprovedProductStructureApplication(itemId, { ...options, executionMode: "production" }, context);
}
