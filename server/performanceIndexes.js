const INDEX_DEFINITIONS = Object.freeze([
  {
    name: "idx_erp_skus_merchant_sku_lower",
    sql: `CREATE INDEX idx_erp_skus_merchant_sku_lower
      ON erp_skus(LOWER(merchantSkuCode))`,
  },
  {
    name: "idx_sales_links_shop_platform_goods",
    sql: `CREATE INDEX idx_sales_links_shop_platform_goods
      ON sales_links(shopId,platformGoodsId)`,
  },
]);

function comparableDefinition(sql = "") {
  const normalized = String(sql)
    .replaceAll('"', "")
    .replaceAll("`", "")
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const onIndex = normalized.indexOf("on");
  return onIndex === -1 ? normalized : normalized.slice(onIndex);
}

function existingIndexes(database, table) {
  return database.prepare(`SELECT name,sql FROM sqlite_master
    WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`).all(table);
}

function tableFromDefinition(sql) {
  const match = String(sql).match(/\bON\s+([\w"`\[\]]+)/i);
  if (!match) throw new Error(`无法解析索引定义：${sql}`);
  return match[1].replace(/["`\[\]]/g, "");
}

export function ensurePerformanceIndex(database, definition) {
  const table = tableFromDefinition(definition.sql);
  const expected = comparableDefinition(definition.sql);
  const indexes = existingIndexes(database, table);
  const named = indexes.find((index) => index.name === definition.name);
  if (named) {
    if (comparableDefinition(named.sql) !== expected) {
      const error = new Error(`索引 ${definition.name} 已存在，但定义与性能迁移要求不一致。`);
      error.code = "performance_index_definition_conflict";
      error.indexName = definition.name;
      error.actualSql = named.sql;
      throw error;
    }
    return { name: definition.name, status: "existing", equivalentIndex: definition.name };
  }
  const equivalent = indexes.find((index) => comparableDefinition(index.sql) === expected);
  if (equivalent) return { name: definition.name, status: "equivalent", equivalentIndex: equivalent.name };
  database.exec(definition.sql);
  return { name: definition.name, status: "created", equivalentIndex: definition.name };
}

export function ensureSalesDailyIdentityLookupIndexes(database) {
  return INDEX_DEFINITIONS.map((definition) => ensurePerformanceIndex(database, definition));
}

export const salesDailyIdentityIndexDefinitions = INDEX_DEFINITIONS;
