import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { readErpSkuInventorySupplyMap } from "./inventorySupplyQueryService.js";
import { queryErpSkuContributions } from "./productContributionReadModel.js";
import { latestCompleteSalesDate, resolveProductSalesDistributionRange } from "./productSalesDistributionService.js";
import { productBusinessIdentityParams, productBusinessIdentityPredicate, resolveProductBusinessIdentity, upsertProductBusinessProfile } from "./productBusinessProfileService.js";

export const productClearancePlanStatuses = Object.freeze(["active", "completed", "cancelled"]);

const text = (value) => String(value ?? "").trim();
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : "";
const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (value, days) => {
  const date = new Date(`${value}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};
const differenceDays = (start, end) => Math.floor((Date.parse(`${end}T00:00:00+08:00`) - Date.parse(`${start}T00:00:00+08:00`)) / 86400000);
const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

function normalizePlanInput(input = {}, fallback = {}) {
  const startDate = isoDate(input.startDate) || fallback.startDate || today();
  const targetDays = Number(input.targetDays ?? fallback.targetDays ?? 30);
  const targetInventoryQuantity = Number(input.targetInventoryQuantity ?? fallback.targetInventoryQuantity ?? 0);
  if (!Number.isInteger(targetDays) || targetDays < 1 || targetDays > 3650) throw new Error("清仓天数必须是1至3650天的整数。");
  if (!Number.isFinite(targetInventoryQuantity) || targetInventoryQuantity < 0) throw new Error("目标库存不能小于0。");
  return { startDate, targetDays, targetEndDate: addDays(startDate, targetDays - 1), targetInventoryQuantity, note: text(input.note ?? fallback.note) || null };
}

function currentInventoryQuantity(erpSkuId, database) {
  const summary = readErpSkuInventorySupplyMap([erpSkuId], { includeCost: false, database }).get(erpSkuId)?.summary;
  return summary?.stockNum === null || summary?.stockNum === undefined ? null : Number(summary.stockNum);
}

export function saveProductClearancePlan(productId, input = {}, userId = "") {
  const database = getDatabase();
  const product = resolveProductBusinessIdentity(productId, { database });
  upsertProductBusinessProfile(product.erpSkuId, {}, userId, { database });
  const existing = database.prepare(`SELECT * FROM product_clearance_plans record WHERE ${productBusinessIdentityPredicate("record")} AND status='active' ORDER BY updatedAt DESC LIMIT 1`).get(productBusinessIdentityParams(product));
  const normalized = normalizePlanInput(input, existing || {});
  const timestamp = now();
  if (existing) {
    database.prepare(`UPDATE product_clearance_plans SET startDate=?,targetDays=?,targetEndDate=?,targetInventoryQuantity=?,note=?,updatedAt=? WHERE id=?`)
      .run(normalized.startDate, normalized.targetDays, normalized.targetEndDate, normalized.targetInventoryQuantity, normalized.note, timestamp, existing.id);
    return database.prepare("SELECT * FROM product_clearance_plans WHERE id=?").get(existing.id);
  }
  const id = `product-clearance-plan-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO product_clearance_plans
    (id,productId,erpSkuId,status,startDate,targetDays,targetEndDate,initialInventoryQuantity,targetInventoryQuantity,note,createdBy,completedAt,createdAt,updatedAt)
    VALUES (?,?,?,'active',?,?,?,?,?,?,?,NULL,?,?)`)
    .run(id, product.legacyProductId, product.erpSkuId, normalized.startDate, normalized.targetDays, normalized.targetEndDate, currentInventoryQuantity(product.erpSkuId, database), normalized.targetInventoryQuantity, normalized.note, text(userId) || null, timestamp, timestamp);
  return database.prepare("SELECT * FROM product_clearance_plans WHERE id=?").get(id);
}

export function updateProductClearancePlan(planId, input = {}) {
  const database = getDatabase();
  const existing = database.prepare("SELECT * FROM product_clearance_plans WHERE id=?").get(text(planId));
  if (!existing) throw new Error("清仓计划不存在。");
  const normalized = normalizePlanInput(input, existing);
  const status = text(input.status) || existing.status;
  if (!productClearancePlanStatuses.includes(status)) throw new Error("清仓计划状态无效。");
  const timestamp = now();
  database.prepare(`UPDATE product_clearance_plans SET status=?,startDate=?,targetDays=?,targetEndDate=?,targetInventoryQuantity=?,note=?,completedAt=?,updatedAt=? WHERE id=?`)
    .run(status, normalized.startDate, normalized.targetDays, normalized.targetEndDate, normalized.targetInventoryQuantity, normalized.note,
      status === "completed" ? existing.completedAt || timestamp : status === "active" ? null : existing.completedAt, timestamp, existing.id);
  return database.prepare("SELECT * FROM product_clearance_plans WHERE id=?").get(existing.id);
}

function contributionMap(database, erpSkuIds, range) {
  if (!erpSkuIds.length) return new Map();
  const result = queryErpSkuContributions({ periodStart: range.startDate, periodEnd: range.endDate, erpSkuIds }, { database });
  return new Map(result.items.map((item) => [item.erpSkuId, item]));
}

function nullableSum(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  return present.length ? present.reduce((sum, value) => sum + Number(value), 0) : null;
}

export function getProductClearancePlanCenter(input = {}, { visibleProductIds = null } = {}) {
  const database = getDatabase();
  const visible = visibleProductIds ? new Set(visibleProductIds.map(text)) : null;
  const statusFilter = productClearancePlanStatuses.includes(text(input.status)) ? text(input.status) : "active";
  const plans = database.prepare(`SELECT plan.*,COALESCE(profile.displayNameOverride,product.name,goods.goodsName,sku.specificationName,sku.merchantSkuCode) productName,
      sku.merchantSkuCode skuCode,COALESCE(sku.mainImage,product.mainImage) mainImage,COALESCE(profile.brandOverride,goods.brand,product.brand) brand,
      COALESCE(profile.categoryOverride,goods.category,product.category) category,COALESCE(profile.businessStatus,product.status) productStatus,
      creator.name createdByName FROM product_clearance_plans plan JOIN erp_skus sku ON sku.id=plan.erpSkuId
      LEFT JOIN erp_goods goods ON goods.id=sku.erpGoodsId LEFT JOIN products product ON product.id=plan.productId
      LEFT JOIN product_business_profiles profile ON profile.erpSkuId=plan.erpSkuId
      LEFT JOIN persons creator ON creator.id=plan.createdBy ORDER BY CASE plan.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,plan.targetEndDate,plan.updatedAt DESC`).all()
    .filter((plan) => !visible || !plan.productId || visible.has(plan.productId));
  const activePlans = plans.filter((plan) => plan.status === "active");
  const erpSkuIds = [...new Set(plans.map((plan) => plan.erpSkuId))];
  const anchorDate = latestCompleteSalesDate(database);
  const range = resolveProductSalesDistributionRange({ preset: text(input.range) || "30d", startDate: input.periodStart, endDate: input.periodEnd }, anchorDate);
  const dailyRange = resolveProductSalesDistributionRange({ preset: "yesterday" }, anchorDate);
  const periodContributions = contributionMap(database, erpSkuIds, range);
  const dailyContributions = contributionMap(database, activePlans.map((plan) => plan.erpSkuId), dailyRange);
  const inventory = readErpSkuInventorySupplyMap(erpSkuIds, { includeCost: true, database });
  const todayDate = today();
  const sinceStartByPlan = new Map();
  const plansByStartDate = new Map();
  for (const plan of plans) {
    const grouped = plansByStartDate.get(plan.startDate) ?? [];
    grouped.push(plan);
    plansByStartDate.set(plan.startDate, grouped);
  }
  for (const [startDate, groupedPlans] of plansByStartDate) {
    const endDate = anchorDate && anchorDate >= startDate ? anchorDate : startDate;
    const groupedContributions = contributionMap(database, [...new Set(groupedPlans.map((plan) => plan.erpSkuId))], { startDate, endDate });
    for (const plan of groupedPlans) sinceStartByPlan.set(plan.id, groupedContributions.get(plan.erpSkuId));
  }
  const decorated = plans.map((plan) => {
    const currentInventory = inventory.get(plan.erpSkuId)?.summary?.stockNum;
    const inventoryQuantity = currentInventory === null || currentInventory === undefined ? null : Number(currentInventory);
    const initialInventory = plan.initialInventoryQuantity === null || plan.initialInventoryQuantity === undefined ? null : Number(plan.initialInventoryQuantity);
    const targetInventory = Number(plan.targetInventoryQuantity || 0);
    let inventoryProgress = null;
    if (inventoryQuantity !== null && initialInventory !== null) {
      inventoryProgress = initialInventory <= targetInventory ? (inventoryQuantity <= targetInventory ? 1 : 0)
        : clamp((initialInventory - inventoryQuantity) / (initialInventory - targetInventory));
    }
    const elapsedDays = Math.max(0, differenceDays(plan.startDate, todayDate) + 1);
    const timeProgress = clamp(elapsedDays / Number(plan.targetDays));
    const overdueDays = plan.status === "active" && todayDate > plan.targetEndDate ? Math.max(1, differenceDays(plan.targetEndDate, todayDate)) : 0;
    const periodContribution = periodContributions.get(plan.erpSkuId);
    const sinceStart = sinceStartByPlan.get(plan.id);
    return { ...plan, initialInventoryQuantity: initialInventory, targetInventoryQuantity: targetInventory, currentInventoryQuantity: inventoryQuantity,
      currentInventoryAmount: inventory.get(plan.erpSkuId)?.summary?.inventoryCostAmount ?? null,
      inventoryReducedQuantity: inventoryQuantity === null || initialInventory === null ? null : Math.max(0, initialInventory - inventoryQuantity),
      inventoryProgress, timeProgress, elapsedDays, remainingDays: Math.max(0, differenceDays(todayDate, plan.targetEndDate) + 1),
      overdueDays, overdue: overdueDays > 0,
      sales: { periodAmount: periodContribution?.directSalesAmount ?? null, periodQuantity: periodContribution?.totalPhysicalContribution ?? null,
        directQuantity: periodContribution?.directSalesQuantity ?? null, bundleContributionQuantity: periodContribution?.bundleContributionQuantity ?? null,
        sinceStartAmount: sinceStart?.directSalesAmount ?? null, sinceStartQuantity: sinceStart?.totalPhysicalContribution ?? null } };
  });
  const dailyRows = activePlans.map((plan) => dailyContributions.get(plan.erpSkuId));
  const knownProgress = decorated.filter((plan) => plan.status === "active" && plan.inventoryProgress !== null).map((plan) => plan.inventoryProgress);
  const activeDecorated = decorated.filter((plan) => plan.status === "active");
  const filteredItems = text(input.status) === "all" ? decorated : decorated.filter((plan) => plan.status === statusFilter);
  return { generatedAt: now(), period: range, dataDate: dailyRange.endDate, status: text(input.status) === "all" ? "all" : statusFilter,
    summary: { activePlanCount: activePlans.length, completedPlanCount: plans.filter((plan) => plan.status === "completed").length,
      overduePlanCount: activeDecorated.filter((plan) => plan.overdue).length,
      dailySalesAmount: nullableSum(dailyRows.map((item) => item?.directSalesAmount)),
      dailySalesQuantity: nullableSum(dailyRows.map((item) => item?.totalPhysicalContribution)),
      remainingInventoryQuantity: nullableSum(activeDecorated.map((item) => item.currentInventoryQuantity)),
      averageInventoryProgress: knownProgress.length ? knownProgress.reduce((sum, value) => sum + value, 0) / knownProgress.length : null },
    items: filteredItems,
    definitions: { sales: "existing sales facts + Sales Object contribution", inventory: "existing inventory supply read model", progress: "initial inventory to target inventory", automaticProductStatusChange: false, automaticCompletion: false } };
}
