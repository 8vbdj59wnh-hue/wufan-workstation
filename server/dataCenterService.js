import { getDatabase } from "./db.js";

export const dataCenterRules = Object.freeze({
  trendMinimumDays: 7,
  trendWindowDays: 14,
  trendChangeThreshold: 0.10,
  suspectedSlowMovingDays: 30,
  longTermSlowMovingDays: 60,
  lowSales30dThreshold: 5,
  capitalInventoryField: "actualStock",
  capitalCostField: "unitCost",
});

function officialSnapshots(database) {
  return database.prepare(`
    SELECT * FROM erp_fact_snapshots
    WHERE status='completed' AND isCurrent=1
    ORDER BY businessDate ASC
  `).all();
}

function normalizePage(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentChange(first, last) {
  if (first === null || last === null) return null;
  if (first === 0) return last === 0 ? 0 : null;
  return (last - first) / Math.abs(first);
}

function linearSlope(values) {
  const points = values.map((value, index) => ({ x: index, y: value })).filter((point) => point.y !== null);
  if (points.length < 2) return 0;
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  return denominator === 0 ? 0 : points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator;
}

function directionRuns(values) {
  let current = 0;
  let previousDirection = 0;
  let changes = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === null || values[index - 1] === null) continue;
    const direction = Math.sign(values[index] - values[index - 1]);
    if (direction === 0) continue;
    if (previousDirection !== 0 && direction !== previousDirection) changes += 1;
    current = direction === previousDirection ? current + 1 : 1;
    previousDirection = direction;
  }
  return { direction: previousDirection, consecutiveDays: current, directionChanges: changes };
}

function trendForSeries(series) {
  const valid = series.filter((item) => item.sales30d !== null);
  const latest = valid.at(-1) ?? null;
  const first = valid[0] ?? null;
  const values = valid.map((item) => item.sales30d);
  const changeRate = first && latest ? percentChange(first.sales30d, latest.sales30d) : null;
  const slope = linearSlope(values);
  const runs = directionRuns(values);
  if (valid.length < dataCenterRules.trendMinimumDays) {
    const delta = first && latest ? latest.sales30d - first.sales30d : null;
    return {
      status: "insufficient",
      strength: "数据不足",
      reason: valid.length >= 2
        ? `当前仅有${valid.length}个有效业务日，较前一阶段${delta > 0 ? "上涨" : delta < 0 ? "下降" : "基本持平"}，尚不能判断趋势。`
        : "有效历史数据不足，不能判断趋势。",
      changeRate,
      slope,
      ...runs,
    };
  }
  const threshold = dataCenterRules.trendChangeThreshold;
  const conflict = changeRate !== null && Math.sign(changeRate) !== 0 && Math.sign(changeRate) !== Math.sign(slope);
  const volatile = conflict || runs.directionChanges >= Math.ceil((valid.length - 1) / 2);
  if (!volatile && changeRate >= threshold && slope > 0) {
    return {
      status: "up",
      strength: changeRate >= 0.30 ? "明显上涨" : "温和上涨",
      reason: `窗口sales30d由${first.sales30d}升至${latest.sales30d}，变化率${(changeRate * 100).toFixed(1)}%，线性斜率为正。`,
      changeRate, slope, ...runs,
    };
  }
  if (!volatile && changeRate <= -threshold && slope < 0) {
    return {
      status: "down",
      strength: changeRate <= -0.30 ? "明显下滑" : "温和下滑",
      reason: `窗口sales30d由${first.sales30d}降至${latest.sales30d}，变化率${(changeRate * 100).toFixed(1)}%，线性斜率为负。`,
      changeRate, slope, ...runs,
    };
  }
  return {
    status: volatile ? "volatile" : "stable",
    strength: volatile ? "波动" : "稳定",
    reason: volatile
      ? "窗口内方向反复或首尾变化与线性方向冲突，不归入上涨或下滑。"
      : `窗口变化率为${changeRate === null ? "无法计算" : `${(changeRate * 100).toFixed(1)}%`}，未达到±10%趋势阈值。`,
    changeRate, slope, ...runs,
  };
}

function loadHistory(database, snapshots, limit = 0) {
  const selected = limit > 0 ? snapshots.slice(-limit) : snapshots;
  if (!selected.length) return { selected, byProduct: new Map() };
  const placeholders = selected.map(() => "?").join(",");
  const rows = database.prepare(`
    SELECT p.*,x.version,x.isCurrent
    FROM product_daily_snapshots p
    JOIN erp_fact_snapshots x ON x.id=p.snapshotId
    WHERE p.snapshotId IN (${placeholders})
    ORDER BY p.productId,p.businessDate
  `).all(...selected.map((snapshot) => snapshot.id));
  const byProduct = new Map();
  for (const row of rows) {
    const history = byProduct.get(row.productId) ?? [];
    history.push(row);
    byProduct.set(row.productId, history);
  }
  return { selected, byProduct };
}

function productImages(database) {
  return new Map(database.prepare("SELECT id,mainImage FROM products").all().map((row) => [row.id, row.mainImage]));
}

function paginate(items, options) {
  const page = normalizePage(options.page, 1);
  const pageSize = Math.min(100, normalizePage(options.pageSize, 48));
  const start = (page - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), pagination: { page, pageSize, total: items.length, pages: Math.max(1, Math.ceil(items.length / pageSize)) } };
}

function matchesSearch(row, search) {
  const query = String(search ?? "").trim().toLowerCase();
  return !query || `${row.productName} ${row.skuCode}`.toLowerCase().includes(query);
}

export function getDataCenterSummary() {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const latest = snapshots.at(-1) ?? null;
  return {
    latestBusinessDate: latest?.businessDate ?? null,
    availableBusinessDays: snapshots.length,
    firstBusinessDate: snapshots[0]?.businessDate ?? null,
    latestSnapshotId: latest?.id ?? null,
    latestSnapshotVersion: latest?.version ?? null,
    maturity: {
      trends: snapshots.length >= dataCenterRules.trendMinimumDays,
      slowMoving: snapshots.length >= dataCenterRules.suspectedSlowMovingDays,
      capital: Boolean(latest),
    },
    rules: dataCenterRules,
  };
}

export function getTrendProducts(options = {}) {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const { selected, byProduct } = loadHistory(database, snapshots, dataCenterRules.trendWindowDays);
  const images = productImages(database);
  const direction = String(options.direction ?? "");
  let items = [...byProduct.entries()].map(([productId, history]) => {
    const latest = history.at(-1);
    const first = history.find((item) => item.sales30d !== null) ?? history[0];
    const trend = trendForSeries(history);
    return {
      productId, productName: latest.productName, skuCode: latest.skuCode, image: images.get(productId) ?? null,
      status: trend.status, strength: trend.strength, reason: trend.reason,
      windowStartValue: first.sales30d, currentSales30d: latest.sales30d,
      changeAmount: first.sales30d === null || latest.sales30d === null ? null : latest.sales30d - first.sales30d,
      changeRate: trend.changeRate, slope: trend.slope, consecutiveDays: trend.consecutiveDays,
      currentStock: latest.totalStock, platformCount: latest.platformCount, shopCount: latest.shopCount,
      salesLinkCount: latest.salesLinkCount, startDate: history[0].businessDate, endDate: latest.businessDate,
      availableDays: history.filter((item) => item.sales30d !== null).length,
    };
  }).filter((row) => matchesSearch(row, options.search));
  const counts = Object.fromEntries(["up", "down", "stable", "volatile", "insufficient"].map((status) => [status, items.filter((item) => item.status === status).length]));
  if (direction === "focus") items = items.filter((row) => row.status === "up" || row.status === "down");
  else if (direction) items = items.filter((row) => row.status === direction);
  const order = { up: 0, down: 1, stable: 2, volatile: 3, insufficient: 4 };
  if (options.sort === "stock") items.sort((left, right) => (right.currentStock ?? -1) - (left.currentStock ?? -1));
  else if (options.sort === "sales") items.sort((left, right) => (right.currentSales30d ?? -1) - (left.currentSales30d ?? -1));
  else items.sort((left, right) => (order[left.status] - order[right.status]) || Math.abs(right.changeRate ?? 0) - Math.abs(left.changeRate ?? 0));
  return { latestBusinessDate: selected.at(-1)?.businessDate ?? null, availableBusinessDays: snapshots.length, counts, ...paginate(items, options) };
}

export function getSlowMovingProducts(options = {}) {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const { byProduct } = loadHistory(database, snapshots);
  const images = productImages(database);
  const latestSnapshot = snapshots.at(-1);
  const capitalByProduct = latestSnapshot
    ? new Map(buildCapitalRows(database, latestSnapshot).rows.map((row) => [row.productId, row.amount]))
    : new Map();
  const availableDays = snapshots.length;
  let rows = [...byProduct.entries()].map(([productId, history]) => {
    const latest = history.at(-1);
    const valid = history.filter((item) => item.sales30d !== null);
    const lowDays = [...valid].reverse().findIndex((item) => item.sales30d > dataCenterRules.lowSales30dThreshold);
    const continuousLowDays = lowDays === -1 ? valid.length : lowDays;
    let status = "observing";
    if (latest.totalStock !== null && latest.totalStock > 0 && latest.sales30d !== null && latest.sales30d <= dataCenterRules.lowSales30dThreshold) {
      if (valid.length >= dataCenterRules.longTermSlowMovingDays && continuousLowDays >= dataCenterRules.longTermSlowMovingDays) status = "long_term";
      else if (valid.length >= dataCenterRules.suspectedSlowMovingDays && continuousLowDays >= dataCenterRules.suspectedSlowMovingDays) status = "suspected";
    }
    if (latest.totalStock === null || latest.sales30d === null) status = "invalid";
    const reason = status === "long_term"
      ? `连续${continuousLowDays}个有效业务日sales30d不高于${dataCenterRules.lowSales30dThreshold}，且当前库存为${latest.totalStock}。`
      : status === "suspected"
        ? `连续${continuousLowDays}个有效业务日处于低销量区间，且当前仍有库存。`
        : availableDays < dataCenterRules.suspectedSlowMovingDays
          ? `当前仅有${availableDays}个业务日，长期滞销至少需要30个业务日。`
          : "未满足正式滞销条件。";
    return {
      productId, productName: latest.productName, skuCode: latest.skuCode, image: images.get(productId) ?? null,
      status, currentStock: latest.totalStock, currentSales30d: latest.sales30d,
      continuousLowDays, firstObservedAt: history[0].businessDate, endDate: latest.businessDate,
      currentCapitalAmount: capitalByProduct.get(productId) ?? null, reason,
    };
  }).filter((row) =>
    row.currentStock !== 0
    && (row.currentSales30d === null || row.currentSales30d <= dataCenterRules.lowSales30dThreshold)
    && matchesSearch(row, options.search),
  );
  if (options.status) rows = rows.filter((row) => row.status === options.status);
  const rank = { long_term: 0, suspected: 1, observing: 2, invalid: 3 };
  if (options.sort === "days") rows.sort((left, right) => right.continuousLowDays - left.continuousLowDays || (right.currentStock ?? -1) - (left.currentStock ?? -1));
  else if (options.sort === "capital") rows.sort((left, right) => (right.currentCapitalAmount ?? -1) - (left.currentCapitalAmount ?? -1));
  else rows.sort((left, right) => rank[left.status] - rank[right.status] || (right.currentStock ?? -1) - (left.currentStock ?? -1));
  return { latestBusinessDate: snapshots.at(-1)?.businessDate ?? null, availableBusinessDays: availableDays, ...paginate(rows, options) };
}

function buildCapitalRows(database, latest) {
  const products = database.prepare("SELECT * FROM product_daily_snapshots WHERE snapshotId=?").all(latest.id);
  const mappings = database.prepare("SELECT * FROM product_erp_daily_snapshots WHERE snapshotId=?").all(latest.id);
  const images = productImages(database);
  const byProduct = new Map();
  for (const mapping of mappings) {
    const list = byProduct.get(mapping.productId) ?? [];
    list.push(mapping);
    byProduct.set(mapping.productId, list);
  }
  const rows = products.map((product) => {
    const specs = byProduct.get(product.productId) ?? [];
    const complete = specs.length > 0 && specs.every((spec) => spec.unitCost !== null && spec.actualStock !== null);
    const amount = complete ? specs.reduce((sum, spec) => sum + Number(spec.actualStock) * Number(spec.unitCost), 0) : null;
    const costs = specs.map((spec) => spec.unitCost).filter((value) => value !== null).map(Number);
    return {
      productId: product.productId, productName: product.productName, skuCode: product.skuCode,
      image: images.get(product.productId) ?? null, currentStock: product.totalStock,
      actualStock: specs.length && specs.every((spec) => spec.actualStock !== null) ? specs.reduce((sum, spec) => sum + Number(spec.actualStock), 0) : null,
      minUnitCost: costs.length ? Math.min(...costs) : null, maxUnitCost: costs.length ? Math.max(...costs) : null,
      amount, currentSales30d: product.sales30d, complete,
      reason: complete ? `按${specs.length}个ERP规格的实际库存×单位成本逐项汇总。` : "ERP规格缺少单位成本或实际库存，未估算资金金额。",
    };
  });
  rows.sort((left, right) => (right.amount ?? -1) - (left.amount ?? -1));
  const totalAmount = rows.filter((row) => row.amount !== null).reduce((sum, row) => sum + row.amount, 0);
  const rankedRows = rows.map((row, index) => ({ ...row, rank: row.amount === null ? null : index + 1, share: row.amount === null || totalAmount === 0 ? null : row.amount / totalAmount }));
  const top20Amount = rankedRows.slice(0, 20).reduce((sum, row) => sum + (row.amount ?? 0), 0);
  return {
    rows: rankedRows,
    summary: {
      totalAmount,
      completeProducts: rankedRows.filter((row) => row.complete).length,
      missingCostProducts: rankedRows.filter((row) => !row.complete).length,
      highestAmount: rankedRows.find((row) => row.amount !== null)?.amount ?? null,
      top20Share: totalAmount ? top20Amount / totalAmount : null,
    },
  };
}

export function getCapitalOccupationProducts(options = {}) {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const latest = snapshots.at(-1);
  if (!latest) return { latestBusinessDate: null, summary: { totalAmount: null, completeProducts: 0, missingCostProducts: 0, top20Share: null }, rows: [], pagination: { page: 1, pageSize: 48, total: 0, pages: 1 } };
  const capital = buildCapitalRows(database, latest);
  const rows = capital.rows.filter((row) => matchesSearch(row, options.search));
  if (options.sort === "sales") rows.sort((left, right) => (right.currentSales30d ?? -1) - (left.currentSales30d ?? -1));
  else if (options.sort === "stock") rows.sort((left, right) => (right.actualStock ?? -1) - (left.actualStock ?? -1));
  return {
    latestBusinessDate: latest.businessDate,
    summary: capital.summary,
    ...paginate(rows, options),
  };
}

export function getDataCenterProductDetail(productId, source = "trends") {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const { byProduct } = loadHistory(database, snapshots);
  const history = byProduct.get(productId) ?? [];
  if (!history.length) return null;
  const trend = trendForSeries(history.slice(-dataCenterRules.trendWindowDays));
  const latestSnapshot = snapshots.at(-1);
  const capital = latestSnapshot
    ? buildCapitalRows(database, latestSnapshot).rows.find((row) => row.productId === productId) ?? null
    : null;
  const placeholders = snapshots.map(() => "?").join(",");
  const capitalFacts = snapshots.length
    ? database.prepare(`
      SELECT * FROM product_erp_daily_snapshots
      WHERE productId=? AND snapshotId IN (${placeholders})
      ORDER BY businessDate
    `).all(productId, ...snapshots.map((snapshot) => snapshot.id))
    : [];
  const capitalByDate = new Map();
  for (const fact of capitalFacts) {
    const facts = capitalByDate.get(fact.businessDate) ?? [];
    facts.push(fact);
    capitalByDate.set(fact.businessDate, facts);
  }
  const capitalHistory = history.map((item) => {
    const facts = capitalByDate.get(item.businessDate) ?? [];
    const complete = facts.length > 0 && facts.every((fact) => fact.actualStock !== null && fact.unitCost !== null);
    return {
      businessDate: item.businessDate,
      amount: complete ? facts.reduce((sum, fact) => sum + Number(fact.actualStock) * Number(fact.unitCost), 0) : null,
      complete,
    };
  });
  const slow = source === "slow-moving"
    ? getSlowMovingProducts({ search: history.at(-1).skuCode, page: 1, pageSize: 100 }).rows.find((row) => row.productId === productId) ?? null
    : null;
  return {
    productId,
    source,
    current: history.at(-1),
    history: history.map((item) => ({
      businessDate: item.businessDate, snapshotId: item.snapshotId, version: item.version,
      sales30d: item.sales30d, sales7d: item.sales7d, totalStock: item.totalStock,
      platformCount: item.platformCount, shopCount: item.shopCount, salesLinkCount: item.salesLinkCount,
    })),
    judgment: source === "capital" ? capital?.reason : source === "slow-moving" ? slow?.reason : trend.reason,
    capital,
    capitalHistory,
    dataSource: {
      latestBusinessDate: history.at(-1).businessDate,
      firstBusinessDate: history[0].businessDate,
      snapshotVersions: history.map((item) => ({ businessDate: item.businessDate, snapshotId: item.snapshotId, version: item.version })),
      missingFields: capital?.complete ? [] : ["unitCost或actualStock"],
    },
  };
}
