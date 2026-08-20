import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const clean = (value) => String(value ?? "").trim();
const timestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const stableId = (...parts) => `bom-period-${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;

export function canonicalizeBomComponents(rows = []) {
  const aggregated = new Map();
  for (const row of rows) {
    const erpSkuId = clean(row.erpSkuId);
    const quantity = Number(row.quantity);
    if (!erpSkuId) throw new Error("bundle_component_not_found");
    if (!(quantity > 0)) throw new Error("invalid_bundle_component_quantity");
    aggregated.set(erpSkuId, (aggregated.get(erpSkuId) || 0) + quantity);
  }
  return [...aggregated].map(([erpSkuId, quantity]) => ({ erpSkuId, quantity }))
    .sort((left, right) => left.erpSkuId.localeCompare(right.erpSkuId));
}

export function calculateBomStructureHash(rows = []) {
  const signature = JSON.stringify(canonicalizeBomComponents(rows).map((row) => [row.erpSkuId, Number(row.quantity)]));
  return crypto.createHash("sha256").update(signature).digest("hex");
}

export function openBomEffectivePeriod({ structureId, salesObjectId, validFrom, validityBasis = "exact", sourceUpdatedAt = null, sourceReferenceJson = "{}" }, { database = getDatabase() } = {}) {
  const verifiedAt = timestamp(validFrom);
  if (!verifiedAt) throw new Error("invalid_bom_effective_time");
  const open = database.prepare(`SELECT * FROM sales_object_structure_effective_periods
    WHERE salesObjectId=? AND validTo IS NULL AND sourceState='active'`).get(salesObjectId);
  if (open?.structureId === structureId) {
    database.prepare(`UPDATE sales_object_structure_effective_periods
      SET lastVerifiedAt=?,syncedAt=?,sourceUpdatedAt=COALESCE(?,sourceUpdatedAt),sourceReferenceJson=?,updatedAt=? WHERE id=?`)
      .run(verifiedAt, verifiedAt, timestamp(sourceUpdatedAt), sourceReferenceJson, verifiedAt, open.id);
    return { periodId: open.id, outcome: "verified" };
  }
  if (open) database.prepare(`UPDATE sales_object_structure_effective_periods
    SET validTo=?,sourceState='source_removed',lastVerifiedAt=?,syncedAt=?,updatedAt=? WHERE id=?`)
    .run(verifiedAt, verifiedAt, verifiedAt, verifiedAt, open.id);
  const id = stableId(salesObjectId, structureId, verifiedAt);
  database.prepare(`INSERT INTO sales_object_structure_effective_periods
    (id,structureId,salesObjectId,validFrom,sourceState,validityBasis,sourceUpdatedAt,firstVerifiedAt,lastVerifiedAt,syncedAt,sourceReferenceJson,createdAt,updatedAt)
    VALUES (?,?,?,?,'active',?,?,?,?,?,?,?,?)`)
    .run(id, structureId, salesObjectId, verifiedAt, validityBasis, timestamp(sourceUpdatedAt), verifiedAt, verifiedAt, verifiedAt, sourceReferenceJson, verifiedAt, verifiedAt);
  return { periodId: id, outcome: open ? "changed" : "opened" };
}

export function closeBomEffectivePeriod(salesObjectId, removedAt, { database = getDatabase(), sourceReferenceJson = "{}" } = {}) {
  const closedAt = timestamp(removedAt);
  if (!closedAt) throw new Error("invalid_bom_effective_time");
  const result = database.prepare(`UPDATE sales_object_structure_effective_periods
    SET validTo=?,sourceState='source_removed',lastVerifiedAt=?,syncedAt=?,sourceReferenceJson=?,updatedAt=?
    WHERE salesObjectId=? AND validTo IS NULL AND sourceState='active'`)
    .run(closedAt, closedAt, closedAt, sourceReferenceJson, closedAt, salesObjectId);
  return { closed: result.changes };
}

export function resolveBundleBomVersion({ salesObjectId, saleDate }, { database = getDatabase() } = {}) {
  const at = timestamp(`${clean(saleDate).slice(0, 10)}T12:00:00.000Z`);
  if (!at) return { status: "unknown", reason: "invalid_sale_date", structure: null, components: [] };
  const period = database.prepare(`SELECT p.*,s.version,s.structureHash,s.sourceType
    FROM sales_object_structure_effective_periods p JOIN sales_object_structures s ON s.id=p.structureId
    WHERE p.salesObjectId=? AND p.validFrom<=? AND (p.validTo IS NULL OR p.validTo>?)
    ORDER BY p.validFrom DESC,p.id DESC LIMIT 1`).get(salesObjectId, at, at);
  if (!period) return { status: "unknown", reason: "historical_bom_unknown", structure: null, components: [] };
  const components = database.prepare(`SELECT erpSkuId,quantity FROM sales_object_structure_components
    WHERE structureId=? AND status='active' ORDER BY erpSkuId`).all(period.structureId);
  return { status: period.validityBasis, reason: null, structure: period, components };
}

export function compareBomComponents(left = [], right = []) {
  const a = canonicalizeBomComponents(left);
  const b = canonicalizeBomComponents(right);
  if (JSON.stringify(a) === JSON.stringify(b)) return { status: "same", componentDiff: [], quantityDiff: [] };
  const leftMap = new Map(a.map((row) => [row.erpSkuId, row.quantity]));
  const rightMap = new Map(b.map((row) => [row.erpSkuId, row.quantity]));
  const componentDiff = [...new Set([...leftMap.keys(), ...rightMap.keys()])].filter((id) => !leftMap.has(id) || !rightMap.has(id));
  const quantityDiff = [...leftMap.keys()].filter((id) => rightMap.has(id) && leftMap.get(id) !== rightMap.get(id));
  return { status: componentDiff.length ? "component_conflict" : "quantity_conflict", componentDiff, quantityDiff };
}

export function assertWangdianBomManualOverrideAllowed(structure, currentComponents = [], targetComponents = []) {
  if (!structure || structure.sourceType !== "wangdian_suite_api" || structure.sourceState === "source_removed") return true;
  if (compareBomComponents(currentComponents, targetComponents).status === "same") return true;
  const error = new Error("旺店通组合装BOM是权威结构，人工审批不能修改组件、数量或Bundle类型。请标记源数据问题并重新同步。");
  error.code = "wangdian_bom_manual_override_blocked";
  throw error;
}
