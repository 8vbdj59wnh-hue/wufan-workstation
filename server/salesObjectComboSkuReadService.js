import { getDatabase } from "./db.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";

const clean = (value) => String(value ?? "").trim();

export function listSalesObjectComboSkus(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const limit = Math.min(500, Math.max(1, Number(input.limit) || 100));
  const offset = Math.max(0, Number(input.offset) || 0);
  const keyword = clean(input.keyword);
  const params = { limit, offset, keyword: `%${keyword}%` };
  const rows = database.prepare(`SELECT r.linkSkuId,o.id salesObjectId,o.objectCode,o.objectType,o.status,s.id structureId,s.version
    FROM sales_objects o JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=o.id AND r.status='active'
    JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    WHERE o.objectType='bundle' AND o.status='active' AND (@keyword='%%' OR o.objectCode LIKE @keyword)
    ORDER BY o.objectCode,r.linkSkuId LIMIT @limit OFFSET @offset`).all(params);
  const read = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: rows.map((row) => row.linkSkuId) }, { ...options, database, scope: "comboSkuManagement", shadowCompare: true, salesObjectResolverEnabled: true, enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES });
  return { feature: read.feature, differences: read.differences, items: rows.map((row) => ({ ...row, relation: read.results[row.linkSkuId] })) };
}

export default listSalesObjectComboSkus;
