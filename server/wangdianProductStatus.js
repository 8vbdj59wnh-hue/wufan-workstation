const text = (value) => String(value ?? "").trim();

const schemaSupportCache = new WeakMap();

function hasRawSourceData(database) {
  if (schemaSupportCache.has(database)) return schemaSupportCache.get(database);
  const supported = Boolean(database.prepare("SELECT 1 FROM pragma_table_info('erp_skus') WHERE name='rawSourceData'").get());
  schemaSupportCache.set(database, supported);
  return supported;
}

export function isWangdianDiscontinuedRawSource(rawSourceData) {
  let source = rawSourceData;
  if (typeof source === "string") {
    try { source = JSON.parse(source || "{}"); }
    catch { return false; }
  }
  if (!source || typeof source !== "object") return false;
  if (text(source.prop7) === "已下架") return true;
  return text(source.goods_label).split(/[,，]/u).map(text).includes("已下架");
}

export function isWangdianInSaleRawSource(rawSourceData) {
  let source = rawSourceData;
  if (typeof source === "string") {
    try { source = JSON.parse(source || "{}"); }
    catch { return false; }
  }
  return Boolean(source && typeof source === "object" && text(source.prop7) === "在售");
}

export function wangdianOperatingSkuPredicate(database, alias = "s") {
  if (!hasRawSourceData(database)) return "1=1";
  const raw = `${alias}.rawSourceData`;
  return `NOT (CASE WHEN json_valid(COALESCE(${raw},'')) THEN
    trim(COALESCE(json_extract(${raw},'$.prop7'),''))='已下架'
    OR instr(',' || replace(replace(COALESCE(json_extract(${raw},'$.goods_label'),''),'，',','),' ','') || ',',',已下架,')>0
    ELSE 0 END)`;
}

export function wangdianInSaleSkuPredicate(database, alias = "s") {
  if (!hasRawSourceData(database)) return "0=1";
  const raw = `${alias}.rawSourceData`;
  return `(CASE WHEN json_valid(COALESCE(${raw},'')) THEN
    trim(COALESCE(json_extract(${raw},'$.prop7'),''))='在售'
    ELSE 0 END)`;
}

export function currentProductOperatingSkuPredicate(database, skuAlias = "s", lifecycleAlias = "om") {
  return `(${lifecycleAlias}.lifecycleStatus IN ('active','active_dependency','sales_active')
    OR ${wangdianInSaleSkuPredicate(database, skuAlias)})`;
}
