import crypto from "node:crypto";

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
  const active = database.prepare(`
    SELECT * FROM sales_link_sku_erp_mappings
    WHERE salesLinkSkuId=? AND currentState='active'
    ORDER BY createdAt,id
  `).all(text(salesLinkSkuId));
  const exact = active.find((row) => row.erpSkuId === text(erpSkuId)) ?? null;
  if (active.length === 1 && exact && exact.mappingType === "single" && Number(exact.quantity) === 1) {
    return { status: "active_exact", mapping: exact, active };
  }
  if (active.length) {
    return {
      status: "active_conflict",
      mapping: exact,
      active,
      reason: "链接SKU已存在其他或非single×1的active V2关系，必须进入人工治理。",
    };
  }
  const historical = database.prepare(`
    SELECT * FROM sales_link_sku_erp_mappings
    WHERE salesLinkSkuId=? AND erpSkuId=?
    ORDER BY updatedAt DESC,id DESC LIMIT 1
  `).get(text(salesLinkSkuId), text(erpSkuId));
  if (historical) {
    return {
      status: "inactive_conflict",
      mapping: historical,
      active,
      reason: "链接SKU与ERP SKU存在inactive历史关系，禁止自动恢复，必须进入人工治理。",
    };
  }
  return { status: "missing", mapping: null, active };
}

export function ensureSingleLinkSkuErpMapping(database, {
  salesLinkSkuId,
  erpSkuId,
  sourceType,
  sourceBatchId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const linkSkuId = text(salesLinkSkuId);
  const targetErpSkuId = text(erpSkuId);
  if (!linkSkuId || !targetErpSkuId || !text(sourceType)) throw new Error("V2关系写入缺少链接SKU、ERP SKU或来源。");
  const inspection = inspectSingleLinkSkuErpMapping(database, linkSkuId, targetErpSkuId);
  if (inspection.status === "active_exact") return { outcome: "idempotent", mapping: inspection.mapping };
  if (inspection.status !== "missing") return { outcome: "governance_pending", ...inspection };
  const mapping = {
    id: `sales-link-sku-erp-map-${crypto.randomUUID()}`,
    salesLinkSkuId: linkSkuId,
    erpSkuId: targetErpSkuId,
    sourceType: text(sourceType),
    sourceBatchId: text(sourceBatchId) || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  database.prepare(`INSERT INTO sales_link_sku_erp_mappings
    (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,sourceBatchId,createdAt,updatedAt)
    VALUES (@id,@salesLinkSkuId,@erpSkuId,'single',1,'active',@sourceType,@sourceBatchId,@createdAt,@updatedAt)`).run(mapping);
  return { outcome: "created", mapping: { ...mapping, mappingType: "single", quantity: 1, currentState: "active" } };
}

export function deactivateOwnedSingleLinkSkuErpMapping(database, {
  salesLinkSkuId,
  sourceType,
  sourceBatchId,
  reason = "V2人工关系已取消",
  timestamp = new Date().toISOString(),
} = {}) {
  const result = database.prepare(`UPDATE sales_link_sku_erp_mappings
    SET currentState='inactive',invalidatedAt=?,updatedAt=?
    WHERE salesLinkSkuId=? AND sourceType=? AND sourceBatchId=? AND currentState='active'`).run(
    timestamp,
    timestamp,
    text(salesLinkSkuId),
    text(sourceType),
    text(sourceBatchId),
  );
  return { changed: result.changes, reason };
}
