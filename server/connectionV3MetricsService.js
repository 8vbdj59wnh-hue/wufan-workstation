import { getDatabase } from "./db.js";

function growth(current, previous, field) {
  if (!current || !previous) return null;
  const base = Number(previous[field] || 0);
  if (!base) return Number(current[field] || 0) === 0 ? 0 : null;
  return (Number(current[field] || 0) - base) / base;
}

export function readConnectionV3Metrics(salesLinkId) {
  return readConnectionV3MetricsMap([salesLinkId]).get(salesLinkId) ?? emptyMetrics();
}

function emptyMetrics() {
  return { current: { periodStart: null, periodEnd: null, shippedQuantity: null, salesAmount: null, costAmount: null, profitAmount: null, profitMargin: null }, previous: null, salesGrowth: null, profitGrowth: null, platform: null };
}

export function readConnectionV3MetricsMap(salesLinkIds) {
  const database = getDatabase();
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(`
    SELECT salesLinkId,periodStart,periodEnd,SUM(COALESCE(shippedQuantity,0)) shippedQuantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts
    WHERE salesLinkId IN (${placeholders}) GROUP BY salesLinkId,periodStart,periodEnd
    ORDER BY salesLinkId,periodEnd DESC,periodStart DESC
  `).all(...ids);
  const periodsByLink = new Map();
  for (const row of rows) { const periods = periodsByLink.get(row.salesLinkId) ?? []; if (periods.length < 2) periods.push({ ...row, profitMargin: Number(row.salesAmount) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null }); periodsByLink.set(row.salesLinkId, periods); }
  const platformRows = database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId IN (${placeholders}) ORDER BY salesLinkId,periodEnd DESC,periodStart DESC,createdAt DESC`).all(...ids);
  const platformByLink = new Map(); for (const row of platformRows) if (!platformByLink.has(row.salesLinkId)) platformByLink.set(row.salesLinkId, row);
  return new Map(ids.map((id) => { const [current, previous] = periodsByLink.get(id) ?? []; return [id, { current: current ?? emptyMetrics().current, previous: previous ?? null, salesGrowth: growth(current, previous, "salesAmount"), profitGrowth: growth(current, previous, "profitAmount"), platform: platformByLink.get(id) ?? null }]; }));
}
