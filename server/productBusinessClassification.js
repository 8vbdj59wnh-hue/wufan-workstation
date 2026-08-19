export const productBusinessZones = Object.freeze(["new", "hit", "active", "clearance"]);

const defaultNewProductCycleDays = Math.max(1, Number(process.env.PRODUCT_NEW_CYCLE_DAYS) || 30);
const explicitNewStatuses = new Set(["新品", "开发中", "待上架", "上架"]);
const clearanceStatuses = new Set(["风险期", "淘汰", "清仓", "停售"]);

export function classifyProductBusinessZones(items, options = {}) {
  const cycleDays = Math.max(1, Number(options.newCycleDays) || defaultNewProductCycleDays);
  const nowTime = Number(options.nowTime) || Date.now();
  const cycleStart = nowTime - cycleDays * 86400000;
  const isNew = (item) => {
    if (explicitNewStatuses.has(item.status)) return true;
    if (clearanceStatuses.has(item.status)) return false;
    const listedTime = Date.parse(item.listedAt || "");
    return Number.isFinite(listedTime) && listedTime >= cycleStart && listedTime <= nowTime;
  };
  const newIds = new Set(items.filter(isNew).map((item) => item.id));
  const sustained = items.filter((item) => !newIds.has(item.id) && !clearanceStatuses.has(item.status)
    && Number(item.analysis?.sales?.sales30d || 0) > 0
    && (Number(item.analysis?.sales?.previousSales30d || 0) > 0
      || Number(item.analysis?.sales?.sales90d || 0) > Number(item.analysis?.sales?.sales30d || 0)));
  const topCount = sustained.length ? Math.max(1, Math.ceil(sustained.length * 0.2)) : 0;
  const topBy = (read) => new Set([...sustained].filter((item) => read(item) > 0)
    .sort((left, right) => read(right) - read(left)).slice(0, topCount).map((item) => item.id));
  const hitIds = new Set([
    ...topBy((item) => Number(item.analysis?.finance?.revenue || 0)),
    ...topBy((item) => Number(item.analysis?.sales?.sales30d || 0)),
  ]);
  const positiveSales = items.filter((item) => !newIds.has(item.id) && !hitIds.has(item.id))
    .map((item) => Number(item.analysis?.sales?.sales30d || 0)).filter((value) => value > 0).sort((left, right) => left - right);
  const lowSalesThreshold = positiveSales.length >= 5 ? positiveSales[Math.max(0, Math.ceil(positiveSales.length * 0.2) - 1)] : 0;
  const counts = Object.fromEntries(productBusinessZones.map((zone) => [zone, 0]));
  const classified = items.map((item) => {
    const sales30d = Number(item.analysis?.sales?.sales30d || 0);
    const stock = Number(item.analysis?.inventory?.actualStock || 0);
    let businessZone = null;
    if (newIds.has(item.id)) businessZone = "new";
    else if (hitIds.has(item.id)) businessZone = "hit";
    else if (stock > 0 && (clearanceStatuses.has(item.status) || sales30d <= 0 || (lowSalesThreshold > 0 && sales30d <= lowSalesThreshold))) businessZone = "clearance";
    else if (sales30d > 0) businessZone = "active";
    if (businessZone) counts[businessZone] += 1;
    return { ...item, businessZone };
  });
  return { items: classified, counts, rules: { newProductCycleDays: cycleDays, hitTopPercent: 20, lowSalesPercent: 20 } };
}
