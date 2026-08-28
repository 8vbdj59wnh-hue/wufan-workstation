import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";

function stableId(prefix, source) {
  return `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
}

function normalizeSku(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

const autoProfileTaskCode = "erp_goods";
const autoProfileConfigKey = "autoCreateProductProfiles";

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

export function getProductAutoProfileSettings() {
  const task = getDatabase().prepare("SELECT configJson,updatedAt FROM data_sync_tasks WHERE taskCode=?").get(autoProfileTaskCode);
  const config = parseJson(task?.configJson);
  const setting = config?.[autoProfileConfigKey] || {};
  return {
    enabled: setting.enabled === true,
    mode: "new_active_skus",
    updatedAt: setting.updatedAt || task?.updatedAt || null,
    updatedBy: setting.updatedBy || null,
  };
}

export function updateProductAutoProfileSettings({ enabled } = {}, updatedBy = "") {
  if (typeof enabled !== "boolean") throw new Error("自动建档开关参数无效。");
  const database = getDatabase();
  const task = database.prepare("SELECT id,configJson FROM data_sync_tasks WHERE taskCode=?").get(autoProfileTaskCode);
  if (!task) throw new Error("ERP货品同步任务不存在。");
  const updatedAt = new Date().toISOString();
  const config = parseJson(task.configJson);
  config[autoProfileConfigKey] = {
    enabled,
    mode: "new_active_skus",
    updatedAt,
    updatedBy: String(updatedBy ?? "").trim() || null,
  };
  database.prepare("UPDATE data_sync_tasks SET configJson=?,updatedAt=? WHERE id=?")
    .run(JSON.stringify(config), updatedAt, task.id);
  return getProductAutoProfileSettings();
}

export function listPendingErpSkus(search = "") {
  const query = String(search ?? "").trim();
  const like = `%${query}%`;
  return getDatabase().prepare(`
    SELECT
      s.id,
      s.merchantSkuCode,
      s.erpGoodsId,
      g.goodsCode,
      g.goodsName,
      g.brand,
      g.category,
      s.specificationName,
      s.barcode,
      s.unit,
      s.erpStatus,
      s.mainImage,
      s.galleryImages,
      s.firstSeenBatchId,
      s.lastSeenBatchId,
      s.currentState,
      COALESCE(firstBatch.createdAt, s.createdAt) AS firstSeenAt,
      s.createdAt,
      s.updatedAt
    FROM erp_skus s
    JOIN erp_goods g ON g.id = s.erpGoodsId
    LEFT JOIN erp_import_batches firstBatch ON firstBatch.id = s.firstSeenBatchId
    WHERE s.currentState = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM products p
        WHERE lower(trim(p.skuCode)) = lower(trim(s.merchantSkuCode))
      )
      AND (
        @query = ''
        OR s.merchantSkuCode LIKE @like
        OR COALESCE(g.goodsName, '') LIKE @like
        OR g.goodsCode LIKE @like
      )
    ORDER BY COALESCE(firstBatch.createdAt, s.createdAt) ASC, lower(s.merchantSkuCode) ASC, s.id ASC
  `).all({ query, like });
}

function prepareProductFromErpSku(database, erpSkuId) {
  const sku = database.prepare(`
      SELECT s.*, g.goodsCode, g.goodsName, g.brand, g.category
      FROM erp_skus s
      JOIN erp_goods g ON g.id = s.erpGoodsId
      WHERE s.id = ?
      LIMIT 1
    `).get(erpSkuId);
  if (!sku) throw new Error("待建立SKU不存在或已失效。");
  if (sku.currentState !== "active") throw new Error("该ERP SKU当前不是有效状态，无法创建产品。");

  const normalizedSku = normalizeSku(sku.merchantSkuCode);
  if (!normalizedSku) throw new Error("ERP SKU编码为空，无法创建产品。");
  const existingProduct = database.prepare(`
      SELECT id, skuCode, name
      FROM products
      WHERE lower(trim(skuCode)) = ?
      LIMIT 1
    `).get(normalizedSku);
  if (existingProduct) {
    throw new Error(`SKU ${sku.merchantSkuCode} 已存在产品档案，请刷新待建立SKU列表。`);
  }
  const occupiedMapping = database.prepare(`
      SELECT id, productId
      FROM product_erp_mappings
      WHERE lower(trim(merchantSkuCode)) = ?
      LIMIT 1
    `).get(normalizedSku);
  if (occupiedMapping) throw new Error(`SKU ${sku.merchantSkuCode} 已被其他ERP映射占用，无法重复创建产品。`);
  return { sku, normalizedSku };
}

function insertProductFromPreparedErpSku({ sku, normalizedSku }, { matchMethod = "pending_sku_create", sourceSystem = "ERP待建立SKU" } = {}) {
  let galleryImages = [];
  try {
    const parsedGallery = JSON.parse(sku.galleryImages || "[]");
    if (Array.isArray(parsedGallery)) galleryImages = parsedGallery.filter(Boolean);
  } catch {
    galleryImages = [];
  }
  const mainImage = String(sku.mainImage ?? "").trim() || galleryImages[0] || null;
  const now = new Date().toISOString();
  const product = createResource("products", {
      id: stableId("product", normalizedSku),
      skuCode: sku.merchantSkuCode,
      name: String(sku.goodsName ?? "").trim() || sku.merchantSkuCode,
      mainImage,
      galleryImages,
      brand: sku.brand || null,
      category: sku.category || null,
      specification: sku.specificationName || null,
      status: "开发中",
      sourceSystem,
      createdAt: now,
      updatedAt: now,
  });
  const mapping = {
      id: stableId("product-erp-map", product.id),
      productId: product.id,
      erpGoodsId: sku.erpGoodsId,
      erpSkuId: sku.id,
      merchantSkuCode: sku.merchantSkuCode,
      specificationName: sku.specificationName || null,
      unit: sku.unit || null,
      barcode: sku.barcode || null,
      erpStatus: sku.erpStatus || null,
      matchMethod,
      sourceBatchId: sku.lastSeenBatchId,
      latestStateJson: "{}",
      currentState: "active",
      missingAt: null,
      lastSeenInventoryBatchId: null,
      inventoryCurrentState: "missing",
      inventoryMissingAt: now,
      createdAt: now,
      updatedAt: now,
  };
  getDatabase().prepare(`
      INSERT INTO product_erp_mappings (
        id,productId,erpGoodsId,erpSkuId,merchantSkuCode,specificationName,unit,barcode,erpStatus,
        matchMethod,sourceBatchId,latestStateJson,currentState,missingAt,
        lastSeenInventoryBatchId,inventoryCurrentState,inventoryMissingAt,createdAt,updatedAt
      ) VALUES (
        @id,@productId,@erpGoodsId,@erpSkuId,@merchantSkuCode,@specificationName,@unit,@barcode,@erpStatus,
        @matchMethod,@sourceBatchId,@latestStateJson,@currentState,@missingAt,
        @lastSeenInventoryBatchId,@inventoryCurrentState,@inventoryMissingAt,@createdAt,@updatedAt
      )
  `).run(mapping);
  return {
    product,
    mapping: { ...mapping, latestStateJson: {} },
  };
}

export function createProductFromErpSku(erpSkuId, options = {}) {
  const database = getDatabase();
  return database.transaction(() => (
    insertProductFromPreparedErpSku(prepareProductFromErpSku(database, erpSkuId), options)
  ))();
}

export function createProductsFromErpSkus(erpSkuIds) {
  const ids = [...new Set((Array.isArray(erpSkuIds) ? erpSkuIds : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("请至少选择一个待建立SKU。");
  const database = getDatabase();
  return database.transaction(() => {
    const prepared = ids.map((erpSkuId) => prepareProductFromErpSku(database, erpSkuId));
    const normalizedCodes = new Set();
    for (const item of prepared) {
      if (normalizedCodes.has(item.normalizedSku)) {
        throw new Error(`SKU ${item.sku.merchantSkuCode} 在本次选择中重复，无法批量创建。`);
      }
      normalizedCodes.add(item.normalizedSku);
    }
    const created = prepared.map((item) => insertProductFromPreparedErpSku(item));
    return {
      products: created.map((item) => item.product),
      mappings: created.map((item) => item.mapping),
      createdCount: created.length,
    };
  })();
}

export function autoCreateProductProfilesForImportBatch(importBatchId) {
  const settings = getProductAutoProfileSettings();
  if (!settings.enabled) return { enabled: false, attemptedCount: 0, createdCount: 0, failedCount: 0, created: [], failures: [] };
  const database = getDatabase();
  const candidates = database.prepare(`
    SELECT s.id,s.merchantSkuCode
    FROM erp_skus s
    WHERE s.firstSeenBatchId=? AND s.currentState='active'
      AND NOT EXISTS (
        SELECT 1 FROM product_erp_mappings m
        WHERE m.erpSkuId=s.id AND m.currentState='active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM products p
        WHERE lower(trim(p.skuCode))=lower(trim(s.merchantSkuCode))
      )
    ORDER BY lower(s.merchantSkuCode),s.id
  `).all(String(importBatchId ?? "").trim());
  const created = [];
  const failures = [];
  for (const candidate of candidates) {
    try {
      const result = createProductFromErpSku(candidate.id, {
        matchMethod: "erp_sync_auto_profile",
        sourceSystem: "旺店通ERP自动建档",
      });
      created.push({ erpSkuId: candidate.id, merchantSkuCode: candidate.merchantSkuCode, productId: result.product.id });
    } catch (error) {
      failures.push({ erpSkuId: candidate.id, merchantSkuCode: candidate.merchantSkuCode, message: error.message || "自动建档失败。" });
    }
  }
  return {
    enabled: true,
    attemptedCount: candidates.length,
    createdCount: created.length,
    failedCount: failures.length,
    created,
    failures,
  };
}
