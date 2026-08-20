import crypto from "node:crypto";
import { createProductStructureApplicationBatch } from "./productStructureApplicationApprovalService.js";

const text = (value) => String(value ?? "").trim();

export function resolveUniqueProductErpSku(database, productId) {
  const rows = database.prepare(`
    SELECT DISTINCT e.id erpSkuId,e.merchantSkuCode
    FROM product_erp_mappings m
    JOIN erp_skus e ON e.id=m.erpSkuId
    WHERE m.productId=? AND m.currentState='active' AND e.currentState='active'
    ORDER BY e.merchantSkuCode,e.id
  `).all(text(productId));
  if (rows.length === 1) return { status: "ready", erpSku: rows[0], candidates: rows };
  if (rows.length > 1) return { status: "multiple", erpSku: null, candidates: rows };
  return { status: "missing", erpSku: null, candidates: [] };
}

export function inspectSingleLinkSkuErpMapping(database, salesLinkSkuId, erpSkuId) {
  const active = database.prepare(`SELECT c.erpSkuId,c.quantity,
      CASE WHEN COUNT(*) OVER (PARTITION BY s.id)>1 THEN 'multi_component'
        WHEN c.quantity=1 THEN 'single_unit' ELSE 'single_multi_quantity' END mappingType,
      r.salesObjectId,s.id salesObjectStructureId,r.id salesObjectRelationId
    FROM sales_link_sku_sales_object_relations r
    JOIN sales_object_structures s ON s.salesObjectId=r.salesObjectId AND s.status='active'
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE r.linkSkuId=? AND r.status='active'
    ORDER BY c.sortOrder,c.erpSkuId,c.id`).all(text(salesLinkSkuId));
  const exact = active.find((row) => row.erpSkuId === text(erpSkuId)) ?? null;
  if (active.length === 1 && exact && Number(exact.quantity) === 1) {
    return { status: "active_exact", mapping: exact, active };
  }
  if (active.length) {
    return {
      status: "active_conflict",
      mapping: exact,
      active,
      reason: "链接SKU已存在其他或非single×1的active Sales Object结构，必须进入人工治理。",
    };
  }
  return { status: "missing", mapping: null, active };
}

export function ensureSingleLinkSkuErpMapping(database, {
  salesLinkSkuId,
  erpSkuId,
  sourceType,
  sourceBatchId = null,
  sourceEvidence = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const linkSkuId = text(salesLinkSkuId);
  const targetErpSkuId = text(erpSkuId);
  if (!linkSkuId || !targetErpSkuId || !text(sourceType)) throw new Error("V2关系写入缺少链接SKU、ERP SKU或来源。");
  const inspection = inspectSingleLinkSkuErpMapping(database, linkSkuId, targetErpSkuId);
  if (inspection.status === "active_exact") return { outcome: "idempotent", mapping: inspection.mapping, salesObjectRelation: inspection.mapping };
  const pendingApplication = database.prepare(`SELECT id,applicationBatchId,targetComponentsJson
    FROM product_structure_application_items
    WHERE salesLinkSkuId=? AND approvalStatus='pending'
    ORDER BY createdAt DESC`).all(linkSkuId).find((item) => {
    try {
      const components = JSON.parse(item.targetComponentsJson || "[]");
      return components.length === 1 && components[0]?.erpSkuId === targetErpSkuId && Number(components[0]?.quantity) === 1;
    } catch { return false; }
  });
  if (pendingApplication) {
    return {
      outcome: "governance_pending",
      status: "product_structure_review_pending",
      applicationBatchId: pendingApplication.applicationBatchId,
      applicationItemId: pendingApplication.id,
      idempotent: true,
      reason: "相同ERP关系候选已在Product Structure审批队列中，本次未重复创建。",
    };
  }
  const proposalCode = crypto.createHash("sha256")
    .update([text(sourceType), text(sourceBatchId) || "no-batch", linkSkuId, targetErpSkuId, "single", "1"].join("|"))
    .digest("hex");
  const application = createProductStructureApplicationBatch({
    batchCode: `relation-proposal-${proposalCode}`,
    sourceType: text(sourceType),
    previewItems: [{
      salesLinkSkuId: linkSkuId,
      previewStatus: inspection.active.length ? "structure_upgrade" : "new_structure",
      relationshipShape: "single",
      currentMappings: inspection.active,
      components: [{ erpSkuId: targetErpSkuId, quantity: 1, sourceType: text(sourceType) }],
      sourceRows: [{ sourceBatchId: text(sourceBatchId) || null, sourceEvidence, proposedAt: timestamp }],
    }],
  }, { database });
  if (application.itemCount === 0 && application.autoProjectedSkipped > 0) {
    return {
      outcome: "automatic_projection_pending",
      status: "v3_auto_projection_required",
      applicationBatchId: application.batchId,
      reason: "该关系可由平台货品与旺店通身份自动解释，未创建人工审批项；等待V3自动投影流程建立正式关系。",
    };
  }
  return {
    outcome: "governance_pending",
    status: "product_structure_review_pending",
    applicationBatchId: application.batchId,
    reason: inspection.reason || "ERP关系建议已进入Sales Object结构审批，审批应用前不会生成正式关系。",
  };
}

export function deactivateOwnedSingleLinkSkuErpMapping(database, {
  salesLinkSkuId,
  sourceType,
  sourceBatchId,
  reason = "V2人工关系已取消",
  timestamp = new Date().toISOString(),
} = {}) {
  void database; void timestamp;
  return {
    changed: 0,
    outcome: "governance_pending",
    salesLinkSkuId: text(salesLinkSkuId),
    sourceType: text(sourceType),
    sourceBatchId: text(sourceBatchId),
    reason: `${reason}；正式关系只能由Sales Object结构审批流程变更。`,
  };
}
