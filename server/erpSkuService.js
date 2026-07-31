import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";

function stableId(prefix, source) {
  return `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
}

function normalizeSku(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
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

export function createProductFromErpSku(erpSkuId) {
  const database = getDatabase();
  return database.transaction(() => {
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
    if (occupiedMapping) throw new Error("该SKU已被其他ERP映射占用，无法重复创建产品。");

    const now = new Date().toISOString();
    const product = createResource("products", {
      id: stableId("product", normalizedSku),
      skuCode: sku.merchantSkuCode,
      name: String(sku.goodsName ?? "").trim() || sku.merchantSkuCode,
      mainImage: null,
      galleryImages: [],
      brand: sku.brand || null,
      category: sku.category || null,
      specification: sku.specificationName || null,
      status: "开发中",
      sourceSystem: "ERP待建立SKU",
      createdAt: now,
      updatedAt: now,
    });
    const mapping = {
      id: stableId("product-erp-map", product.id),
      productId: product.id,
      erpGoodsId: sku.erpGoodsId,
      merchantSkuCode: sku.merchantSkuCode,
      specificationName: sku.specificationName || null,
      unit: sku.unit || null,
      barcode: sku.barcode || null,
      erpStatus: sku.erpStatus || null,
      matchMethod: "pending_sku_create",
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
    database.prepare(`
      INSERT INTO product_erp_mappings (
        id,productId,erpGoodsId,merchantSkuCode,specificationName,unit,barcode,erpStatus,
        matchMethod,sourceBatchId,latestStateJson,currentState,missingAt,
        lastSeenInventoryBatchId,inventoryCurrentState,inventoryMissingAt,createdAt,updatedAt
      ) VALUES (
        @id,@productId,@erpGoodsId,@merchantSkuCode,@specificationName,@unit,@barcode,@erpStatus,
        @matchMethod,@sourceBatchId,@latestStateJson,@currentState,@missingAt,
        @lastSeenInventoryBatchId,@inventoryCurrentState,@inventoryMissingAt,@createdAt,@updatedAt
      )
    `).run(mapping);
    return {
      product,
      mapping: { ...mapping, latestStateJson: {} },
    };
  })();
}
