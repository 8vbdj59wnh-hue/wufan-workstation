import crypto from "node:crypto";
import { getDatabase } from "../db.js";

const CAPABILITY = "ResolveErpSkuBusinessUsage";
const CONTRACT_VERSION = "1.0";
const USAGE_TYPES = new Set(["product", "accounting_auxiliary", "shipping_adjustment", "other_adjustment"]);
const SUGGESTION_SOURCES = new Set(["system_suggestion", "system_migration", "erp_import"]);
const clean = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const makeId = () => `erp-sku-business-usage-${crypto.randomUUID()}`;

function baseResult(erpSkuId = null) {
  return {
    capability: CAPABILITY,
    contractVersion: CONTRACT_VERSION,
    erpSkuId,
    usageType: "unknown",
    isConfirmed: false,
    isUsable: false,
    source: null,
    reviewer: null,
    warnings: [],
    conflicts: [],
  };
}

function outputFromLookup(erpSkuId, resolved) {
  const result = baseResult(erpSkuId);
  if (!USAGE_TYPES.has(resolved?.usageType)) {
    result.warnings.push({ code: "ERP_USAGE_NOT_CLASSIFIED", message: "ERP SKU尚未确认业务用途。" });
    return result;
  }
  result.usageType = resolved.usageType;
  result.isConfirmed = resolved.isConfirmed !== false;
  result.isUsable = resolved.isUsable !== false && result.isConfirmed;
  result.source = resolved.source && typeof resolved.source === "object"
    ? resolved.source
    : { sourceType: resolved.source ?? null, usageRecordId: resolved.id ?? null };
  result.reviewer = {
    reviewedBy: resolved.reviewedBy ?? resolved.reviewer?.reviewedBy ?? null,
    reviewedAt: resolved.reviewedAt ?? resolved.reviewer?.reviewedAt ?? null,
  };
  return result;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function resolveLoadedUsage(erpSkuId, existingErpSkuIds, activeByErpSkuId) {
  if (!existingErpSkuIds.has(erpSkuId)) {
    const result = baseResult(erpSkuId);
    result.warnings.push({ code: "ERP_SKU_NOT_FOUND", message: "ERP SKU不存在。" });
    return result;
  }
  const active = activeByErpSkuId.get(erpSkuId) || [];
  if (!active.length) {
    const result = baseResult(erpSkuId);
    result.warnings.push({ code: "ERP_USAGE_NOT_CLASSIFIED", message: "ERP SKU尚未确认业务用途。" });
    return result;
  }
  if (active.length > 1) {
    const result = baseResult(erpSkuId);
    result.conflicts.push({
      code: "multiple_active_usages", severity: "blocking", message: "同一ERP SKU存在多个active业务用途。",
      usageRecordIds: active.map((row) => row.id),
    });
    return result;
  }
  const usage = active[0];
  const result = baseResult(erpSkuId);
  result.usageType = usage.usageType;
  result.isConfirmed = true;
  result.isUsable = true;
  result.source = { sourceType: usage.sourceType, usageRecordId: usage.id };
  result.reviewer = { reviewedBy: usage.reviewedBy, reviewedAt: usage.reviewedAt };
  return result;
}

export function resolveErpSkuBusinessUsages(input = {}, options = {}) {
  const requested = Array.isArray(input.erpSkuIds) ? input.erpSkuIds : [];
  const erpSkuIds = [...new Set(requested.map(clean).filter(Boolean))];
  const response = { capability: "ResolveErpSkuBusinessUsages", contractVersion: CONTRACT_VERSION, results: {} };
  if (!erpSkuIds.length) return response;
  const database = options.database || getDatabase();
  const queryAll = (sql, params) => {
    options.onQuery?.(sql, params);
    return database.prepare(sql).all(...params);
  };
  const idsSql = placeholders(erpSkuIds);
  const erpSkus = queryAll(`SELECT id FROM erp_skus WHERE id IN (${idsSql})`, erpSkuIds);
  const activeRows = queryAll(`SELECT id,erpSkuId,usageType,status,sourceType,reviewedBy,reviewedAt,decisionNote,supersedesUsageId,createdAt,updatedAt
    FROM erp_sku_business_usages WHERE erpSkuId IN (${idsSql}) AND status='active' ORDER BY erpSkuId,updatedAt DESC,id`, erpSkuIds);
  const activeByErpSkuId = new Map();
  for (const row of activeRows) {
    if (!activeByErpSkuId.has(row.erpSkuId)) activeByErpSkuId.set(row.erpSkuId, []);
    activeByErpSkuId.get(row.erpSkuId).push(row);
  }
  const existingErpSkuIds = new Set(erpSkus.map((row) => row.id));
  for (const erpSkuId of erpSkuIds) response.results[erpSkuId] = resolveLoadedUsage(erpSkuId, existingErpSkuIds, activeByErpSkuId);
  return response;
}

export function resolveErpSkuBusinessUsage(input = {}, options = {}) {
  const erpSkuId = clean(input.erpSkuId);
  if (!erpSkuId) {
    const result = baseResult(null);
    result.warnings.push({ code: "INVALID_INPUT", message: "erpSkuId不能为空。" });
    return result;
  }

  if (typeof options.lookup === "function") return outputFromLookup(erpSkuId, options.lookup(erpSkuId));
  const batch = resolveErpSkuBusinessUsages({ erpSkuIds: [erpSkuId] }, options);
  return batch.results[erpSkuId];
}

export function proposeErpSkuBusinessUsage(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const erpSkuId = clean(input.erpSkuId);
  const usageType = clean(input.usageType);
  const sourceType = clean(input.sourceType || "system_suggestion");
  const decisionNote = clean(input.decisionNote);
  if (!erpSkuId || !database.prepare("SELECT 1 FROM erp_skus WHERE id=?").get(erpSkuId)) throw new Error("ERP SKU不存在。");
  if (!USAGE_TYPES.has(usageType)) throw new Error("业务用途无效。");
  if (!SUGGESTION_SOURCES.has(sourceType)) throw new Error("建议来源无效。");
  if (!decisionNote) throw new Error("用途建议必须说明证据。");
  const existing = database.prepare(`SELECT * FROM erp_sku_business_usages
    WHERE erpSkuId=? AND usageType=? AND sourceType=? AND status='proposed'`).get(erpSkuId, usageType, sourceType);
  if (existing) return { usage: existing, idempotent: true };
  const timestamp = now();
  const usage = {
    id: makeId(), erpSkuId, usageType, status: "proposed", sourceType,
    reviewedBy: null, reviewedAt: null, decisionNote, supersedesUsageId: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
  database.prepare(`INSERT INTO erp_sku_business_usages
    (id,erpSkuId,usageType,status,sourceType,reviewedBy,reviewedAt,decisionNote,supersedesUsageId,createdAt,updatedAt)
    VALUES (@id,@erpSkuId,@usageType,@status,@sourceType,@reviewedBy,@reviewedAt,@decisionNote,@supersedesUsageId,@createdAt,@updatedAt)`).run(usage);
  return { usage, idempotent: false };
}

export function confirmErpSkuBusinessUsage(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const erpSkuId = clean(input.erpSkuId);
  const usageType = clean(input.usageType);
  const reviewedBy = clean(input.reviewedBy);
  const decisionNote = clean(input.decisionNote);
  if (!erpSkuId || !database.prepare("SELECT 1 FROM erp_skus WHERE id=?").get(erpSkuId)) throw new Error("ERP SKU不存在。");
  if (!USAGE_TYPES.has(usageType)) throw new Error("业务用途无效。");
  if (!reviewedBy || !database.prepare("SELECT 1 FROM persons WHERE id=?").get(reviewedBy)) throw new Error("审核人不存在。");
  if (!decisionNote) throw new Error("人工确认必须填写说明。");

  return database.transaction(() => {
    const active = database.prepare("SELECT * FROM erp_sku_business_usages WHERE erpSkuId=? AND status='active'").all(erpSkuId);
    if (active.length > 1) throw new Error("同一ERP SKU存在多个active用途，请先处理冲突。");
    if (active[0]?.usageType === usageType) {
      return { usage: active[0], idempotent: true, replacedUsageId: null };
    }

    const proposal = database.prepare(`SELECT * FROM erp_sku_business_usages
      WHERE erpSkuId=? AND usageType=? AND status='proposed' ORDER BY createdAt,id LIMIT 1`).get(erpSkuId, usageType);
    const timestamp = now();
    const supersedesUsageId = active[0]?.id || proposal?.id || null;
    if (active[0]) database.prepare("UPDATE erp_sku_business_usages SET status='superseded',updatedAt=? WHERE id=?").run(timestamp, active[0].id);
    if (proposal) database.prepare("UPDATE erp_sku_business_usages SET status='superseded',updatedAt=? WHERE id=?").run(timestamp, proposal.id);

    const usage = {
      id: makeId(), erpSkuId, usageType, status: "active", sourceType: "manual_confirmation",
      reviewedBy, reviewedAt: timestamp, decisionNote, supersedesUsageId,
      createdAt: timestamp, updatedAt: timestamp,
    };
    database.prepare(`INSERT INTO erp_sku_business_usages
      (id,erpSkuId,usageType,status,sourceType,reviewedBy,reviewedAt,decisionNote,supersedesUsageId,createdAt,updatedAt)
      VALUES (@id,@erpSkuId,@usageType,@status,@sourceType,@reviewedBy,@reviewedAt,@decisionNote,@supersedesUsageId,@createdAt,@updatedAt)`).run(usage);
    return { usage, idempotent: false, replacedUsageId: active[0]?.id || null };
  })();
}

export default resolveErpSkuBusinessUsage;
