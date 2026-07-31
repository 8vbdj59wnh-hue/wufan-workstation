import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { getDatabase, uploadsDir } from "./db.js";
import { generateErpFactSnapshot, readErpFactSnapshot } from "./erpFactSnapshots.js";
import { reconcileErpSyncRun } from "./erpReconciliation.js";

const stagingRoot = path.join(uploadsDir, "product-v2-imports");
const goodsInfoRequiredHeaders = ["货品编号", "商家编码", "货品名称"];
const inventoryRequiredHeaders = ["货品编号", "商家编码"];
const platformRequiredHeaders = ["店铺", "货品ID", "规格ID", "平台规格编码"];

function value(raw) {
  return String(raw ?? "").trim();
}

function lower(raw) {
  return value(raw).toLocaleLowerCase("zh-CN");
}

function equivalentBusinessCode(left, right) {
  const normalizedLeft = lower(left);
  const normalizedRight = lower(right);
  if (normalizedLeft === normalizedRight) return true;
  return /^\d+$/u.test(normalizedLeft)
    && /^\d+$/u.test(normalizedRight)
    && normalizedLeft.replace(/^0+(?=\d)/u, "") === normalizedRight.replace(/^0+(?=\d)/u, "");
}

function numberValue(raw) {
  const parsed = Number(value(raw).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function id(prefix, source) {
  return `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
}

function parseWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames.find((name) => workbook.Sheets[name]?.["!ref"]) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表。");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
  if (matrix.length < 2) throw new Error("Excel 中没有可导入的数据。");
  const headers = matrix[0].map(value);
  const records = matrix.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    record: Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""])),
  }));
  return { sheetName, headers, records };
}

function stagingPath(batchId) {
  return path.join(stagingRoot, `${batchId}.json`);
}

function writeStaging(batchId, staging) {
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.writeFileSync(stagingPath(batchId), JSON.stringify(staging));
}

function readStaging(batchId) {
  const filePath = stagingPath(batchId);
  if (!fs.existsSync(filePath)) throw new Error("导入暂存数据不存在，请重新上传。");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readBatch(batchId) {
  return getDatabase().prepare("SELECT * FROM erp_import_batches WHERE id = ?").get(batchId) ?? null;
}

function decodeBatch(row) {
  if (!row) return null;
  let summaryJson = {};
  try { summaryJson = JSON.parse(row.summaryJson || "{}"); } catch {}
  return { ...row, summaryJson };
}

function saveBatch(batch) {
  getDatabase().prepare(`
    INSERT INTO erp_import_batches (
      id, importType, syncRunId, businessDate, originalFilename, fileHash, status, totalRows, createdCount, updatedCount,
      unchangedCount, matchedCount, unmatchedCount, errorCount, summaryJson, createdBy, createdAt, completedAt
    ) VALUES (
      @id, @importType, @syncRunId, @businessDate, @originalFilename, @fileHash, @status, @totalRows, @createdCount, @updatedCount,
      @unchangedCount, @matchedCount, @unmatchedCount, @errorCount, @summaryJson, @createdBy, @createdAt, @completedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      syncRunId=excluded.syncRunId, businessDate=excluded.businessDate,
      status=excluded.status, totalRows=excluded.totalRows, createdCount=excluded.createdCount,
      updatedCount=excluded.updatedCount, unchangedCount=excluded.unchangedCount,
      matchedCount=excluded.matchedCount, unmatchedCount=excluded.unmatchedCount,
      errorCount=excluded.errorCount, summaryJson=excluded.summaryJson, completedAt=excluded.completedAt
  `).run({
    syncRunId: null,
    businessDate: null,
    ...batch,
    summaryJson: JSON.stringify(batch.summaryJson ?? {}),
  });
  return decodeBatch(readBatch(batch.id));
}

const syncRunBatchColumns = {
  goods_info: "goodsInfoBatchId",
  inventory: "inventoryBatchId",
  platform_goods: "platformGoodsBatchId",
};

const syncTypeImportTypes = {
  master_data: ["goods_info"],
  daily_business: ["inventory", "platform_goods"],
  legacy_combined: ["goods_info", "inventory", "platform_goods"],
};

function normalizeSyncType(raw, { allowLegacy = true } = {}) {
  const syncType = value(raw) || (allowLegacy ? "legacy_combined" : "");
  if (!Object.hasOwn(syncTypeImportTypes, syncType) || (!allowLegacy && syncType === "legacy_combined")) {
    throw new Error("同步类型必须为 master_data 或 daily_business。");
  }
  return syncType;
}

function requiredImportTypes(syncType) {
  return syncTypeImportTypes[normalizeSyncType(syncType)] ?? [];
}

function assertSyncImportType(syncType, importType) {
  const normalizedSyncType = normalizeSyncType(syncType);
  if (!requiredImportTypes(normalizedSyncType).includes(importType)) {
    throw new Error(`同步类型 ${normalizedSyncType} 不允许导入 ${importType}。`);
  }
}

function normalizeBusinessDate(raw) {
  const businessDate = value(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) throw new Error("业务日期格式必须为 YYYY-MM-DD。");
  const parsed = new Date(`${businessDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== businessDate) {
    throw new Error("业务日期无效。");
  }
  return businessDate;
}

function decodeSyncRun(row) {
  if (!row) return null;
  let errorSummary = [];
  let reconciliationSummary = {};
  try { errorSummary = JSON.parse(row.errorSummary || "[]"); } catch {}
  try { reconciliationSummary = JSON.parse(row.reconciliationSummaryJson || "{}"); } catch {}
  return {
    ...row,
    syncType: normalizeSyncType(row.syncType),
    errorSummary,
    reconciliationSummary,
  };
}

function getSyncRunRow(syncRunId) {
  return getDatabase().prepare("SELECT * FROM erp_sync_runs WHERE id=?").get(syncRunId) ?? null;
}

function getSyncRunBatches(run) {
  return Object.fromEntries(Object.entries(syncRunBatchColumns).map(([importType, column]) => [
    importType,
    run?.[column] ? decodeBatch(readBatch(run[column])) : null,
  ]));
}

function recalculateSyncRunInTransaction(syncRunId, referenceAt = new Date().toISOString()) {
  const database = getDatabase();
  const row = getSyncRunRow(syncRunId);
  if (!row) throw new Error("ERP同步批次不存在。");
  if (row.status === "completed") return decodeSyncRun(row);
  const batches = getSyncRunBatches(row);
  const syncType = normalizeSyncType(row.syncType);
  const expectedTypes = requiredImportTypes(syncType);
  const expectedBatches = expectedTypes.map((importType) => batches[importType]);
  const current = expectedBatches.filter(Boolean);
  const success = (batch) => ["completed", "committed"].includes(batch?.status);
  const allCompleted = expectedBatches.every((batch) =>
    success(batch)
    && batch.syncRunId === row.id
    && batch.businessDate === row.businessDate
    && Number(batch.errorCount ?? 0) === 0,
  );
  const productsExist = database.prepare("SELECT COUNT(*) AS total FROM products").get().total > 0;
  let status = "draft";
  if (allCompleted && (syncType === "master_data" || productsExist)) status = "completed";
  else if (syncType === "master_data") {
    if (current.some((batch) => batch.status === "failed")) status = "failed";
    else if (current.length > 0) status = "processing";
  } else if (current.some(success) || current.some((batch) => batch.status === "failed")) status = "partial";
  else if (current.length > 0) status = "syncing";
  const errors = current
    .filter((batch) => batch.status === "failed" || Number(batch.errorCount ?? 0) > 0)
    .map((batch) => ({
      importType: batch.importType,
      batchId: batch.id,
      reason: batch.summaryJson?.failure?.message
        || (Number(batch.errorCount ?? 0) > 0 ? `存在 ${batch.errorCount} 条阻断错误` : "子批次导入失败"),
      failedAt: batch.summaryJson?.failure?.failedAt ?? batch.completedAt ?? referenceAt,
    }));
  database.prepare(`
    UPDATE erp_sync_runs
    SET status=@status,
        startedAt=CASE WHEN @hasBatch=1 THEN COALESCE(startedAt,@referenceAt) ELSE startedAt END,
        completedAt=CASE WHEN @status='completed' THEN @referenceAt ELSE NULL END,
        failedAt=CASE WHEN @status='failed' THEN @referenceAt ELSE NULL END,
        errorSummary=@errorSummary,
        updatedAt=@referenceAt
    WHERE id=@id
  `).run({
    id: row.id,
    status,
    hasBatch: current.length > 0 ? 1 : 0,
    errorSummary: JSON.stringify(errors),
    referenceAt,
  });
  return decodeSyncRun(getSyncRunRow(row.id));
}

export function createErpSyncRun({ businessDate: rawBusinessDate, syncType: rawSyncType, createdBy = "" } = {}) {
  const database = getDatabase();
  const businessDate = normalizeBusinessDate(rawBusinessDate);
  const syncType = normalizeSyncType(rawSyncType, { allowLegacy: false });
  return database.transaction(() => {
    const active = database.prepare(`
      SELECT * FROM erp_sync_runs
      WHERE businessDate=? AND syncType=? AND status IN ('draft','processing','syncing','partial')
      ORDER BY version DESC LIMIT 1
    `).get(businessDate, syncType);
    if (active) {
      const error = new Error(`该业务日期已有未完成同步：${active.syncCode}`);
      error.code = "ERP_SYNC_ACTIVE_EXISTS";
      error.syncRun = decodeSyncRun(active);
      throw error;
    }
    const latest = database.prepare(`
      SELECT * FROM erp_sync_runs WHERE businessDate=? ORDER BY version DESC LIMIT 1
    `).get(businessDate);
    const latestSameType = database.prepare(`
      SELECT * FROM erp_sync_runs
      WHERE businessDate=? AND syncType=?
      ORDER BY version DESC LIMIT 1
    `).get(businessDate, syncType);
    const version = Number(latest?.version ?? 0) + 1;
    const compactDate = businessDate.replaceAll("-", "");
    const codeType = syncType === "master_data" ? "MASTER" : "DAILY";
    const syncCode = `ERP-${codeType}-${compactDate}-${String(version).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const run = {
      id: `erp-sync-${crypto.randomUUID()}`,
      syncCode,
      businessDate,
      version,
      syncType,
      status: "draft",
      goodsInfoBatchId: null,
      inventoryBatchId: null,
      platformGoodsBatchId: null,
      supersedesRunId: latestSameType?.status === "completed" ? latestSameType.id : null,
      goodsInfoExportedAt: null,
      inventoryExportedAt: null,
      platformGoodsExportedAt: null,
      createdBy: value(createdBy) || null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorSummary: "[]",
      updatedAt: now,
    };
    database.prepare(`
      INSERT INTO erp_sync_runs (
        id,syncCode,businessDate,version,syncType,status,goodsInfoBatchId,inventoryBatchId,platformGoodsBatchId,
        supersedesRunId,goodsInfoExportedAt,inventoryExportedAt,platformGoodsExportedAt,
        createdBy,createdAt,startedAt,completedAt,failedAt,errorSummary,updatedAt
      ) VALUES (
        @id,@syncCode,@businessDate,@version,@syncType,@status,@goodsInfoBatchId,@inventoryBatchId,@platformGoodsBatchId,
        @supersedesRunId,@goodsInfoExportedAt,@inventoryExportedAt,@platformGoodsExportedAt,
        @createdBy,@createdAt,@startedAt,@completedAt,@failedAt,@errorSummary,@updatedAt
      )
    `).run(run);
    return decodeSyncRun(getSyncRunRow(run.id));
  }).immediate();
}

export function attachErpImportBatchToSyncRun(syncRunId, batchId) {
  const database = getDatabase();
  return database.transaction(() => {
    const run = decodeSyncRun(getSyncRunRow(syncRunId));
    if (!run) throw new Error("ERP同步批次不存在。");
    if (run.status === "completed") throw new Error("已完成同步不可修改，请创建同日重新同步版本。");
    const batch = decodeBatch(readBatch(batchId));
    if (!batch) throw new Error("ERP导入子批次不存在。");
    const column = syncRunBatchColumns[batch.importType];
    if (!column) throw new Error("ERP导入类型无效。");
    assertSyncImportType(run.syncType, batch.importType);
    if (batch.syncRunId && batch.syncRunId !== run.id) throw new Error("该子批次已属于其他ERP同步。");
    const previousBatchId = run[column];
    const previousBatch = previousBatchId ? decodeBatch(readBatch(previousBatchId)) : null;
    if (previousBatch && ["completed", "committed"].includes(previousBatch.status)) {
      throw new Error("该表已完成导入，重新导入请创建同日重新同步版本。");
    }
    database.prepare(`
      UPDATE erp_import_batches SET syncRunId=?,businessDate=? WHERE id=?
    `).run(run.id, run.businessDate, batch.id);
    database.prepare(`UPDATE erp_sync_runs SET ${column}=?,updatedAt=? WHERE id=?`)
      .run(batch.id, new Date().toISOString(), run.id);
    return {
      run: recalculateSyncRunInTransaction(run.id),
      replacedBatchId: previousBatchId && previousBatchId !== batch.id ? previousBatchId : null,
    };
  }).immediate();
}

export function recalculateErpSyncRun(syncRunId) {
  let run = getDatabase().transaction(() => recalculateSyncRunInTransaction(syncRunId)).immediate();
  if (run.status === "completed" && run.reconciliationStatus !== "completed") {
    try {
      reconcileErpSyncRun(run.id);
    } catch (error) {
      console.error(`ERP同步 ${run.syncCode} 缺失记录对账失败`, error);
      return decodeSyncRun(getSyncRunRow(syncRunId));
    }
    run = decodeSyncRun(getSyncRunRow(syncRunId));
  }
  if (
    run.status === "completed"
    && run.syncType !== "master_data"
    && run.reconciliationStatus === "completed"
    && run.snapshotStatus !== "completed"
  ) {
    try {
      generateErpFactSnapshot(run.id);
    } catch (error) {
      console.error(`ERP同步 ${run.syncCode} 历史快照生成失败`, error);
    }
  }
  return decodeSyncRun(getSyncRunRow(syncRunId));
}

export function readErpSyncRun(syncRunId) {
  const run = decodeSyncRun(getSyncRunRow(syncRunId));
  if (!run) return null;
  return {
    ...run,
    batches: getSyncRunBatches(run),
    snapshot: run.snapshotId ? readErpFactSnapshot(run.snapshotId) : null,
  };
}

export function listErpSyncRuns({ businessDate = "", includeHistorical = true } = {}) {
  const params = [];
  const where = value(businessDate) ? "WHERE businessDate=?" : "";
  if (where) params.push(normalizeBusinessDate(businessDate));
  const rows = getDatabase().prepare(`
    SELECT * FROM erp_sync_runs ${where}
    ORDER BY businessDate DESC,version DESC,createdAt DESC
    ${includeHistorical ? "" : "LIMIT 20"}
  `).all(...params);
  return rows.map((row) => readErpSyncRun(row.id));
}

export function suggestShopPlatform(rawName) {
  const raw = value(rawName);
  if (raw === "无效" || raw === "总计:" || raw === "") return { platform: "", shopName: "", status: "ignored", reliable: false };
  const rules = [
    ["视频号小店", /视频号/],
    ["小红书", /小红书/],
    ["天猫", /天猫/],
    ["淘宝", /淘宝/],
    ["京东", /京东/],
    ["抖店", /抖店|抖音/],
  ];
  const matched = rules.filter(([, pattern]) => pattern.test(raw));
  if (matched.length !== 1) return { platform: "", shopName: raw, status: "pending", reliable: false };
  const platform = matched[0][0];
  const shopName = raw
    .replace(/-(天猫|淘宝C店|淘宝|京东|抖店|视频号小店)(-公司)?$/u, "")
    .replace(/^小红书/u, "")
    .trim();
  return { platform, shopName: shopName || raw, status: "suggested", reliable: true };
}

export function canonicalizeSalesUrl(rawUrl) {
  const raw = value(rawUrl);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const identityParams = ["id", "item_id", "goods_id", "product_id"];
    const kept = new URLSearchParams();
    for (const key of identityParams) {
      if (url.searchParams.has(key)) kept.set(key, url.searchParams.get(key));
    }
    url.protocol = "https:";
    url.hash = "";
    url.search = kept.toString();
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.split("#")[0].trim();
  }
}

function inventoryValidation(staging) {
  const database = getDatabase();
  const products = new Map(database.prepare("SELECT id, skuCode, name, mainImage FROM products").all().map((item) => [lower(item.skuCode), item]));
  const goodsSeen = new Set();
  const rows = [];
  let invalidRows = 0;
  let matched = 0;
  let unmatched = 0;
  for (const item of staging.records) {
    const record = item.record;
    const merchantSkuCode = value(record["商家编码"]);
    const goodsCode = value(record["货品编号"]);
    if (!merchantSkuCode && !goodsCode) continue;
    if (merchantSkuCode === "总计:" || goodsCode === "总计:") continue;
    const errors = [];
    if (!merchantSkuCode) errors.push("商家编码为空");
    if (!goodsCode) errors.push("货品编号为空");
    const product = products.get(lower(merchantSkuCode)) ?? null;
    if (!product && merchantSkuCode) errors.push("未找到系统产品");
    if (errors.length) invalidRows += 1;
    if (product) matched += 1;
    else unmatched += 1;
    const isNewGoods = Boolean(goodsCode) && !goodsSeen.has(lower(goodsCode))
      && !database.prepare("SELECT 1 FROM erp_goods WHERE lower(goodsCode)=lower(?)").get(goodsCode);
    goodsSeen.add(lower(goodsCode));
    rows.push({
      rowNumber: item.rowNumber,
      goodsCode,
      merchantSkuCode,
      erpName: value(record["货品名称"]),
      systemProduct: product,
      status: product && !errors.length ? "matched" : "error",
      newGoods: isNewGoods,
      updateFields: [
        "规格名称", "图片链接", "材质", "风格", "摆放位置", "条码", "单位",
        "成本价", "零售价", "库存", "可发库存", "可用库存", "7天销量", "30天销量", "90天销量", "180天销量", "总销量",
      ].filter((field) => value(record[field]) !== ""),
      errors,
    });
  }
  return {
    valid: rows.some((row) => row.status === "matched"),
    rows,
    summary: {
      total: rows.length,
      goods: goodsSeen.size,
      matched,
      unmatched,
      error: invalidRows,
      filtered: staging.records.length - rows.length,
    },
  };
}

function goodsInfoFields(record, existing = {}) {
  return {
    goodsName: value(record["货品名称"]) || existing.goodsName || null,
    shortName: value(record["简称"]) || value(record["货品简称"]) || existing.shortName || null,
    brand: value(record["品牌"]) || existing.brand || null,
    category: value(record["分类"]) || existing.category || null,
    productType: value(record["品类"]) || existing.productType || null,
    primarySupplier: value(record["主供应商"]) || existing.primarySupplier || null,
    supplierGoodsCode: value(record["主供应商货号"]) || existing.supplierGoodsCode || null,
    sourceCreatedAt: value(record["创建时间"]) || value(record["单品创建时间"]) || existing.sourceCreatedAt || null,
  };
}

function goodsInfoValidation(staging) {
  const database = getDatabase();
  const canonicalGoodsFields = new Map();
  for (const { record } of staging.records) {
    const goodsKey = lower(record["货品编号"]);
    if (!goodsKey || value(record["货品编号"]) === "总计:") continue;
    const current = canonicalGoodsFields.get(goodsKey) ?? {};
    const candidate = goodsInfoFields(record);
    canonicalGoodsFields.set(goodsKey, Object.fromEntries(
      Object.keys(candidate).map((key) => [key, current[key] ?? candidate[key] ?? null]),
    ));
  }
  const productsBySku = new Map();
  for (const product of database.prepare("SELECT id, skuCode, name FROM products").all()) {
    const key = lower(product.skuCode);
    const matches = productsBySku.get(key) ?? [];
    matches.push(product);
    productsBySku.set(key, matches);
  }
  const goodsByCode = new Map(database.prepare("SELECT * FROM erp_goods").all().map((item) => [lower(item.goodsCode), item]));
  const mappingsBySku = new Map(database.prepare(`
    SELECT m.*, g.goodsCode
    FROM product_erp_mappings m
    JOIN erp_goods g ON g.id=m.erpGoodsId
  `).all().map((item) => [lower(item.merchantSkuCode), item]));
  const seenSkuGoods = new Map();
  const goodsActions = new Map();
  const rows = [];
  const summary = {
    total: 0,
    validGoods: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    existingMappings: 0,
    autoMappings: 0,
    pendingMappings: 0,
    invalid: 0,
    error: 0,
  };
  for (const item of staging.records) {
    const record = item.record;
    const goodsCode = value(record["货品编号"]);
    const merchantSkuCode = value(record["商家编码"]);
    const goodsName = value(record["货品名称"]);
    if (!goodsCode && !merchantSkuCode && !goodsName) continue;
    if (goodsCode === "总计:" || merchantSkuCode === "总计:") continue;
    const errors = [];
    if (!goodsCode) errors.push("ERP货品编码为空");
    if (!merchantSkuCode) errors.push("商家编码为空");
    if (!goodsName) errors.push("货品名称为空");
    const skuKey = lower(merchantSkuCode);
    const goodsKey = lower(goodsCode);
    if (skuKey && seenSkuGoods.has(skuKey) && seenSkuGoods.get(skuKey) !== goodsKey) {
      errors.push(`同一商家编码对应多个货品编号：${seenSkuGoods.get(skuKey)}、${goodsCode}`);
    }
    if (skuKey) seenSkuGoods.set(skuKey, goodsKey);
    const existingMapping = mappingsBySku.get(skuKey) ?? null;
    if (existingMapping && !equivalentBusinessCode(existingMapping.goodsCode, goodsCode)) {
      errors.push(`现有映射指向货品 ${existingMapping.goodsCode}，与本行 ${goodsCode} 冲突`);
    }
    const productMatches = productsBySku.get(skuKey) ?? [];
    if (!existingMapping && productMatches.length > 1) errors.push("商家编码匹配到多个系统产品");
    const product = existingMapping
      ? productMatches.find((candidate) => candidate.id === existingMapping.productId) ?? null
      : productMatches.length === 1 ? productMatches[0] : null;
    const existingGoods = goodsByCode.get(goodsKey)
      ?? (existingMapping && equivalentBusinessCode(existingMapping.goodsCode, goodsCode)
        ? database.prepare("SELECT * FROM erp_goods WHERE id=?").get(existingMapping.erpGoodsId)
        : null);
    const nextFields = Object.fromEntries(
      Object.entries(canonicalGoodsFields.get(goodsKey) ?? goodsInfoFields(record))
        .map(([key, nextValue]) => [key, nextValue ?? existingGoods?.[key] ?? null]),
    );
    let goodsAction = "new";
    if (existingGoods) {
      goodsAction = lower(existingGoods.goodsCode) !== goodsKey
        || Object.entries(nextFields).some(([key, nextValue]) => (existingGoods[key] ?? null) !== nextValue)
        ? "update"
        : "unchanged";
    }
    if (goodsKey && !goodsActions.has(goodsKey)) goodsActions.set(goodsKey, goodsAction);
    const mappingAction = errors.length
      ? "error"
      : existingMapping
        ? "existing"
        : product
          ? "auto"
          : "pending";
    rows.push({
      rowNumber: item.rowNumber,
      goodsCode,
      merchantSkuCode,
      goodsName,
      specificationName: value(record["规格名称"]),
      category: value(record["分类"]),
      systemProduct: product,
      existingGoodsId: existingGoods?.id ?? null,
      goodsFields: nextFields,
      goodsAction,
      mappingAction,
      status: errors.length ? "error" : "valid",
      errors,
    });
  }
  summary.total = rows.length;
  summary.validGoods = goodsActions.size;
  summary.created = [...goodsActions.values()].filter((item) => item === "new").length;
  summary.updated = [...goodsActions.values()].filter((item) => item === "update").length;
  summary.unchanged = [...goodsActions.values()].filter((item) => item === "unchanged").length;
  summary.existingMappings = rows.filter((row) => row.mappingAction === "existing").length;
  summary.autoMappings = rows.filter((row) => row.mappingAction === "auto").length;
  summary.pendingMappings = rows.filter((row) => row.mappingAction === "pending").length;
  summary.invalid = rows.filter((row) => row.errors.length > 0).length;
  summary.error = rows.reduce((total, row) => total + row.errors.length, 0);
  return { valid: rows.length > 0 && summary.error === 0, rows, summary };
}

function normalizeShopMappings(staging, submitted = {}) {
  const counts = new Map();
  for (const { record } of staging.records) {
    const rawName = value(record["店铺"]);
    if (!rawName) continue;
    const current = counts.get(rawName) ?? { rows: 0, links: new Set() };
    current.rows += 1;
    current.links.add(value(record["货品ID"]) || canonicalizeSalesUrl(record["平台商品链接"]));
    counts.set(rawName, current);
  }
  const database = getDatabase();
  return [...counts.entries()].map(([rawName, count]) => {
    const alias = database.prepare(`
      SELECT a.shopId, s.platform, s.shopName, s.displayName, s.status
      FROM sales_shop_aliases a JOIN sales_shops s ON s.id=a.shopId
      WHERE lower(a.rawName)=lower(?)
    `).get(rawName);
    const user = submitted[rawName] ?? null;
    const suggestion = suggestShopPlatform(rawName);
    if (alias) return { rawName, ...alias, mappingStatus: "confirmed", rows: count.rows, links: count.links.size };
    if (user?.action === "ignore") return { rawName, platform: "", shopName: "", mappingStatus: "ignored", rows: count.rows, links: count.links.size };
    if (user?.shopId) {
      const selectedShop = database.prepare("SELECT id AS shopId, platform, shopName, displayName, status FROM sales_shops WHERE id=?").get(user.shopId);
      if (selectedShop) return { rawName, ...selectedShop, mappingStatus: "confirmed", rows: count.rows, links: count.links.size };
    }
    if (user?.platform && user?.shopName) {
      return {
        rawName, platform: value(user.platform), shopName: value(user.shopName),
        displayName: value(user.displayName) || value(user.shopName), mappingStatus: "confirmed",
        rows: count.rows, links: count.links.size,
      };
    }
    return { rawName, ...suggestion, mappingStatus: suggestion.reliable ? "suggested" : "pending", rows: count.rows, links: count.links.size };
  });
}

function findPlatformProduct(record) {
  const database = getDatabase();
  const platformSkuCode = value(record["平台规格编码"]);
  const platformGoodsCode = value(record["平台货品编号"]);
  const systemGoodsType = value(record["系统货品"]);
  if (systemGoodsType === "组合装") return { product: null, status: "combination", method: null, reason: "组合装不自动绑定" };
  const exact = platformSkuCode
    ? database.prepare("SELECT id, skuCode, name FROM products WHERE lower(skuCode)=lower(?)").get(platformSkuCode)
    : null;
  if (exact) return { product: exact, status: "matched_auto", method: "sku_code", reason: "平台规格编码精确匹配" };
  if (platformGoodsCode) {
    const candidates = database.prepare(`
      SELECT p.id, p.skuCode, p.name
      FROM erp_goods g
      JOIN product_erp_mappings m ON m.erpGoodsId=g.id
      JOIN products p ON p.id=m.productId
      WHERE lower(g.goodsCode)=lower(?)
    `).all(platformGoodsCode);
    if (candidates.length === 1) return { product: candidates[0], status: "matched_auto", method: "goods_single_sku", reason: "货品下仅一个系统规格" };
    if (candidates.length > 1) return { product: null, status: "ambiguous", method: null, reason: `货品下有${candidates.length}个规格` };
  }
  return { product: null, status: "unmatched", method: null, reason: "编码无法匹配现有产品" };
}

function platformValidation(staging, submittedMappings = {}) {
  const database = getDatabase();
  const shopMappings = normalizeShopMappings(staging, submittedMappings);
  const mappingByRaw = new Map(shopMappings.map((item) => [item.rawName, item]));
  const rows = [];
  const links = new Set();
  const summary = {
    total: 0, shops: shopMappings.length, links: 0, matchedAuto: 0, matchedManual: 0,
    unmatched: 0, ambiguous: 0, combination: 0, ignored: 0, error: 0,
    created: 0, updated: 0, unchanged: 0,
  };
  for (const item of staging.records) {
    const record = item.record;
    const rawShopName = value(record["店铺"]);
    if (!rawShopName || rawShopName === "总计:") continue;
    const mapping = mappingByRaw.get(rawShopName);
    if (mapping?.mappingStatus === "ignored") {
      summary.ignored += 1;
      continue;
    }
    const errors = [];
    if (!mapping || mapping.mappingStatus !== "confirmed") errors.push("店铺映射尚未确认");
    const platformGoodsId = value(record["货品ID"]);
    const canonicalUrl = canonicalizeSalesUrl(record["平台商品链接"]);
    if (!platformGoodsId && !canonicalUrl) errors.push("货品ID和商品链接均为空");
    const match = findPlatformProduct(record);
    const linkIdentity = `${rawShopName}|${platformGoodsId || canonicalUrl}`;
    links.add(linkIdentity);
    summary.total += 1;
    if (errors.length) summary.error += 1;
    else if (match.status === "matched_auto") summary.matchedAuto += 1;
    else summary[match.status] = (summary[match.status] ?? 0) + 1;
    rows.push({
      rowNumber: item.rowNumber,
      rawShopName,
      shopMapping: mapping,
      platformGoodsId,
      platformGoodsCode: value(record["平台货品编号"]),
      title: value(record["货品名称"]),
      canonicalUrl,
      rawUrl: value(record["平台商品链接"]),
      platformSkuId: value(record["规格ID"]),
      platformSkuCode: value(record["平台规格编码"]),
      specificationName: value(record["规格名称"]),
      systemGoodsType: value(record["系统货品"]),
      matchStatus: match.status,
      matchMethod: match.method,
      matchReason: match.reason,
      product: match.product,
      errors,
    });
  }
  summary.links = links.size;
  const classifiedLinks = new Set();
  for (const row of rows.filter((item) => item.errors.length === 0)) {
    const identity = `${row.rawShopName}|${row.platformGoodsId || row.canonicalUrl}`;
    if (classifiedLinks.has(identity)) continue;
    classifiedLinks.add(identity);
    const mapping = row.shopMapping;
    const normalizedShopName = lower(mapping?.shopName);
    const shop = mapping?.shopId
      ? database.prepare("SELECT id FROM sales_shops WHERE id=?").get(mapping.shopId)
      : mapping?.platform && normalizedShopName
        ? database.prepare("SELECT id FROM sales_shops WHERE platform=? AND normalizedShopName=?").get(mapping.platform, normalizedShopName)
        : null;
    const existingLink = shop
      ? row.platformGoodsId
        ? database.prepare("SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, row.platformGoodsId)
        : database.prepare("SELECT id FROM sales_links WHERE shopId=? AND canonicalUrl=?").get(shop.id, row.canonicalUrl)
      : null;
    if (existingLink) summary.updated += 1;
    else summary.created += 1;
  }
  return { valid: rows.some((row) => row.errors.length === 0), rows, shopMappings, summary };
}

function buildPlatformPreview(rows, { platform = "", shop = "", status = "", query = "", page = 1, pageSize = 30 } = {}) {
  const normalizedQuery = lower(query);
  const groups = new Map();
  for (const row of rows) {
    const rowPlatform = value(row.shopMapping?.platform);
    const rowShop = value(row.shopMapping?.displayName || row.shopMapping?.shopName || row.rawShopName);
    if (platform && rowPlatform !== platform) continue;
    if (shop && row.rawShopName !== shop && rowShop !== shop) continue;
    if (status && row.matchStatus !== status) continue;
    if (
      normalizedQuery
      && !lower(`${row.title} ${row.platformGoodsId} ${row.platformGoodsCode} ${row.platformSkuCode} ${row.platformSkuId}`).includes(normalizedQuery)
    ) continue;
    const key = `${row.rawShopName}|${row.platformGoodsId || row.canonicalUrl}`;
    const group = groups.get(key) ?? {
      key,
      platform: rowPlatform,
      rawShopName: row.rawShopName,
      shopName: rowShop,
      platformGoodsId: row.platformGoodsId,
      platformGoodsCode: row.platformGoodsCode,
      title: row.title,
      rawUrl: row.rawUrl,
      canonicalUrl: row.canonicalUrl,
      skuCount: 0,
      matchCounts: {},
      skus: [],
    };
    group.skuCount += 1;
    group.matchCounts[row.matchStatus] = (group.matchCounts[row.matchStatus] ?? 0) + 1;
    if (group.skus.length < 50) group.skus.push(row);
    groups.set(key, group);
  }
  const allGroups = [...groups.values()];
  const safePageSize = Math.min(50, Math.max(10, Number(pageSize) || 30));
  const totalPages = Math.max(1, Math.ceil(allGroups.length / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  return {
    links: allGroups.slice((safePage - 1) * safePageSize, safePage * safePageSize),
    pagination: { page: safePage, pageSize: safePageSize, totalLinks: allGroups.length, totalPages },
  };
}

export function parseErpV2Import({ filePath, originalFilename, importType, syncRunId, createdBy }) {
  if (!["goods_info", "inventory", "platform_goods"].includes(importType)) throw new Error("导入类型无效。");
  const syncRun = readErpSyncRun(syncRunId);
  if (!syncRun) throw new Error("请先创建或恢复ERP每日同步批次。");
  assertSyncImportType(syncRun.syncType, importType);
  if (syncRun.status === "completed") throw new Error("该ERP每日同步已完成，请创建同日重新同步版本。");
  const currentBatch = syncRun.batches?.[importType];
  if (currentBatch && ["completed", "committed"].includes(currentBatch.status)) {
    throw new Error("该表已完成导入，重新导入请创建同日重新同步版本。");
  }
  const fileBuffer = fs.readFileSync(filePath);
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const existing = decodeBatch(getDatabase().prepare(`
    SELECT * FROM erp_import_batches
    WHERE importType=? AND fileHash=? AND status IN ('committed','completed')
    ORDER BY createdAt DESC LIMIT 1
  `).get(importType, fileHash));
  const parsed = parseWorkbook(filePath);
  const required = importType === "goods_info"
    ? goodsInfoRequiredHeaders
    : importType === "inventory"
      ? inventoryRequiredHeaders
      : platformRequiredHeaders;
  const missing = required.filter((header) => !parsed.headers.includes(header));
  if (missing.length) throw new Error(`文件缺少必要字段：${missing.join("、")}`);
  const now = new Date().toISOString();
  const batchId = `erp-v2-${importType}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const staging = { ...parsed, importType, fileHash, originalFilename, parsedAt: now };
  writeStaging(batchId, staging);
  const validation = importType === "goods_info"
    ? goodsInfoValidation(staging)
    : importType === "inventory"
      ? inventoryValidation(staging)
      : platformValidation(staging, {});
  const batch = saveBatch({
    id: batchId, importType, syncRunId: syncRun.id, businessDate: syncRun.businessDate,
    originalFilename, fileHash, status: "parsed", totalRows: validation.summary.total,
    createdCount: 0, updatedCount: 0, unchangedCount: 0, matchedCount: validation.summary.matched ?? validation.summary.matchedAuto ?? 0,
    unmatchedCount: validation.summary.unmatched ?? 0, errorCount: validation.summary.error ?? 0,
    summaryJson: { ...validation.summary, duplicateCommittedBatchId: existing?.id ?? null },
    createdBy, createdAt: now, completedAt: null,
  });
  const attachment = attachErpImportBatchToSyncRun(syncRun.id, batch.id);
  return {
    batch,
    syncRun: readErpSyncRun(attachment.run.id),
    duplicate: existing,
    valid: validation.valid,
    summary: validation.summary,
    shopMappings: validation.shopMappings ?? [],
    preview: importType === "platform_goods" ? [] : validation.rows.slice(0, 200),
    previewLinks: [],
    pagination: null,
  };
}

export function validateErpV2Import(batchId, { shopMappings = {}, previewFilters = {}, page = 1, pageSize = 30 } = {}) {
  const batch = decodeBatch(readBatch(batchId));
  if (!batch) throw new Error("导入批次不存在。");
  const staging = readStaging(batchId);
  const validation = batch.importType === "goods_info"
    ? goodsInfoValidation(staging)
    : batch.importType === "inventory"
      ? inventoryValidation(staging)
      : platformValidation(staging, shopMappings);
  const nextBatch = saveBatch({
    ...batch,
    status: validation.valid && (batch.importType !== "platform_goods" || validation.shopMappings.every((item) => ["confirmed", "ignored"].includes(item.mappingStatus)))
      ? "validated" : "parsed",
    matchedCount: validation.summary.matched ?? validation.summary.matchedAuto ?? 0,
    unmatchedCount: validation.summary.unmatched ?? 0,
    errorCount: validation.summary.error ?? 0,
    summaryJson: { ...validation.summary, shopMappings: validation.shopMappings ?? [] },
  });
  const platformPreview = batch.importType === "platform_goods"
    ? buildPlatformPreview(validation.rows, { ...previewFilters, page, pageSize })
    : { links: [], pagination: null };
  const syncRun = nextBatch.syncRunId ? recalculateErpSyncRun(nextBatch.syncRunId) : null;
  return {
    ...validation,
    batch: nextBatch,
    valid: nextBatch.status === "validated",
    rows: undefined,
    preview: batch.importType === "platform_goods" ? [] : validation.rows.slice(0, 500),
    previewLinks: platformPreview.links,
    pagination: platformPreview.pagination,
    syncRun: syncRun ? readErpSyncRun(syncRun.id) : null,
  };
}

export function previewErpV2Import(batchId, { previewFilters = {}, page = 1, pageSize = 30 } = {}) {
  const batch = decodeBatch(readBatch(batchId));
  if (!batch) throw new Error("导入批次不存在。");
  if (batch.importType !== "platform_goods") throw new Error("该批次不是平台货品导入。");
  if (!["validated", "importing", "completed", "committed"].includes(batch.status)) {
    throw new Error("当前批次尚未完成后台校验，请返回店铺确认并重新校验。");
  }
  const staging = readStaging(batchId);
  const savedShopMappings = Object.fromEntries((batch.summaryJson?.shopMappings ?? []).map((mapping) => [
    mapping.rawName,
    mapping.mappingStatus === "ignored"
      ? { action: "ignore" }
      : mapping.shopId
        ? { shopId: mapping.shopId }
        : { platform: mapping.platform, shopName: mapping.shopName, displayName: mapping.displayName },
  ]));
  const validation = platformValidation(staging, savedShopMappings);
  if (validation.shopMappings.some((item) => !["confirmed", "ignored"].includes(item.mappingStatus))) {
    throw new Error("店铺映射尚未全部确认或忽略，请返回店铺确认。");
  }
  const platformPreview = buildPlatformPreview(validation.rows, { ...previewFilters, page, pageSize });
  return {
    batch,
    valid: true,
    summary: validation.summary,
    shopMappings: validation.shopMappings,
    previewLinks: platformPreview.links,
    pagination: platformPreview.pagination,
  };
}

export function readErpV2Import(batchId) {
  const batch = decodeBatch(readBatch(batchId));
  if (!batch) throw new Error("导入批次不存在。");
  const staging = readStaging(batchId);
  const savedShopMappings = Object.fromEntries((batch.summaryJson?.shopMappings ?? []).map((mapping) => [
    mapping.rawName,
    mapping.mappingStatus === "ignored"
      ? { action: "ignore" }
      : mapping.shopId
        ? { shopId: mapping.shopId }
        : { platform: mapping.platform, shopName: mapping.shopName, displayName: mapping.displayName },
  ]));
  const validation = batch.importType === "goods_info"
    ? goodsInfoValidation(staging)
    : batch.importType === "inventory"
      ? inventoryValidation(staging)
      : platformValidation(staging, savedShopMappings);
  return {
    batch,
    syncRun: batch.syncRunId ? readErpSyncRun(batch.syncRunId) : null,
    valid: ["validated", "importing", "completed", "committed"].includes(batch.status),
    summary: validation.summary,
    shopMappings: validation.shopMappings ?? [],
    preview: batch.importType === "platform_goods" ? [] : validation.rows.slice(0, 200),
    previewLinks: [],
    pagination: null,
  };
}

function commitInventory(batch, staging) {
  const database = getDatabase();
  const validation = inventoryValidation(staging);
  const now = new Date().toISOString();
  const stats = { created: 0, updated: 0, unchanged: 0, matched: 0, unmatched: 0, errors: validation.summary.error };
  const transaction = database.transaction(() => {
    const goodsByCode = new Map();
    const countedGoods = new Set();
    for (const row of validation.rows) {
      const record = staging.records.find((item) => item.rowNumber === row.rowNumber)?.record ?? {};
      if (!row.goodsCode) continue;
      const generatedGoodsId = id("erp-goods", lower(row.goodsCode));
      let goods = goodsByCode.get(lower(row.goodsCode))
        ?? database.prepare("SELECT * FROM erp_goods WHERE lower(goodsCode)=lower(?) OR id=?").get(row.goodsCode, generatedGoodsId);
      const nextGoods = {
        id: goods?.id ?? generatedGoodsId,
        goodsCode: goods?.goodsCode ?? row.goodsCode,
        goodsName: value(record["货品名称"]) || goods?.goodsName || null,
        shortName: value(record["货品简称"]) || goods?.shortName || null,
        brand: value(record["品牌"]) || goods?.brand || null,
        category: value(record["分类"]) || goods?.category || null,
        productType: value(record["品类"]) || goods?.productType || null,
        primarySupplier: value(record["主供应商"]) || goods?.primarySupplier || null,
        supplierGoodsCode: value(record["主供应商货号"]) || goods?.supplierGoodsCode || null,
        sourceCreatedAt: value(record["单品创建时间"]) || goods?.sourceCreatedAt || null,
        lastImportedAt: now,
        createdAt: goods?.createdAt ?? now,
        updatedAt: now,
      };
      database.prepare(`
        INSERT INTO erp_goods (
          id,goodsCode,goodsName,shortName,brand,category,productType,primarySupplier,supplierGoodsCode,
          sourceCreatedAt,lastImportedAt,createdAt,updatedAt
        ) VALUES (
          @id,@goodsCode,@goodsName,@shortName,@brand,@category,@productType,@primarySupplier,@supplierGoodsCode,
          @sourceCreatedAt,@lastImportedAt,@createdAt,@updatedAt
        )
        ON CONFLICT(goodsCode) DO UPDATE SET goodsName=excluded.goodsName,shortName=excluded.shortName,brand=excluded.brand,
          category=excluded.category,productType=excluded.productType,primarySupplier=excluded.primarySupplier,
          supplierGoodsCode=excluded.supplierGoodsCode,sourceCreatedAt=excluded.sourceCreatedAt,lastImportedAt=excluded.lastImportedAt,updatedAt=excluded.updatedAt
      `).run(nextGoods);
      if (!countedGoods.has(lower(row.goodsCode))) {
        if (!goods) stats.created += 1;
        else stats.updated += 1;
        countedGoods.add(lower(row.goodsCode));
      }
      goods = nextGoods;
      goodsByCode.set(lower(row.goodsCode), goods);
      if (!row.systemProduct) {
        stats.unmatched += 1;
        continue;
      }
      const latestState = {
        costPrice: numberValue(record["成本价"]), retailPrice: numberValue(record["零售价"]),
        stock: numberValue(record["库存"]), shippableStock: numberValue(record["可发库存"]),
        availableStock: numberValue(record["可用库存"]), actualStock: numberValue(record["实际库存"]),
        actualShippableStock: numberValue(record["实际可发库存"]), purchaseInTransit: numberValue(record["采购在途"]),
        pendingShipment: numberValue(record["待发货量"]), sales7d: numberValue(record["7天销量"]),
        sales30d: numberValue(record["30天销量"]), sales90d: numberValue(record["90天销量"]),
        sales180d: numberValue(record["180天销量"]), totalSales: numberValue(record["总销量"]),
        lastStocktakeAt: value(record["最后盘点时间"]) || null,
      };
      const mappingId = id("product-erp-map", row.systemProduct.id);
      database.prepare(`
        INSERT INTO product_erp_mappings (
          id,productId,erpGoodsId,merchantSkuCode,matchMethod,sourceBatchId,latestStateJson,
          lastSeenInventoryBatchId,inventoryCurrentState,inventoryMissingAt,createdAt,updatedAt
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(productId) DO UPDATE SET erpGoodsId=excluded.erpGoodsId,merchantSkuCode=excluded.merchantSkuCode,
          matchMethod=excluded.matchMethod,latestStateJson=excluded.latestStateJson,
          lastSeenInventoryBatchId=excluded.lastSeenInventoryBatchId,inventoryCurrentState='active',
          inventoryMissingAt=NULL,updatedAt=excluded.updatedAt
      `).run(
        mappingId, row.systemProduct.id, goods.id, row.merchantSkuCode, "sku_code", null, JSON.stringify(latestState),
        batch.id, "active", null, now, now,
      );
      stats.matched += 1;
    }
  });
  transaction();
  return stats;
}

function commitGoodsInfo(batch, staging) {
  const database = getDatabase();
  const validation = goodsInfoValidation(staging);
  if (!validation.valid) throw new Error("货品信息存在编码缺失或冲突，请返回预览处理后重试。");
  const now = new Date().toISOString();
  const stats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    matched: 0,
    existingMappings: 0,
    autoMappings: 0,
    pendingMappings: 0,
    errors: 0,
  };
  database.transaction(() => {
    const countedGoods = new Set();
    for (const row of validation.rows) {
      const record = staging.records.find((item) => item.rowNumber === row.rowNumber)?.record ?? {};
      const goodsKey = lower(row.goodsCode);
      let goods = database.prepare("SELECT * FROM erp_goods WHERE lower(goodsCode)=lower(?)").get(row.goodsCode)
        ?? (row.existingGoodsId ? database.prepare("SELECT * FROM erp_goods WHERE id=?").get(row.existingGoodsId) : null);
      if (!countedGoods.has(goodsKey)) {
        const nextGoods = {
          id: goods?.id ?? id("erp-goods", goodsKey),
          goodsCode: row.goodsCode,
          ...row.goodsFields,
          lastImportedAt: now,
          lastSeenBatchId: batch.id,
          currentState: "active",
          missingAt: null,
          createdAt: goods?.createdAt ?? now,
          updatedAt: now,
        };
        if (goods) {
          database.prepare(`
            UPDATE erp_goods SET goodsCode=@goodsCode,goodsName=@goodsName,shortName=@shortName,brand=@brand,
              category=@category,productType=@productType,primarySupplier=@primarySupplier,
              supplierGoodsCode=@supplierGoodsCode,sourceCreatedAt=@sourceCreatedAt,lastImportedAt=@lastImportedAt,
              lastSeenBatchId=@lastSeenBatchId,currentState=@currentState,missingAt=@missingAt,updatedAt=@updatedAt
            WHERE id=@id
          `).run(nextGoods);
        } else {
          database.prepare(`
            INSERT INTO erp_goods (
              id,goodsCode,goodsName,shortName,brand,category,productType,primarySupplier,supplierGoodsCode,
              sourceCreatedAt,lastImportedAt,lastSeenBatchId,currentState,missingAt,createdAt,updatedAt
            ) VALUES (
              @id,@goodsCode,@goodsName,@shortName,@brand,@category,@productType,@primarySupplier,@supplierGoodsCode,
              @sourceCreatedAt,@lastImportedAt,@lastSeenBatchId,@currentState,@missingAt,@createdAt,@updatedAt
            )
          `).run(nextGoods);
        }
        if (!goods) stats.created += 1;
        else if (row.goodsAction === "update") stats.updated += 1;
        else stats.unchanged += 1;
        countedGoods.add(goodsKey);
        goods = nextGoods;
      } else {
        goods = database.prepare("SELECT * FROM erp_goods WHERE lower(goodsCode)=lower(?)").get(row.goodsCode)
          ?? (row.existingGoodsId ? database.prepare("SELECT * FROM erp_goods WHERE id=?").get(row.existingGoodsId) : null);
      }
      const skuId = id("erp-sku", lower(row.merchantSkuCode));
      database.prepare(`
        INSERT INTO erp_skus (
          id,merchantSkuCode,erpGoodsId,specificationName,barcode,unit,erpStatus,
          firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(merchantSkuCode) DO UPDATE SET
          erpGoodsId=excluded.erpGoodsId,
          specificationName=excluded.specificationName,
          barcode=excluded.barcode,
          unit=excluded.unit,
          erpStatus=excluded.erpStatus,
          lastSeenBatchId=excluded.lastSeenBatchId,
          currentState='active',
          updatedAt=excluded.updatedAt
      `).run(
        skuId,
        row.merchantSkuCode,
        goods.id,
        row.specificationName || null,
        value(record["主条码"]) || value(record["条码"]) || null,
        value(record["基本单位"]) || value(record["单位"]) || null,
        value(record["单品状态"]) || null,
        batch.id,
        batch.id,
        "active",
        now,
        now,
      );
      if (!row.systemProduct) {
        stats.pendingMappings += 1;
        continue;
      }
      const existingMapping = database.prepare("SELECT * FROM product_erp_mappings WHERE productId=?").get(row.systemProduct.id);
      let latestState = {};
      try { latestState = JSON.parse(existingMapping?.latestStateJson || "{}"); } catch {}
      const mappingId = existingMapping?.id ?? id("product-erp-map", row.systemProduct.id);
      database.prepare(`
        INSERT INTO product_erp_mappings (
          id,productId,erpGoodsId,merchantSkuCode,specificationName,unit,barcode,erpStatus,
          matchMethod,sourceBatchId,latestStateJson,currentState,missingAt,createdAt,updatedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(productId) DO UPDATE SET
          erpGoodsId=excluded.erpGoodsId,merchantSkuCode=excluded.merchantSkuCode,
          specificationName=excluded.specificationName,unit=excluded.unit,barcode=excluded.barcode,erpStatus=excluded.erpStatus,
          matchMethod=excluded.matchMethod,sourceBatchId=excluded.sourceBatchId,
          currentState='active',missingAt=NULL,updatedAt=excluded.updatedAt
      `).run(
        mappingId,
        row.systemProduct.id,
        goods.id,
        row.merchantSkuCode,
        row.specificationName || null,
        value(record["基本单位"]) || value(record["单位"]) || null,
        value(record["主条码"]) || value(record["条码"]) || null,
        value(record["单品状态"]) || null,
        existingMapping ? existingMapping.matchMethod : "sku_code",
        batch.id,
        JSON.stringify(latestState),
        "active",
        null,
        existingMapping?.createdAt ?? now,
        now,
      );
      stats.matched += 1;
      if (existingMapping) stats.existingMappings += 1;
      else stats.autoMappings += 1;
    }
  })();
  return stats;
}

function ensureShop(mapping, now) {
  const database = getDatabase();
  let shop = mapping.shopId ? database.prepare("SELECT * FROM sales_shops WHERE id=?").get(mapping.shopId) : null;
  const normalized = lower(mapping.shopName);
  if (!shop) shop = database.prepare("SELECT * FROM sales_shops WHERE platform=? AND normalizedShopName=?").get(mapping.platform, normalized);
  if (!shop) {
    shop = {
      id: id("sales-shop", `${mapping.platform}|${normalized}`), platform: mapping.platform, shopName: mapping.shopName,
      normalizedShopName: normalized, displayName: mapping.displayName || mapping.shopName, rawShopName: mapping.rawName,
      status: "active", notes: null, createdAt: now, updatedAt: now,
    };
    database.prepare("INSERT INTO sales_shops VALUES (@id,@platform,@shopName,@normalizedShopName,@displayName,@rawShopName,@status,@notes,@createdAt,@updatedAt)").run(shop);
  }
  database.prepare("INSERT OR IGNORE INTO sales_shop_aliases (id,shopId,rawName,createdAt) VALUES (?,?,?,?)")
    .run(id("shop-alias", lower(mapping.rawName)), shop.id, mapping.rawName, now);
  return shop;
}

function commitPlatform(batch, staging, shopMappings) {
  const database = getDatabase();
  const validation = platformValidation(staging, shopMappings);
  if (validation.shopMappings.some((item) => !["confirmed", "ignored"].includes(item.mappingStatus))) throw new Error("仍有店铺映射未确认。");
  const now = new Date().toISOString();
  const stats = {
    created: 0, updated: 0, unchanged: 0, matched: 0, matchedAuto: 0, matchedManual: 0,
    unmatched: 0, ambiguous: 0, combination: 0, errors: 0, shops: 0, links: 0, skus: 0,
  };
  const mappingByRaw = new Map(validation.shopMappings.map((item) => [item.rawName, item]));
  const grouped = new Map();
  for (const row of validation.rows.filter((item) => item.errors.length === 0)) {
    const key = `${row.rawShopName}|${row.platformGoodsId || row.canonicalUrl}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const seenShops = new Set();
  for (const rows of grouped.values()) {
    const transaction = database.transaction(() => {
      const first = rows[0];
      const mapping = mappingByRaw.get(first.rawShopName);
      const shop = ensureShop(mapping, now);
      seenShops.add(shop.id);
      let link = first.platformGoodsId
        ? database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, first.platformGoodsId)
        : database.prepare("SELECT * FROM sales_links WHERE shopId=? AND (platformGoodsId IS NULL OR platformGoodsId='') AND canonicalUrl=?").get(shop.id, first.canonicalUrl);
      const linkId = link?.id ?? id("sales-link", `${shop.id}|${first.platformGoodsId || first.canonicalUrl}`);
      const linkValues = {
        id: linkId, shopId: shop.id, platformGoodsId: first.platformGoodsId || null,
        platformGoodsCode: first.platformGoodsCode || null, title: first.title || null,
        canonicalUrl: first.canonicalUrl || null, rawUrl: first.rawUrl || null,
        status: value(staging.records.find((item) => item.rowNumber === first.rowNumber)?.record["状态"]) || null,
        activityStatus: value(staging.records.find((item) => item.rowNumber === first.rowNumber)?.record["活动状态"]) || null,
        category: value(staging.records.find((item) => item.rowNumber === first.rowNumber)?.record["平台类目"]) || null,
        identityStrength: first.platformGoodsId ? "strong" : "weak",
        lastModifiedAt: value(staging.records.find((item) => item.rowNumber === first.rowNumber)?.record["最后修改时间"]) || null,
        lastSeenBatchId: batch.id, currentState: "active", missingAt: null,
        lastImportedAt: now, createdAt: link?.createdAt ?? now, updatedAt: now,
      };
      database.prepare(`
        INSERT INTO sales_links (
          id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,rawUrl,status,activityStatus,category,
          identityStrength,lastModifiedAt,lastSeenBatchId,currentState,missingAt,lastImportedAt,createdAt,updatedAt
        ) VALUES (
          @id,@shopId,@platformGoodsId,@platformGoodsCode,@title,@canonicalUrl,@rawUrl,@status,@activityStatus,@category,
          @identityStrength,@lastModifiedAt,@lastSeenBatchId,@currentState,@missingAt,@lastImportedAt,@createdAt,@updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET platformGoodsCode=excluded.platformGoodsCode,title=excluded.title,canonicalUrl=excluded.canonicalUrl,
          rawUrl=excluded.rawUrl,status=excluded.status,activityStatus=excluded.activityStatus,category=excluded.category,
          lastModifiedAt=excluded.lastModifiedAt,lastSeenBatchId=excluded.lastSeenBatchId,currentState='active',
          missingAt=NULL,lastImportedAt=excluded.lastImportedAt,updatedAt=excluded.updatedAt
      `).run(linkValues);
      if (!link) stats.created += 1;
      else stats.updated += 1;
      for (const row of rows) {
        const source = staging.records.find((item) => item.rowNumber === row.rowNumber)?.record ?? {};
        let sku = row.platformSkuId
          ? database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(linkId, row.platformSkuId)
          : database.prepare(`
              SELECT * FROM sales_link_skus WHERE salesLinkId=? AND (platformSkuId IS NULL OR platformSkuId='')
                AND normalizedPlatformSkuCode=? AND normalizedSpecificationName=?
            `).get(linkId, lower(row.platformSkuCode), lower(row.specificationName));
        const skuId = sku?.id ?? id("sales-link-sku", `${linkId}|${row.platformSkuId || `${lower(row.platformSkuCode)}|${lower(row.specificationName)}`}`);
        const manual = database.prepare("SELECT * FROM platform_sku_manual_bindings WHERE salesLinkSkuId=?").get(skuId);
        const productId = manual?.productId ?? row.product?.id ?? null;
        const matchStatus = manual ? "matched_manual" : row.matchStatus;
        const matchMethod = manual ? "manual" : row.matchMethod;
        database.prepare(`
          INSERT INTO sales_link_skus (
            id,salesLinkId,productId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,
            normalizedSpecificationName,price,platformStock,occupiedStock,systemGoodsType,syncEnabled,lastSyncedStock,
            lastSyncedAt,stopSyncReason,matchStatus,matchMethod,matchReason,lastSeenBatchId,createdAt,updatedAt,
            currentState,missingAt
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET productId=excluded.productId,platformSkuCode=excluded.platformSkuCode,
            normalizedPlatformSkuCode=excluded.normalizedPlatformSkuCode,specificationName=excluded.specificationName,
            normalizedSpecificationName=excluded.normalizedSpecificationName,price=excluded.price,platformStock=excluded.platformStock,
            occupiedStock=excluded.occupiedStock,systemGoodsType=excluded.systemGoodsType,syncEnabled=excluded.syncEnabled,
            lastSyncedStock=excluded.lastSyncedStock,lastSyncedAt=excluded.lastSyncedAt,stopSyncReason=excluded.stopSyncReason,
            matchStatus=excluded.matchStatus,matchMethod=excluded.matchMethod,matchReason=excluded.matchReason,
            lastSeenBatchId=excluded.lastSeenBatchId,currentState='active',missingAt=NULL,updatedAt=excluded.updatedAt
        `).run(
          skuId, linkId, productId, row.platformSkuId || null, row.platformSkuCode || null, lower(row.platformSkuCode),
          row.specificationName || null, lower(row.specificationName), numberValue(source["价格"]), numberValue(source["平台库存"]),
          numberValue(source["占用库存"]), row.systemGoodsType || null, value(source["是否需要同步"]) === "是" ? 1 : 0,
          numberValue(source["最后同步库存"]), value(source["最后同步时间"]) || null, value(source["停止同步原因"]) || null,
          matchStatus, matchMethod, row.matchReason, batch.id, sku?.createdAt ?? now, now, "active", null,
        );
        stats.skus += 1;
        if (matchStatus.startsWith("matched")) {
          stats.matched += 1;
          if (matchStatus === "matched_manual") stats.matchedManual += 1;
          else stats.matchedAuto += 1;
        }
        else stats[matchStatus] = (stats[matchStatus] ?? 0) + 1;
      }
      stats.links += 1;
    });
    transaction();
  }
  stats.shops = seenShops.size;
  return stats;
}

export function commitErpV2Import(batchId, { shopMappings = {} } = {}) {
  let batch = decodeBatch(readBatch(batchId));
  if (!batch) throw new Error("导入批次不存在。");
  if (["committed", "completed"].includes(batch.status)) {
    return {
      batch,
      idempotent: true,
      summary: batch.summaryJson,
      syncRun: batch.syncRunId ? readErpSyncRun(batch.syncRunId) : null,
    };
  }
  if (batch.status === "importing") throw new Error("该批次正在导入，请勿重复提交。");
  if (!["validated", "failed"].includes(batch.status)) throw new Error("请先完成导入预览与校验。");
  const staging = readStaging(batchId);
  const savedShopMappings = Object.fromEntries((batch.summaryJson?.shopMappings ?? []).map((mapping) => [
    mapping.rawName,
    mapping.mappingStatus === "ignored"
      ? { action: "ignore" }
      : mapping.shopId
        ? { shopId: mapping.shopId }
        : { platform: mapping.platform, shopName: mapping.shopName, displayName: mapping.displayName },
  ]));
  const effectiveShopMappings = Object.keys(shopMappings).length > 0 ? shopMappings : savedShopMappings;
  const importStartedAt = new Date().toISOString();
  batch = saveBatch({
    ...batch,
    status: "importing",
    completedAt: null,
    summaryJson: { ...batch.summaryJson, shopMappings: batch.summaryJson?.shopMappings ?? [], importStartedAt, failure: null },
  });
  if (batch.syncRunId) recalculateErpSyncRun(batch.syncRunId);
  try {
    const database = getDatabase();
    const stats = batch.importType === "goods_info"
      ? commitGoodsInfo(batch, staging)
      : batch.importType === "inventory"
        ? commitInventory(batch, staging)
        : database.transaction(() => commitPlatform(batch, staging, effectiveShopMappings))();
    const completedAt = new Date().toISOString();
    const nextBatch = saveBatch({
      ...batch, status: "completed", totalRows: batch.totalRows,
      createdCount: stats.created ?? 0, updatedCount: stats.updated ?? 0, unchangedCount: stats.unchanged ?? 0,
      matchedCount: stats.matched ?? 0, unmatchedCount: (stats.unmatched ?? 0) + (stats.ambiguous ?? 0) + (stats.combination ?? 0),
      errorCount: stats.errors ?? 0,
      summaryJson: { ...stats, shopMappings: batch.summaryJson?.shopMappings ?? [], importStartedAt },
      completedAt,
    });
    const syncRun = nextBatch.syncRunId ? recalculateErpSyncRun(nextBatch.syncRunId) : null;
    return {
      batch: nextBatch,
      idempotent: false,
      summary: stats,
      syncRun: syncRun ? readErpSyncRun(syncRun.id) : null,
    };
  } catch (error) {
    const failedBatch = saveBatch({
      ...batch,
      status: "failed",
      errorCount: Math.max(1, Number(batch.errorCount) || 0),
      summaryJson: {
        ...batch.summaryJson,
        importStartedAt,
        failure: { message: error.message || "平台货品导入失败。", failedAt: new Date().toISOString() },
      },
      completedAt: null,
    });
    if (failedBatch.syncRunId) recalculateErpSyncRun(failedBatch.syncRunId);
    throw error;
  }
}

export function updatePlatformSkuManualBinding(salesLinkSkuId, productId, createdBy) {
  const database = getDatabase();
  const sku = database.prepare("SELECT * FROM sales_link_skus WHERE id=?").get(salesLinkSkuId);
  if (!sku) throw new Error("平台SKU不存在。");
  const product = database.prepare("SELECT id FROM products WHERE id=?").get(productId);
  if (!product) throw new Error("系统产品不存在。");
  const now = new Date().toISOString();
  const bindingId = id("platform-sku-binding", salesLinkSkuId);
  const transaction = database.transaction(() => {
    database.prepare(`
      INSERT INTO platform_sku_manual_bindings (id,salesLinkSkuId,productId,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(salesLinkSkuId) DO UPDATE SET productId=excluded.productId,createdBy=excluded.createdBy,updatedAt=excluded.updatedAt
    `).run(bindingId, salesLinkSkuId, productId, createdBy, now, now);
    database.prepare("UPDATE sales_link_skus SET productId=?,matchStatus='matched_manual',matchMethod='manual',matchReason='人工绑定',updatedAt=? WHERE id=?")
      .run(productId, now, salesLinkSkuId);
  });
  transaction();
  return database.prepare("SELECT * FROM platform_sku_manual_bindings WHERE salesLinkSkuId=?").get(salesLinkSkuId);
}

export function removePlatformSkuManualBinding(salesLinkSkuId) {
  const database = getDatabase();
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM platform_sku_manual_bindings WHERE salesLinkSkuId=?").run(salesLinkSkuId);
    database.prepare("UPDATE sales_link_skus SET productId=NULL,matchStatus='unmatched',matchMethod=NULL,matchReason='人工绑定已取消',updatedAt=? WHERE id=?")
      .run(new Date().toISOString(), salesLinkSkuId);
  });
  transaction();
}

export function markPlatformSku(salesLinkSkuId, status) {
  if (!["combination", "ignored"].includes(status)) throw new Error("标记状态无效。");
  getDatabase().prepare("UPDATE sales_link_skus SET productId=NULL,matchStatus=?,matchMethod='manual',matchReason=?,updatedAt=? WHERE id=?")
    .run(status, status === "combination" ? "人工标记组合装" : "人工忽略", new Date().toISOString(), salesLinkSkuId);
}
