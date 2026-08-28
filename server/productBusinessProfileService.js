import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();

export const productBusinessStatuses = Object.freeze(["active", "paused", "clearance", "archived"]);
export const productBusinessProfileFields = Object.freeze([
  "businessStatus", "lifecycle", "ownerId", "brandOverride", "categoryOverride", "businessRole", "displayNameOverride",
]);

function rowToIdentity(row) {
  if (!row) return null;
  return {
    id: row.erpSkuId,
    erpSkuId: row.erpSkuId,
    legacyProductId: row.legacyProductId || null,
    skuCode: row.merchantSkuCode,
    name: row.displayNameOverride || row.legacyProductName || row.goodsName || row.specificationName || row.merchantSkuCode,
    mainImage: row.mainImage || row.legacyMainImage || null,
    legacyMainImage: row.legacyMainImage || null,
    legacyGalleryImages: row.legacyGalleryImages || "[]",
    legacySeries: row.legacySeries || null,
    legacyMaterial: row.legacyMaterial || null,
    legacyColor: row.legacyColor || null,
    legacySpecification: row.legacySpecification || null,
    brand: row.brandOverride || row.erpBrand || row.legacyBrand || null,
    category: row.categoryOverride || row.erpCategory || row.legacyCategory || null,
    status: row.businessStatus || "active",
    businessStatus: row.businessStatus || null,
    lifecycle: row.lifecycle || null,
    ownerId: row.ownerId || null,
    businessRole: row.businessRole || null,
    brandOverride: row.brandOverride || null,
    categoryOverride: row.categoryOverride || null,
    displayNameOverride: row.displayNameOverride || null,
    profileId: row.profileId || null,
    profileCreatedAt: row.profileCreatedAt || null,
    profileUpdatedAt: row.profileUpdatedAt || null,
  };
}

export function resolveProductBusinessIdentity(identifier, { database = getDatabase() } = {}) {
  const id = text(identifier);
  if (!id) throw new Error("ERP SKU不能为空。");
  const row = database.prepare(`SELECT sku.id erpSkuId,sku.merchantSkuCode,sku.specificationName,sku.mainImage,
      goods.goodsName,goods.brand erpBrand,goods.category erpCategory,
      mapping.productId legacyProductId,product.name legacyProductName,product.mainImage legacyMainImage,product.galleryImages legacyGalleryImages,
      product.series legacySeries,product.material legacyMaterial,product.color legacyColor,product.specification legacySpecification,
      product.brand legacyBrand,product.category legacyCategory,
      profile.id profileId,profile.businessStatus,profile.lifecycle,profile.ownerId,profile.brandOverride,profile.categoryOverride,
      profile.businessRole,profile.displayNameOverride,profile.createdAt profileCreatedAt,profile.updatedAt profileUpdatedAt
    FROM erp_skus sku LEFT JOIN erp_goods goods ON goods.id=sku.erpGoodsId
    LEFT JOIN product_erp_mappings mapping ON mapping.id=(SELECT value.id FROM product_erp_mappings value
      WHERE value.erpSkuId=sku.id AND value.currentState='active' ORDER BY value.updatedAt DESC,value.id DESC LIMIT 1)
    LEFT JOIN products product ON product.id=mapping.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=sku.id
    WHERE sku.id=? OR mapping.productId=? ORDER BY CASE WHEN sku.id=? THEN 0 ELSE 1 END LIMIT 1`).get(id, id, id);
  if (!row) throw new Error("ERP SKU不存在。");
  return rowToIdentity(row);
}

export function getProductBusinessProfile(identifier, options = {}) {
  const database = options.database || getDatabase();
  const product = resolveProductBusinessIdentity(identifier, { database });
  const counts = database.prepare(`SELECT
      EXISTS(SELECT 1 FROM product_strategy_versions WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?)) strategy,
      EXISTS(SELECT 1 FROM product_marketing_assets WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?)) marketing,
      EXISTS(SELECT 1 FROM product_insights WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?)) insight,
      EXISTS(SELECT 1 FROM product_improvements WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?)) improvement,
      EXISTS(SELECT 1 FROM product_clearance_plans WHERE erpSkuId=? OR (erpSkuId IS NULL AND productId=?)) clearance`)
    .get(product.erpSkuId, product.legacyProductId, product.erpSkuId, product.legacyProductId, product.erpSkuId, product.legacyProductId,
      product.erpSkuId, product.legacyProductId, product.erpSkuId, product.legacyProductId);
  const stages = [];
  if (product.profileId) stages.push("basic");
  if (counts.strategy) stages.push("strategy");
  if (counts.marketing) stages.push("marketing");
  if (counts.insight) stages.push("insight");
  return { product, profile: product.profileId ? {
    id: product.profileId, erpSkuId: product.erpSkuId, businessStatus: product.businessStatus, lifecycle: product.lifecycle,
    ownerId: product.ownerId, businessRole: product.businessRole, brandOverride: product.brandOverride,
    categoryOverride: product.categoryOverride, displayNameOverride: product.displayNameOverride, createdAt: product.profileCreatedAt, updatedAt: product.profileUpdatedAt,
  } : null, completeness: { code: stages.length ? "maintained" : "unmaintained", label: stages.length ? "经营资料已维护" : "资料未维护", stages, ...counts } };
}

export function upsertProductBusinessProfile(identifier, input = {}, userId = "", { database = getDatabase() } = {}) {
  const product = resolveProductBusinessIdentity(identifier, { database });
  const current = database.prepare("SELECT * FROM product_business_profiles WHERE erpSkuId=?").get(product.erpSkuId);
  const value = {};
  for (const field of productBusinessProfileFields) {
    if (input[field] !== undefined) value[field] = text(input[field]) || null;
    else value[field] = current?.[field] ?? null;
  }
  if (value.businessStatus && !productBusinessStatuses.includes(value.businessStatus)) throw new Error("产品经营状态无效。");
  if (value.ownerId && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(value.ownerId)) throw new Error("负责人不存在或已停用。");
  const requestedActorId = text(userId);
  const actorId = requestedActorId && database.prepare("SELECT 1 FROM persons WHERE id=?").get(requestedActorId) ? requestedActorId : null;
  const timestamp = now();
  database.prepare(`INSERT INTO product_business_profiles
      (id,erpSkuId,businessStatus,lifecycle,ownerId,brandOverride,categoryOverride,businessRole,displayNameOverride,createdBy,updatedBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(erpSkuId) DO UPDATE SET businessStatus=excluded.businessStatus,lifecycle=excluded.lifecycle,ownerId=excluded.ownerId,
      brandOverride=excluded.brandOverride,categoryOverride=excluded.categoryOverride,businessRole=excluded.businessRole,
      displayNameOverride=excluded.displayNameOverride,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`)
    .run(current?.id || `product-business-profile-${crypto.randomUUID()}`, product.erpSkuId, value.businessStatus, value.lifecycle, value.ownerId,
      value.brandOverride, value.categoryOverride, value.businessRole, value.displayNameOverride, current?.createdBy || actorId,
      actorId, current?.createdAt || timestamp, timestamp);
  return getProductBusinessProfile(product.erpSkuId, { database });
}

export function productBusinessIdentityPredicate(alias = "record") {
  return `(${alias}.erpSkuId=@erpSkuId OR (${alias}.erpSkuId IS NULL AND ${alias}.productId=@legacyProductId))`;
}

export function productBusinessIdentityParams(product) {
  return { erpSkuId: product.erpSkuId, legacyProductId: product.legacyProductId };
}

export function getProductBusinessMigrationReport({ database = getDatabase() } = {}) {
  const scalar = (sql) => Number(database.prepare(sql).get()?.count || 0);
  const fields = ["product_marketing_assets", "action_products", "product_lifecycle_events", "product_health_records", "product_issues",
    "product_improvements", "product_strategy_versions", "product_insights", "product_clearance_plans"];
  return {
    legacyProducts: scalar("SELECT COUNT(*) count FROM products"),
    mappedLegacyProducts: scalar("SELECT COUNT(DISTINCT productId) count FROM product_erp_mappings WHERE currentState='active'"),
    profiles: scalar("SELECT COUNT(*) count FROM product_business_profiles"),
    unmappedLegacyProducts: scalar("SELECT COUNT(*) count FROM products product WHERE NOT EXISTS(SELECT 1 FROM product_erp_mappings mapping WHERE mapping.productId=product.id AND mapping.currentState='active')"),
    mappingConflicts: scalar(`SELECT COUNT(*) count FROM (SELECT erpSkuId FROM product_erp_mappings WHERE currentState='active' GROUP BY erpSkuId HAVING COUNT(DISTINCT productId)>1
      UNION ALL SELECT productId FROM product_erp_mappings WHERE currentState='active' GROUP BY productId HAVING COUNT(DISTINCT erpSkuId)>1)`),
    domainBackfills: Object.fromEntries(fields.map((table) => [table, scalar(`SELECT COUNT(*) count FROM ${table} WHERE erpSkuId IS NOT NULL`)])),
  };
}
