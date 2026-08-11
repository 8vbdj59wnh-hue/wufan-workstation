import { getDatabase } from "../db.js";

const SOURCE = "daily_fact_v1";
const DIMENSIONS = new Set(["company", "salesLink", "salesLinkSku", "erpSku", "product"]);
const clean = (value) => String(value ?? "").trim();

function validDate(value) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}

function normalizeInput(input = {}) {
  const dimension = clean(input.dimension);
  const targetId = clean(input.targetId);
  const startDate = validDate(input.startDate);
  const endDate = validDate(input.endDate);
  if (!DIMENSIONS.has(dimension)) throw new Error("销售日报查询维度无效。");
  if (dimension !== "company" && !targetId) throw new Error("targetId不能为空。");
  if (!startDate || !endDate || startDate > endDate) throw new Error("销售日报查询日期范围无效。");
  return { dimension, targetId, startDate, endDate };
}

function dateList(startDate, endDate) {
  const dates = [];
  for (let value = new Date(`${startDate}T00:00:00Z`), end = new Date(`${endDate}T00:00:00Z`); value <= end; value.setUTCDate(value.getUTCDate() + 1)) dates.push(value.toISOString().slice(0, 10));
  return dates;
}

function queryDefinition(dimension) {
  if (dimension === "company") return { joins: "", predicate: "1=1", params: () => [] };
  if (dimension === "salesLink") return { joins: "", predicate: "f.salesLinkId=?", params: (targetId) => [targetId] };
  if (dimension === "salesLinkSku") return { joins: "", predicate: "f.salesLinkSkuId=?", params: (targetId) => [targetId] };
  if (dimension === "erpSku") return { joins: "", predicate: "f.erpSkuId=?", params: (targetId) => [targetId] };
  return {
    joins: "JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active' JOIN products p ON p.id=pem.productId",
    predicate: "p.id=?",
    params: (targetId) => [targetId],
  };
}

function rankingDefinition(dimension) {
  if (dimension === "product") return {
    identity: "pem.productId", name: "p.name", code: "p.skuCode",
    joins: "JOIN product_erp_mappings pem ON pem.erpSkuId=f.erpSkuId AND pem.currentState='active' JOIN products p ON p.id=pem.productId",
  };
  if (dimension === "salesLink") return {
    identity: "f.salesLinkId", name: "COALESCE(NULLIF(l.title,''),l.platformGoodsId,'未命名链接')", code: "l.platformGoodsId",
    joins: "JOIN sales_links l ON l.id=f.salesLinkId",
  };
  throw new Error("销售日报排行仅支持product或salesLink维度。");
}

function statusFor(rows, startDate, endDate) {
  const dataDates = [...new Set(rows.map((row) => row.date || row.saleDate).filter(Boolean))].sort();
  const requestedDays = dateList(startDate, endDate).length;
  return {
    hasData: rows.length > 0,
    dataStart: dataDates[0] || null,
    dataEnd: dataDates.at(-1) || null,
    source: SOURCE,
    coverage: { requestedDays, dataDays: dataDates.length, ratio: requestedDays ? dataDates.length / requestedDays : null },
  };
}

function metricValue(row, field) {
  return row ? Number(row[field] || 0) : null;
}

export function queryDailySalesSummary(input = {}, options = {}) {
  const request = normalizeInput(input); const database = options.database || getDatabase(); const definition = queryDefinition(request.dimension);
  const row = database.prepare(`SELECT COUNT(*) dataCount,MIN(f.saleDate) dataStart,MAX(f.saleDate) dataEnd,
      SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount,
      COUNT(DISTINCT f.saleDate) dataDays
    FROM connection_sku_sales_daily_facts f ${definition.joins}
    WHERE ${definition.predicate} AND f.saleDate BETWEEN ? AND ?`).get(...definition.params(request.targetId), request.startDate, request.endDate);
  const hasData = Number(row?.dataCount || 0) > 0; const requestedDays = dateList(request.startDate, request.endDate).length;
  const salesLinkBreakdown = input.includeSalesLinkBreakdown && request.dimension === "product" && hasData
    ? database.prepare(`SELECT f.salesLinkId,COUNT(*) dataCount,SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,
        SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount,MIN(f.saleDate) dataStart,MAX(f.saleDate) dataEnd
      FROM connection_sku_sales_daily_facts f ${definition.joins}
      WHERE ${definition.predicate} AND f.saleDate BETWEEN ? AND ?
      GROUP BY f.salesLinkId ORDER BY salesAmount DESC,f.salesLinkId`)
      .all(...definition.params(request.targetId), request.startDate, request.endDate)
      .map((item) => ({ ...item, dataCount: Number(item.dataCount || 0), quantity: metricValue(item, "quantity"), salesAmount: metricValue(item, "salesAmount"), costAmount: metricValue(item, "costAmount"), profitAmount: metricValue(item, "profitAmount") }))
    : [];
  return {
    capability: "QueryDailySalesSummary", contractVersion: "1.0", dimension: request.dimension, targetId: request.targetId,
    startDate: request.startDate, endDate: request.endDate,
    quantity: hasData ? metricValue(row, "quantity") : null,
    salesAmount: hasData ? metricValue(row, "salesAmount") : null,
    costAmount: hasData ? metricValue(row, "costAmount") : null,
    profitAmount: hasData ? metricValue(row, "profitAmount") : null,
    dataCount: Number(row?.dataCount || 0), dataSource: SOURCE,
    hasData, dataStart: row?.dataStart || null, dataEnd: row?.dataEnd || null, source: SOURCE,
    coverage: { requestedDays, dataDays: Number(row?.dataDays || 0), ratio: requestedDays ? Number(row?.dataDays || 0) / requestedDays : null },
    salesLinkBreakdown,
  };
}

export function queryDailySalesSummaryRanking(input = {}, options = {}) {
  const dimension = clean(input.dimension); const startDate = validDate(input.startDate); const endDate = validDate(input.endDate);
  const limit = Math.min(100, Math.max(1, Number(input.limit || 10)));
  if (!startDate || !endDate || startDate > endDate) throw new Error("销售日报查询日期范围无效。");
  const definition = rankingDefinition(dimension); const database = options.database || getDatabase();
  const rows = database.prepare(`SELECT ${definition.identity} targetId,${definition.name} targetName,${definition.code} targetCode,
      COUNT(*) dataCount,COUNT(DISTINCT f.saleDate) dataDays,MIN(f.saleDate) dataStart,MAX(f.saleDate) dataEnd,
      SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f ${definition.joins}
    WHERE f.saleDate BETWEEN ? AND ? GROUP BY ${definition.identity},${definition.name},${definition.code}
    ORDER BY salesAmount DESC,${definition.identity} LIMIT ?`).all(startDate, endDate, limit);
  return {
    capability: "QueryDailySalesSummary", contractVersion: "1.0", mode: "ranking", dimension, startDate, endDate,
    items: rows.map((row, index) => ({
      rank: index + 1, targetId: row.targetId, targetName: row.targetName, targetCode: row.targetCode || null,
      quantity: metricValue(row, "quantity"), salesAmount: metricValue(row, "salesAmount"), costAmount: metricValue(row, "costAmount"),
      profitAmount: metricValue(row, "profitAmount"), profitMargin: Number(row.salesAmount || 0) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null,
      dataCount: Number(row.dataCount || 0), dataDays: Number(row.dataDays || 0), dataStart: row.dataStart, dataEnd: row.dataEnd,
    })),
    hasData: rows.length > 0, source: SOURCE,
  };
}


export function queryDailySalesSummaryComparison(input = {}, options = {}) {
  const dimension = clean(input.dimension); const currentStart = validDate(input.currentStart); const currentEnd = validDate(input.currentEnd);
  const compareStart = validDate(input.compareStart); const compareEnd = validDate(input.compareEnd);
  if (!currentStart || !currentEnd || !compareStart || !compareEnd || compareStart > compareEnd || currentStart > currentEnd) throw new Error("销售日报对比日期范围无效。");
  const definition = rankingDefinition(dimension); const database = options.database || getDatabase();
  const rows = database.prepare(`SELECT ${definition.identity} targetId,${definition.name} targetName,${definition.code} targetCode,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN 1 ELSE 0 END) currentDataCount,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN 1 ELSE 0 END) compareDataCount,
      MAX(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.saleDate END) currentDataEnd,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.quantity END) currentQuantity,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.quantity END) compareQuantity,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.salesAmount END) currentSalesAmount,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.salesAmount END) compareSalesAmount,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.profitAmount END) currentProfitAmount,
      SUM(CASE WHEN f.saleDate BETWEEN ? AND ? THEN f.profitAmount END) compareProfitAmount
    FROM connection_sku_sales_daily_facts f ${definition.joins}
    WHERE f.saleDate BETWEEN ? AND ? GROUP BY ${definition.identity},${definition.name},${definition.code}
    ORDER BY ${definition.identity}`).all(
      currentStart,currentEnd,compareStart,compareEnd,currentStart,currentEnd,currentStart,currentEnd,compareStart,compareEnd,
      currentStart,currentEnd,compareStart,compareEnd,currentStart,currentEnd,compareStart,compareEnd,compareStart,currentEnd,
    );
  return { capability:"QueryDailySalesSummary",contractVersion:"1.0",mode:"comparison",dimension,currentPeriod:{startDate:currentStart,endDate:currentEnd},comparePeriod:{startDate:compareStart,endDate:compareEnd},items:rows.map((row)=>({
    targetId:row.targetId,targetName:row.targetName,targetCode:row.targetCode||null,currentDataCount:Number(row.currentDataCount||0),compareDataCount:Number(row.compareDataCount||0),currentDataEnd:row.currentDataEnd||null,
    currentQuantity:row.currentQuantity===null?null:Number(row.currentQuantity),compareQuantity:row.compareQuantity===null?null:Number(row.compareQuantity),currentSalesAmount:row.currentSalesAmount===null?null:Number(row.currentSalesAmount),compareSalesAmount:row.compareSalesAmount===null?null:Number(row.compareSalesAmount),currentProfitAmount:row.currentProfitAmount===null?null:Number(row.currentProfitAmount),compareProfitAmount:row.compareProfitAmount===null?null:Number(row.compareProfitAmount),
  })),source:SOURCE };
}

export function queryDailySalesTrend(input = {}, options = {}) {
  const request = normalizeInput(input); const database = options.database || getDatabase(); const definition = queryDefinition(request.dimension);
  const rows = database.prepare(`SELECT f.saleDate date,COUNT(*) dataCount,SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,
      SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f ${definition.joins}
    WHERE ${definition.predicate} AND f.saleDate BETWEEN ? AND ? GROUP BY f.saleDate ORDER BY f.saleDate`)
    .all(...definition.params(request.targetId), request.startDate, request.endDate);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const items = dateList(request.startDate, request.endDate).map((date) => {
    const row = byDate.get(date);
    return row ? { date, noData: false, quantity: metricValue(row, "quantity"), salesAmount: metricValue(row, "salesAmount"), costAmount: metricValue(row, "costAmount"), profitAmount: metricValue(row, "profitAmount"), dataCount: Number(row.dataCount || 0) }
      : { date, noData: true, quantity: null, salesAmount: null, costAmount: null, profitAmount: null, dataCount: 0 };
  });
  return { capability: "QueryDailySalesTrend", contractVersion: "1.0", dimension: request.dimension, targetId: request.targetId, startDate: request.startDate, endDate: request.endDate, items, ...statusFor(rows, request.startDate, request.endDate) };
}

export function queryDailySalesBySku(input = {}, options = {}) {
  const salesLinkId = clean(input.salesLinkId); const startDate = validDate(input.startDate); const endDate = validDate(input.endDate);
  if (!salesLinkId) throw new Error("salesLinkId不能为空。");
  if (!startDate || !endDate || startDate > endDate) throw new Error("销售日报查询日期范围无效。");
  const database = options.database || getDatabase();
  const rows = database.prepare(`SELECT f.salesLinkSkuId,f.erpSkuId,COUNT(*) dataCount,MIN(f.saleDate) dataStart,MAX(f.saleDate) dataEnd,
      COUNT(DISTINCT f.saleDate) dataDays,SUM(f.quantity) quantity,SUM(f.salesAmount) salesAmount,SUM(f.costAmount) costAmount,SUM(f.profitAmount) profitAmount
    FROM connection_sku_sales_daily_facts f WHERE f.salesLinkId=? AND f.saleDate BETWEEN ? AND ?
    GROUP BY f.salesLinkSkuId,f.erpSkuId ORDER BY f.salesLinkSkuId,f.erpSkuId`).all(salesLinkId, startDate, endDate);
  const dataDates = database.prepare("SELECT DISTINCT saleDate date FROM connection_sku_sales_daily_facts WHERE salesLinkId=? AND saleDate BETWEEN ? AND ? ORDER BY saleDate").all(salesLinkId, startDate, endDate);
  const groups = new Map();
  for (const row of rows) {
    const item = groups.get(row.salesLinkSkuId) || { salesLinkSkuId: row.salesLinkSkuId, erpSkuIds: [], quantity: 0, salesAmount: 0, costAmount: 0, profitAmount: 0, dataCount: 0, dataStart: null, dataEnd: null };
    item.erpSkuIds.push(row.erpSkuId); item.quantity += Number(row.quantity || 0); item.salesAmount += Number(row.salesAmount || 0);
    item.costAmount += Number(row.costAmount || 0); item.profitAmount += Number(row.profitAmount || 0); item.dataCount += Number(row.dataCount || 0);
    item.dataStart = !item.dataStart || row.dataStart < item.dataStart ? row.dataStart : item.dataStart;
    item.dataEnd = !item.dataEnd || row.dataEnd > item.dataEnd ? row.dataEnd : item.dataEnd; groups.set(row.salesLinkSkuId, item);
  }
  const items = [...groups.values()].map((item) => ({ ...item, erpSkuIds: [...new Set(item.erpSkuIds)].sort(), noData: false }));
  return { capability: "QueryDailySalesBySku", contractVersion: "1.0", salesLinkId, startDate, endDate, items, ...statusFor(dataDates, startDate, endDate) };
}

export function explainDailySalesQuery(input = {}, options = {}) {
  const request = normalizeInput(input); const database = options.database || getDatabase(); const definition = queryDefinition(request.dimension);
  return database.prepare(`EXPLAIN QUERY PLAN SELECT SUM(f.salesAmount) FROM connection_sku_sales_daily_facts f ${definition.joins}
    WHERE ${definition.predicate} AND f.saleDate BETWEEN ? AND ?`).all(...definition.params(request.targetId), request.startDate, request.endDate);
}

export default queryDailySalesSummary;
