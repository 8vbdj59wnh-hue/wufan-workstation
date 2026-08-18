import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { getDatabase, uploadsDir } from "./db.js";
import { createConnectionDataMapping, ensureBusinessAdvisorConnection } from "./connectionService.js";
import { normalizeUploadedFileName } from "./uploadFileName.js";

const importStatuses = new Set(["draft", "parsed", "validated", "completed", "failed"]);
const stagingDir = path.resolve(process.env.CONNECTION_IMPORT_DIR || path.join(uploadsDir, "connection-imports"));

function text(raw) {
  const result = String(raw ?? "").trim();
  return result === "-" ? "" : result;
}

function normalizeBusinessDate(raw) {
  const value = text(raw);
  const match = value.match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function detectPeriodFromFileName(fileName) {
  const dates = [...text(fileName).matchAll(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  if (dates.length < 2) return { periodStart: null, periodEnd: null, periodType: null };
  const [periodStart, periodEnd] = dates;
  const inclusiveDays = Math.round((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000) + 1;
  return { periodStart, periodEnd, periodType: inclusiveDays === 30 ? "rolling_30d" : "custom_period" };
}

function batchFilePath(batchId) {
  return path.join(stagingDir, `${batchId}.workbook`);
}

export function parseBusinessAdvisorWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell) === "商品ID") && row.some((cell) => text(cell) === "商品名称"));
  if (headerIndex < 0) throw new Error("未找到生意参谋商品数据表头。");
  const headers = rows[headerIndex].map(text);
  const column = (name) => headers.indexOf(name);
  for (const required of ["商品ID", "主商品ID", "商品名称", "货号"]) {
    if (column(required) < 0) throw new Error(`缺少必需字段：${required}`);
  }
  const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => text(cell) !== ""));
  const parsedRows = dataRows.map((row, offset) => {
    const externalId = text(row[column("商品ID")]);
    const mainGoodsId = text(row[column("主商品ID")]);
    const goodsName = text(row[column("商品名称")]);
    const sku = text(row[column("货号")]);
    const metrics = {};
    headers.forEach((header, index) => {
      if (!header || ["商品ID", "主商品ID", "商品名称", "货号"].includes(header)) return;
      metrics[header] = row[index] ?? "";
    });
    return {
      rowNumber: headerIndex + offset + 2,
      externalId,
      mainGoodsId,
      goodsName,
      sku,
      businessDate: normalizeBusinessDate(row[column("统计日期")]),
      externalData: { goodsId: externalId, mainGoodsId, goodsName, sku, metrics },
      parseError: externalId ? "" : "商品ID为空",
    };
  });
  return { sheetName, rows: parsedRows, businessDate: parsedRows.find((row) => row.businessDate)?.businessDate || "" };
}

function connectionCandidate(row) {
  return {
    connectionId: row.connectionId ?? null,
    salesLinkId: row.salesLinkId,
    connectionName: row.connectionName || row.salesLinkTitle || row.platformGoodsCode || "未命名销售连接",
    platform: row.platform,
    shopName: row.shopDisplayName || row.shopName || "未命名店铺",
  };
}

function buildMatchIndexes(shopId = "") {
  const database = getDatabase();
  const links = database.prepare(`
    SELECT l.id AS salesLinkId,l.platformGoodsId,l.platformGoodsCode,l.title AS salesLinkTitle,
           c.id AS connectionId,c.name AS connectionName,s.platform,s.displayName AS shopDisplayName,s.shopName
    FROM sales_links l
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE COALESCE(l.currentState,'active')='active' AND (?='' OR l.shopId=?)
  `).all(text(shopId), text(shopId));
  const byGoodsId = new Map();
  for (const row of links) {
    const goodsId = text(row.platformGoodsId);
    if (goodsId) {
      const items = byGoodsId.get(goodsId) ?? [];
      items.push(row);
      byGoodsId.set(goodsId, items);
    }
  }
  return { byGoodsId };
}

function uniqueCandidates(rows) {
  return [...new Map(rows.filter(Boolean).map((row) => [row.salesLinkId, connectionCandidate(row)])).values()];
}

export function matchBusinessAdvisorRows(rows, shopId = "") {
  const indexes = buildMatchIndexes(shopId);
  return rows.map((row) => {
    if (row.parseError) return { ...row, previewStatus: "error", matchMethod: null, candidates: [] };
    const direct = uniqueCandidates(indexes.byGoodsId.get(row.externalId) ?? []);
    if (direct.length === 1) {
      return { ...row, previewStatus: "matched", matchMethod: "goods_id", resolutionAction: direct[0].connectionId ? "reuse" : "create_profile", ...direct[0], candidates: direct };
    }
    if (direct.length === 0 && text(shopId)) {
      return { ...row, previewStatus: "error", matchMethod: "goods_id", resolutionAction: "missing_sales_link",
        parseError: "未匹配到已有链接，请先通过平台货品导入建立链接身份。", candidates: [] };
    }
    const pendingReason = direct.length > 1 ? "ambiguous_goods_id" : "missing_sales_link";
    return { ...row, previewStatus: "pending", matchMethod: null, pendingReason, candidates: direct };
  });
}

function batchRow(row) {
  if (!row) throw new Error("经营数据导入批次不存在。");
  return { ...row, fileName: normalizeUploadedFileName(row.fileName) };
}

export function listConnectionImportBatches(sourceType = "business_advisor") {
  return getDatabase().prepare(`
    SELECT * FROM connection_import_batches WHERE sourceType=? ORDER BY createdAt DESC,id DESC LIMIT 30
  `).all(text(sourceType)).map(batchRow);
}

export function readConnectionImportBatch(id) {
  return batchRow(getDatabase().prepare("SELECT * FROM connection_import_batches WHERE id=?").get(text(id)));
}

export function createConnectionImportBatch({ buffer, fileName, businessDate, externalShopId, userId }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("请选择生意参谋Excel文件。");
  const shopId = text(externalShopId);
  const shop = getDatabase().prepare("SELECT id FROM sales_shops WHERE id=? AND status='active'").get(shopId);
  if (!shop) throw new Error("请选择生意参谋数据对应的平台店铺。");
  const parsed = parseBusinessAdvisorWorkbook(buffer);
  const matched = matchBusinessAdvisorRows(parsed.rows, shopId);
  const resolvedBusinessDate = normalizeBusinessDate(businessDate) || parsed.businessDate;
  if (!resolvedBusinessDate) throw new Error("无法确定业务日期，请手动填写。");
  const detectedPeriod = detectPeriodFromFileName(fileName);
  const id = `connection-import-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const stats = {
    totalRows: matched.length,
    matchedRows: matched.filter((row) => row.previewStatus === "matched").length,
    pendingRows: matched.filter((row) => row.previewStatus === "pending").length,
    errorRows: matched.filter((row) => row.previewStatus === "error").length,
  };
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(batchFilePath(id), buffer, { mode: 0o600 });
  try {
    getDatabase().prepare(`
      INSERT INTO connection_import_batches (
        id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,
        status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, "business_advisor", text(externalShopId), text(fileName) || "生意参谋商品数据.xls",
      crypto.createHash("sha256").update(buffer).digest("hex"), resolvedBusinessDate,
      detectedPeriod.periodStart, detectedPeriod.periodEnd, detectedPeriod.periodType, "validated",
      stats.totalRows, stats.matchedRows, stats.pendingRows, stats.errorRows, text(userId) || null, now, now);
  } catch (error) {
    fs.rmSync(batchFilePath(id), { force: true });
    throw error;
  }
  return { batch: readConnectionImportBatch(id), rows: matched };
}

export function previewConnectionImportBatch(id) {
  const batch = readConnectionImportBatch(id);
  if (!importStatuses.has(batch.status)) throw new Error("导入批次状态无效。");
  const filePath = batchFilePath(batch.id);
  if (!fs.existsSync(filePath)) throw new Error("导入批次原文件不存在。");
  const parsed = parseBusinessAdvisorWorkbook(fs.readFileSync(filePath));
  const mappings = getDatabase().prepare(`
    SELECT m.externalId,m.matchStatus,m.matchMethod,m.connectionId,m.salesLinkId,
           c.name AS connectionName,l.title AS salesLinkTitle
    FROM connection_data_mappings m
    LEFT JOIN connection_profiles c ON c.id=m.connectionId
    LEFT JOIN sales_links l ON l.id=m.salesLinkId
    WHERE m.sourceType=? AND m.externalShopId=? AND m.deletedAt IS NULL
  `).all(batch.sourceType, batch.externalShopId);
  const mappingsByExternalId = new Map(mappings.map((mapping) => [mapping.externalId, mapping]));
  const rows = matchBusinessAdvisorRows(parsed.rows, batch.externalShopId).map((row) => {
    const mapping = mappingsByExternalId.get(row.externalId);
    if (!mapping) return row;
    return { ...row, previewStatus: mapping.matchStatus, matchMethod: mapping.matchMethod,
      connectionId: mapping.connectionId, salesLinkId: mapping.salesLinkId,
      connectionName: mapping.connectionName || mapping.salesLinkTitle || row.connectionName };
  });
  return { batch, rows };
}

function findPreviewRow(batchId, externalId) {
  const preview = previewConnectionImportBatch(batchId);
  const row = preview.rows.find((item) => item.externalId === text(externalId));
  if (!row) throw new Error("导入数据中不存在该商品。");
  return { batch: preview.batch, row };
}

function activeMapping(sourceType, externalId, externalShopId) {
  return getDatabase().prepare(`
    SELECT id,connectionId,salesLinkId,matchStatus FROM connection_data_mappings
    WHERE sourceType=? AND externalId=? AND externalShopId=? AND deletedAt IS NULL
  `).get(sourceType, externalId, externalShopId);
}

export function confirmConnectionImportRow(batchId, externalId, _selection, userId) {
  const { batch, row } = findPreviewRow(batchId, externalId);
  if (!batch.externalShopId) throw new Error("历史批次未记录店铺，不能自动创建连接档案。");
  const relation = ensureBusinessAdvisorConnection({ importBatchId: batch.id, shopId: batch.externalShopId,
    platformGoodsId: row.externalId, title: row.goodsName }, userId);
  return createConnectionDataMapping({
    sourceType: batch.sourceType,
    externalType: "product",
    externalId: row.externalId,
    externalShopId: batch.externalShopId,
    externalData: row.externalData,
    connectionId: relation.connectionId,
    salesLinkId: relation.salesLinkId,
    matchStatus: "matched",
    matchMethod: "goods_id",
  }, userId);
}

export function ignoreConnectionImportRow(batchId, externalId, userId) {
  const { batch, row } = findPreviewRow(batchId, externalId);
  return createConnectionDataMapping({ sourceType: batch.sourceType, externalType: "product", externalId: row.externalId,
    externalShopId: batch.externalShopId, externalData: row.externalData, matchStatus: "ignored" }, userId);
}

export function commitConnectionImportBatch(id, userId) {
  const preview = previewConnectionImportBatch(id);
  if (preview.batch.status === "completed") return { batch: preview.batch, created: 0, existing: preview.batch.matchedRows };
  const database = getDatabase();
  let created = 0;
  let existing = 0;
  let profilesCreated = 0;
  let salesLinksCreated = 0;
  const commit = database.transaction(() => {
    for (const row of preview.rows.filter((item) => item.previewStatus === "matched")) {
      if (!preview.batch.externalShopId) {
        if (!row.connectionId || !row.salesLinkId) continue;
      }
      const relation = preview.batch.externalShopId
        ? ensureBusinessAdvisorConnection({ importBatchId: preview.batch.id, shopId: preview.batch.externalShopId,
          platformGoodsId: row.externalId, title: row.goodsName }, userId)
        : { connectionId: row.connectionId, salesLinkId: row.salesLinkId, profileCreated: false, salesLinkCreated: false };
      if (relation.profileCreated) profilesCreated += 1;
      if (relation.salesLinkCreated) salesLinksCreated += 1;
      const current = activeMapping(preview.batch.sourceType, row.externalId, preview.batch.externalShopId);
      if (current) {
        if (current.matchStatus === "matched" && current.salesLinkId === relation.salesLinkId) { existing += 1; continue; }
        throw new Error(`商品 ${row.externalId} 已存在不同映射，请先人工处理。`);
      }
      createConnectionDataMapping({ sourceType: preview.batch.sourceType, externalType: "product", externalId: row.externalId,
        externalShopId: preview.batch.externalShopId, externalData: row.externalData, connectionId: relation.connectionId,
        salesLinkId: relation.salesLinkId, matchStatus: "matched", matchMethod: "goods_id" }, userId);
      created += 1;
    }
    const now = new Date().toISOString();
    database.prepare("UPDATE connection_import_batches SET status='completed',updatedAt=? WHERE id=?").run(now, preview.batch.id);
  });
  commit();
  return { batch: readConnectionImportBatch(preview.batch.id), created, existing, profilesCreated, salesLinksCreated };
}
