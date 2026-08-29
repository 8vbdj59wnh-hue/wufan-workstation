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

export function wangdianOperatingSkuPredicate(database, alias = "s") {
  if (!hasRawSourceData(database)) return "1=1";
  const raw = `${alias}.rawSourceData`;
  return `NOT (CASE WHEN json_valid(COALESCE(${raw},'')) THEN
    trim(COALESCE(json_extract(${raw},'$.prop7'),''))='已下架'
    OR instr(',' || replace(replace(COALESCE(json_extract(${raw},'$.goods_label'),''),'，',','),' ','') || ',',',已下架,')>0
    ELSE 0 END)`;
}
