import crypto from "node:crypto";

function clean(value) {
  return String(value ?? "").trim();
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function componentKey(component) {
  return `${component.erpSkuId}:${Number(component.quantity).toFixed(6)}`;
}

export function deriveProductStructureShape(components = []) {
  if (!components.length) return null;
  if (components.length > 1) return "multi_component";
  return Number(components[0].quantity) === 1 ? "single_unit" : "single_multi_quantity";
}

export function hashProductStructure(components = []) {
  const canonical = [...components]
    .sort((left, right) => componentKey(left).localeCompare(componentKey(right)))
    .map(componentKey)
    .join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function normalizeComponents(rows) {
  const byErpSku = new Map();
  const issues = [];
  for (const row of rows) {
    const erpSkuId = clean(row.erpSkuId);
    const componentQuantity = quantity(row.componentQuantity);
    if (!erpSkuId || componentQuantity === null) {
      issues.push({ code: !erpSkuId ? "erp_sku_unmatched" : "invalid_component_quantity", rowNumber: row.rowNumber ?? null });
      continue;
    }
    const previous = byErpSku.get(erpSkuId);
    if (previous && Number(previous.quantity) !== componentQuantity) {
      issues.push({ code: "master_data_quantity_conflict", erpSkuId, quantities: [previous.quantity, componentQuantity] });
      continue;
    }
    byErpSku.set(erpSkuId, {
      erpSkuId,
      quantity: componentQuantity,
      sourceType: row.relationSource === "组合装明细" ? "combo_master_excel" : "platform_goods_excel",
      sourceRowNumber: row.rowNumber ?? null,
    });
  }
  const components = [...byErpSku.values()].sort((left, right) => left.erpSkuId.localeCompare(right.erpSkuId));
  return { components, issues };
}

export function previewProductStructures({ relationshipRows = [], activeMappings = [] } = {}) {
  const rowsBySku = new Map();
  for (const row of relationshipRows) {
    const salesLinkSkuId = clean(row.salesLinkSkuId);
    if (!salesLinkSkuId) continue;
    if (!rowsBySku.has(salesLinkSkuId)) rowsBySku.set(salesLinkSkuId, []);
    rowsBySku.get(salesLinkSkuId).push(row);
  }
  const mappingsBySku = new Map();
  for (const mapping of activeMappings) {
    if (mapping.currentState && mapping.currentState !== "active") continue;
    if (!mappingsBySku.has(mapping.salesLinkSkuId)) mappingsBySku.set(mapping.salesLinkSkuId, []);
    mappingsBySku.get(mapping.salesLinkSkuId).push({ erpSkuId: mapping.erpSkuId, quantity: Number(mapping.quantity) });
  }

  const items = [];
  for (const [salesLinkSkuId, rows] of rowsBySku) {
    const explicitNoGoods = rows.every((row) => clean(row.status) === "无系统货品");
    const missingDefinition = rows.some((row) => clean(row.status) === "组合定义缺失");
    const normalized = normalizeComponents(rows);
    const current = (mappingsBySku.get(salesLinkSkuId) || []).sort((a, b) => componentKey(a).localeCompare(componentKey(b)));
    const proposedKeys = new Set(normalized.components.map(componentKey));
    const currentKeys = new Set(current.map(componentKey));
    let previewStatus;
    if (explicitNoGoods || missingDefinition || normalized.issues.length || !normalized.components.length) previewStatus = "incomplete";
    else if (proposedKeys.size === currentKeys.size && [...proposedKeys].every((key) => currentKeys.has(key))) previewStatus = "already_consistent";
    else if (!current.length) previewStatus = "new_structure";
    else if ([...currentKeys].every((key) => proposedKeys.has(key))) previewStatus = "structure_upgrade";
    else previewStatus = "conflict";
    items.push({
      salesLinkSkuId,
      salesLinkId: rows[0]?.salesLinkId ?? null,
      previewStatus,
      relationshipShape: deriveProductStructureShape(normalized.components),
      structureHash: normalized.components.length ? hashProductStructure(normalized.components) : null,
      components: normalized.components,
      currentMappings: current,
      issues: normalized.issues,
      sourceRows: rows.map((row) => row.rowNumber).filter(Boolean),
    });
  }

  const summary = items.reduce((result, item) => {
    result[item.previewStatus] = Number(result[item.previewStatus] || 0) + 1;
    result.componentRows += item.components.length;
    return result;
  }, { already_consistent: 0, new_structure: 0, structure_upgrade: 0, conflict: 0, incomplete: 0, unmatched: 0, componentRows: 0 });
  return { items, summary };
}
