import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";

const chunk = (items, size = 500) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function snapshotIdForSyncRun(syncRunId) {
  return `erp-snapshot-${crypto.createHash("sha256").update(String(syncRunId)).digest("hex").slice(0, 24)}`;
}

function nullableSum(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

function decodeSnapshot(row) {
  if (!row) return null;
  return { ...row, isCurrent: Boolean(row.isCurrent), errorSummary: parseJson(row.errorSummary, []) };
}

function readSnapshotRow(id) {
  return getDatabase().prepare("SELECT * FROM erp_fact_snapshots WHERE id=?").get(id) ?? null;
}

export function collectErpSnapshotFacts(database) {
  const products = database.prepare("SELECT id,skuCode,name,status FROM products ORDER BY id").all();
  const mappings = database.prepare(`
    SELECT m.*,g.goodsCode
    FROM product_erp_mappings m
    JOIN erp_goods g ON g.id=m.erpGoodsId
    WHERE m.currentState='active'
      AND m.inventoryCurrentState='active'
      AND g.currentState='active'
    ORDER BY m.id
  `).all().map((row) => ({ ...row, latestState: parseJson(row.latestStateJson, {}) }));
  const shops = database.prepare("SELECT id,platform,status FROM sales_shops ORDER BY id").all();
  const links = database.prepare("SELECT * FROM sales_links WHERE currentState='active' ORDER BY id").all();
  const skus = database.prepare(`
    SELECT x.*
    FROM sales_link_skus x
    JOIN sales_links l ON l.id=x.salesLinkId AND l.currentState='active'
    WHERE x.currentState='active'
    ORDER BY x.id
  `).all();
  const resolved = {};
  for (const ids of chunk(skus.map((sku) => sku.id))) {
    Object.assign(resolved, resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, {
      database, scope: "productWorkspace", salesObjectResolverEnabled: true,
      enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES, logDifference: () => {},
    }).results);
  }
  const productByErpSku = new Map(database.prepare(`
    SELECT erpSkuId,productId FROM product_erp_mappings
    WHERE currentState='active' AND erpSkuId IS NOT NULL AND productId IS NOT NULL
    ORDER BY updatedAt,id
  `).all().map((row) => [row.erpSkuId, row.productId]));
  const relationsBySku = new Map(skus.map((sku) => {
    const relation = resolved[sku.id];
    const components = relation?.isUsable ? relation.mappings.map((mapping) => ({
      erpSkuId: mapping.erpSkuId, quantity: Number(mapping.quantity), productId: productByErpSku.get(mapping.erpSkuId) ?? null,
    })) : [];
    return [sku.id, { relationStatus: relation?.relationStatus ?? "missing", relationshipShape: relation?.relationshipShape ?? null,
      resolverSource: relation?.resolverSource ?? null, components, productIds: [...new Set(components.map((item) => item.productId).filter(Boolean))] }];
  }));
  return { products, mappings, shops, links, skus, relationsBySku };
}

export function buildErpSnapshotRows(facts, snapshot, run) {
  const mappingsByProduct = new Map();
  for (const mapping of facts.mappings) {
    const rows = mappingsByProduct.get(mapping.productId) ?? [];
    rows.push(mapping);
    mappingsByProduct.set(mapping.productId, rows);
  }
  const shopsById = new Map(facts.shops.map((shop) => [shop.id, shop]));
  const linksById = new Map(facts.links.map((link) => [link.id, link]));
  const skusByLink = new Map();
  const validSkusByProduct = new Map();
  for (const sku of facts.skus) {
    const linkRows = skusByLink.get(sku.salesLinkId) ?? [];
    linkRows.push(sku);
    skusByLink.set(sku.salesLinkId, linkRows);
    const resolvedRelation = facts.relationsBySku.get(sku.id);
    for (const productId of resolvedRelation?.productIds ?? []) {
      const productRows = validSkusByProduct.get(productId) ?? [];
      productRows.push(sku);
      validSkusByProduct.set(productId, productRows);
    }
  }

  const erpRows = facts.mappings.map((mapping) => ({
    snapshotId: snapshot.id,
    businessDate: snapshot.businessDate,
    productId: mapping.productId,
    mappingId: mapping.id,
    erpGoodsId: mapping.erpGoodsId,
    goodsCode: mapping.goodsCode,
    merchantCode: mapping.merchantSkuCode,
    specificationName: mapping.specificationName ?? null,
    barcode: mapping.barcode ?? null,
    unit: mapping.unit ?? null,
    erpStatus: mapping.erpStatus ?? null,
    unitCost: mapping.latestState.costPrice ?? null,
    stock: mapping.latestState.stock ?? null,
    shippableStock: mapping.latestState.shippableStock ?? null,
    availableStock: mapping.latestState.availableStock ?? null,
    actualStock: mapping.latestState.actualStock ?? null,
    actualShippableStock: mapping.latestState.actualShippableStock ?? null,
    purchaseInTransit: mapping.latestState.purchaseInTransit ?? null,
    pendingShipment: mapping.latestState.pendingShipment ?? null,
    sales7d: mapping.latestState.sales7d ?? null,
    sales30d: mapping.latestState.sales30d ?? null,
    sales90d: mapping.latestState.sales90d ?? null,
    sales180d: mapping.latestState.sales180d ?? null,
    totalSales: mapping.latestState.totalSales ?? null,
    sourceBatchId: mapping.sourceBatchId ?? run.inventoryBatchId,
    createdAt: snapshot.createdAt,
  }));

  const productRows = facts.products.map((product) => {
    const mappings = mappingsByProduct.get(product.id) ?? [];
    const validSkus = validSkusByProduct.get(product.id) ?? [];
    const linkIds = new Set(validSkus.map((sku) => sku.salesLinkId));
    const shopIds = new Set([...linkIds].map((linkId) => linksById.get(linkId)?.shopId).filter(Boolean));
    const platforms = new Set([...shopIds].map((shopId) => shopsById.get(shopId)?.platform).filter(Boolean));
    const stateRows = mappings.map((mapping) => mapping.latestState);
    const erpStatuses = [...new Set(mappings.map((mapping) => mapping.erpStatus).filter(Boolean))];
    return {
      snapshotId: snapshot.id,
      businessDate: snapshot.businessDate,
      productId: product.id,
      skuCode: product.skuCode,
      productName: product.name,
      erpGoodsCount: new Set(mappings.map((mapping) => mapping.erpGoodsId)).size,
      totalStock: nullableSum(stateRows, "stock"),
      availableStock: nullableSum(stateRows, "availableStock"),
      shippableStock: nullableSum(stateRows, "shippableStock"),
      purchaseInTransit: nullableSum(stateRows, "purchaseInTransit"),
      pendingShipment: nullableSum(stateRows, "pendingShipment"),
      sales7d: nullableSum(stateRows, "sales7d"),
      sales30d: nullableSum(stateRows, "sales30d"),
      sales90d: nullableSum(stateRows, "sales90d"),
      sales180d: nullableSum(stateRows, "sales180d"),
      totalSales: nullableSum(stateRows, "totalSales"),
      platformCount: platforms.size,
      shopCount: shopIds.size,
      salesLinkCount: linkIds.size,
      platformSkuCount: validSkus.length,
      productStatus: product.status,
      erpStatus: erpStatuses.length === 1 ? erpStatuses[0] : erpStatuses.length ? "mixed" : null,
      createdAt: snapshot.createdAt,
    };
  });

  const linkRows = facts.links.map((link) => {
    const shop = shopsById.get(link.shopId);
    const linkSkus = skusByLink.get(link.id) ?? [];
    return {
      snapshotId: snapshot.id,
      businessDate: snapshot.businessDate,
      salesLinkId: link.id,
      shopId: link.shopId,
      platform: shop?.platform ?? null,
      platformGoodsId: link.platformGoodsId ?? null,
      canonicalUrl: link.canonicalUrl ?? null,
      goodsTitle: link.title ?? null,
      linkStatus: link.status ?? null,
      price: nullableSum(linkSkus, "price"),
      platformStock: nullableSum(linkSkus, "platformStock"),
      occupiedStock: nullableSum(linkSkus, "occupiedStock"),
      firstSeenAt: link.createdAt ?? null,
      lastSeenBatchId: run.platformGoodsBatchId ?? null,
      sourceBatchId: run.platformGoodsBatchId,
      createdAt: snapshot.createdAt,
    };
  });

  const skuRows = facts.skus.map((sku) => {
    const resolvedRelation = facts.relationsBySku.get(sku.id);
    return {
      snapshotId: snapshot.id,
      businessDate: snapshot.businessDate,
      salesLinkSkuId: sku.id,
      salesLinkId: sku.salesLinkId,
      platformSkuId: sku.platformSkuId ?? null,
      merchantCode: sku.platformSkuCode ?? null,
      skuName: sku.specificationName ?? null,
      matchStatus: sku.matchStatus,
      productId: resolvedRelation?.productIds.length === 1 ? resolvedRelation.productIds[0] : null,
      combinationFlag: ["multi_component", "single_multi_quantity"].includes(resolvedRelation?.relationshipShape) ? 1 : 0,
      platformPrice: sku.price ?? null,
      platformStock: sku.platformStock ?? null,
      occupiedStock: sku.occupiedStock ?? null,
      sourceBatchId: run.platformGoodsBatchId,
      createdAt: snapshot.createdAt,
    };
  });

  const relationMap = new Map();
  for (const [productId, skus] of validSkusByProduct.entries()) {
    for (const sku of skus) {
      const link = linksById.get(sku.salesLinkId);
      const shop = link ? shopsById.get(link.shopId) : null;
      if (!link || !shop) continue;
      const key = `${productId}|${shop.id}`;
      const relation = relationMap.get(key) ?? {
        snapshotId: snapshot.id,
        businessDate: snapshot.businessDate,
        productId,
        shopId: shop.id,
        platform: shop.platform,
        salesLinkIds: new Set(),
        platformSkuIds: new Set(),
        createdAt: snapshot.createdAt,
      };
      relation.salesLinkIds.add(link.id);
      relation.platformSkuIds.add(sku.id);
      relationMap.set(key, relation);
    }
  }
  const relationRows = [...relationMap.values()].map((row) => ({
    snapshotId: row.snapshotId,
    businessDate: row.businessDate,
    productId: row.productId,
    shopId: row.shopId,
    platform: row.platform,
    salesLinkCount: row.salesLinkIds.size,
    platformSkuCount: row.platformSkuIds.size,
    createdAt: row.createdAt,
  }));
  return { productRows, erpRows, linkRows, skuRows, relationRows };
}

function insertRows(database, table, columns, rows) {
  if (!rows.length) return;
  const statement = database.prepare(`
    INSERT INTO ${table} (${columns.join(",")})
    VALUES (${columns.map((column) => `@${column}`).join(",")})
  `);
  for (const row of rows) statement.run(row);
}

export function generateErpFactSnapshot(syncRunId, { failAfterStage = "" } = {}) {
  const database = getDatabase();
  const existing = decodeSnapshot(database.prepare("SELECT * FROM erp_fact_snapshots WHERE syncRunId=?").get(syncRunId));
  if (existing?.status === "completed") return { snapshot: existing, idempotent: true };
  const run = database.prepare("SELECT * FROM erp_sync_runs WHERE id=?").get(syncRunId);
  if (!run) throw new Error("ERP同步批次不存在。");
  const syncType = run.syncType || "legacy_combined";
  if (syncType === "master_data") throw new Error("ERP主数据同步不生成经营事实快照。");
  if (!["daily_business", "legacy_combined"].includes(syncType)) {
    throw new Error("ERP同步类型无效，不能生成历史快照。");
  }
  if (run.status !== "completed") throw new Error("只有三张ERP表全部完成后才能生成历史快照。");
  if (run.reconciliationStatus !== "completed") throw new Error("缺失记录对账完成后才能生成历史快照。");
  const now = new Date().toISOString();
  const snapshot = {
    id: snapshotIdForSyncRun(run.id),
    syncRunId: run.id,
    businessDate: run.businessDate,
    version: run.version,
    status: "generating",
    isCurrent: 0,
    supersedesSnapshotId: null,
    productCount: 0,
    inventoryRowCount: 0,
    salesLinkCount: 0,
    platformSkuCount: 0,
    productShopRelationCount: 0,
    contentHash: null,
    createdAt: now,
    completedAt: null,
    errorSummary: "[]",
  };
  try {
    const result = database.transaction(() => {
      const previous = database.prepare(`
        SELECT * FROM erp_fact_snapshots
        WHERE businessDate=? AND status='completed'
        ORDER BY version DESC LIMIT 1
      `).get(run.businessDate);
      snapshot.supersedesSnapshotId = previous?.id ?? null;
      database.prepare("DELETE FROM erp_fact_snapshots WHERE syncRunId=? AND status<>'completed'").run(run.id);
      database.prepare(`
        INSERT INTO erp_fact_snapshots (
          id,syncRunId,businessDate,version,status,isCurrent,supersedesSnapshotId,
          productCount,inventoryRowCount,salesLinkCount,platformSkuCount,productShopRelationCount,
          contentHash,createdAt,completedAt,errorSummary
        ) VALUES (
          @id,@syncRunId,@businessDate,@version,@status,@isCurrent,@supersedesSnapshotId,
          @productCount,@inventoryRowCount,@salesLinkCount,@platformSkuCount,@productShopRelationCount,
          @contentHash,@createdAt,@completedAt,@errorSummary
        )
      `).run(snapshot);
      const facts = collectErpSnapshotFacts(database);
      const rows = buildErpSnapshotRows(facts, snapshot, run);
      insertRows(database, "product_daily_snapshots", [
        "snapshotId", "businessDate", "productId", "skuCode", "productName", "erpGoodsCount",
        "totalStock", "availableStock", "shippableStock", "purchaseInTransit", "pendingShipment",
        "sales7d", "sales30d", "sales90d", "sales180d", "totalSales", "platformCount", "shopCount",
        "salesLinkCount", "platformSkuCount", "productStatus", "erpStatus", "createdAt",
      ], rows.productRows);
      if (failAfterStage === "products") throw new Error("测试注入：产品快照后回滚");
      insertRows(database, "product_erp_daily_snapshots", [
        "snapshotId", "businessDate", "productId", "mappingId", "erpGoodsId", "goodsCode",
        "merchantCode", "specificationName", "barcode", "unit", "erpStatus", "unitCost", "stock", "shippableStock",
        "availableStock", "actualStock", "actualShippableStock", "purchaseInTransit", "pendingShipment",
        "sales7d", "sales30d", "sales90d", "sales180d", "totalSales", "sourceBatchId", "createdAt",
      ], rows.erpRows);
      insertRows(database, "sales_link_daily_snapshots", [
        "snapshotId", "businessDate", "salesLinkId", "shopId", "platform", "platformGoodsId",
        "canonicalUrl", "goodsTitle", "linkStatus", "price", "platformStock", "occupiedStock",
        "firstSeenAt", "lastSeenBatchId", "sourceBatchId", "createdAt",
      ], rows.linkRows);
      insertRows(database, "sales_link_sku_daily_snapshots", [
        "snapshotId", "businessDate", "salesLinkSkuId", "salesLinkId", "platformSkuId", "merchantCode",
        "skuName", "matchStatus", "productId", "combinationFlag", "platformPrice",
        "platformStock", "occupiedStock", "sourceBatchId", "createdAt",
      ], rows.skuRows);
      insertRows(database, "product_shop_daily_snapshots", [
        "snapshotId", "businessDate", "productId", "shopId", "platform", "salesLinkCount",
        "platformSkuCount", "createdAt",
      ], rows.relationRows);
      const hash = crypto.createHash("sha256");
      for (const group of Object.values(rows)) {
        for (const row of group) hash.update(JSON.stringify(row));
      }
      const completedAt = new Date().toISOString();
      database.prepare("UPDATE erp_fact_snapshots SET isCurrent=0 WHERE businessDate=? AND id<>?")
        .run(run.businessDate, snapshot.id);
      database.prepare(`
        UPDATE erp_fact_snapshots SET
          status='completed',isCurrent=1,productCount=?,inventoryRowCount=?,salesLinkCount=?,
          platformSkuCount=?,productShopRelationCount=?,contentHash=?,completedAt=?,errorSummary='[]'
        WHERE id=?
      `).run(
        rows.productRows.length,
        rows.erpRows.length,
        rows.linkRows.length,
        rows.skuRows.length,
        rows.relationRows.length,
        hash.digest("hex"),
        completedAt,
        snapshot.id,
      );
      database.prepare(`
        UPDATE erp_sync_runs SET snapshotId=?,snapshotStatus='completed',snapshotCompletedAt=?,
          snapshotError=NULL,updatedAt=? WHERE id=?
      `).run(snapshot.id, completedAt, completedAt, run.id);
      return decodeSnapshot(readSnapshotRow(snapshot.id));
    }).immediate();
    return { snapshot: result, idempotent: false };
  } catch (error) {
    const failedAt = new Date().toISOString();
    database.prepare(`
      UPDATE erp_sync_runs SET snapshotId=NULL,snapshotStatus='failed',snapshotCompletedAt=NULL,
        snapshotError=?,updatedAt=? WHERE id=?
    `).run(error.message || "历史快照生成失败。", failedAt, run.id);
    throw error;
  }
}

export function readErpFactSnapshot(snapshotId, { includeDetails = false } = {}) {
  const snapshot = decodeSnapshot(readSnapshotRow(snapshotId));
  if (!snapshot) return null;
  if (!includeDetails) return snapshot;
  const database = getDatabase();
  return {
    ...snapshot,
    products: database.prepare("SELECT * FROM product_daily_snapshots WHERE snapshotId=? ORDER BY skuCode").all(snapshot.id),
    erpMappings: database.prepare("SELECT * FROM product_erp_daily_snapshots WHERE snapshotId=? ORDER BY merchantCode").all(snapshot.id),
    salesLinks: database.prepare("SELECT * FROM sales_link_daily_snapshots WHERE snapshotId=? ORDER BY platform,shopId,goodsTitle").all(snapshot.id),
    platformSkus: database.prepare("SELECT * FROM sales_link_sku_daily_snapshots WHERE snapshotId=? ORDER BY salesLinkId,merchantCode").all(snapshot.id),
    productShopRelations: database.prepare("SELECT * FROM product_shop_daily_snapshots WHERE snapshotId=? ORDER BY productId,platform,shopId").all(snapshot.id),
  };
}

export function listErpFactSnapshots({ businessDate = "", currentOnly = false } = {}) {
  const clauses = ["status='completed'"];
  const params = [];
  if (businessDate) {
    clauses.push("businessDate=?");
    params.push(businessDate);
  }
  if (currentOnly) clauses.push("isCurrent=1");
  return getDatabase().prepare(`
    SELECT * FROM erp_fact_snapshots
    WHERE ${clauses.join(" AND ")}
    ORDER BY businessDate DESC,version DESC
  `).all(...params).map(decodeSnapshot);
}

export function listProductFactSnapshots(productId) {
  return getDatabase().prepare(`
    SELECT p.*,s.version,s.isCurrent,s.syncRunId,s.status AS snapshotStatus
    FROM product_daily_snapshots p
    JOIN erp_fact_snapshots s ON s.id=p.snapshotId
    WHERE p.productId=? AND s.status='completed'
    ORDER BY p.businessDate DESC,s.version DESC
  `).all(productId).map((row) => ({ ...row, isCurrent: Boolean(row.isCurrent) }));
}
