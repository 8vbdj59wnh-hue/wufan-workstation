import crypto from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import * as XLSX from "xlsx";
import { uploadsDir } from "./db.js";

const importRoot = path.join(uploadsDir, "product-imports");
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const execFileAsync = promisify(execFile);

const field = (key, label, type, aliases) => ({ key, label, type, aliases });

export const productImportFieldDefinitions = [
  field("skuCode", "SKU编码", "text", ["商家编码", "sku", "sku编码", "skucode"]),
  field("name", "产品名称", "text", ["货品名称", "产品名称", "商品名称", "name"]),
  field("skuName", "规格名称", "text", ["规格名称", "sku名称"]),
  field("weightKg", "重量（千克）", "number", ["重量[千克]", "重量（千克）", "重量kg"]),
  field("lengthCm", "长（厘米）", "number", ["长[厘米]", "长度[厘米]", "长cm"]),
  field("widthCm", "宽（厘米）", "number", ["宽[厘米]", "宽度[厘米]", "宽cm"]),
  field("heightCm", "高（厘米）", "number", ["高[厘米]", "高度[厘米]", "高cm"]),
  field("volumeCm3", "体积（立方厘米）", "number", ["体积[立方厘米]", "体积cm3"]),
  field("category", "产品分类", "text", ["分类", "产品分类"]),
  field("brand", "品牌", "text", ["品牌"]),
  field("warehouseInfo.flow", "仓库流程", "text", ["仓库流程"]),
  field("tags", "货品标签", "list", ["货品标签", "产品标签", "标签"]),
  field("priceInfo.retail", "零售价", "number", ["零售价"]),
  field("priceInfo.wholesale", "批发价", "number", ["批发价"]),
  field("priceInfo.member", "会员价", "number", ["会员价"]),
  field("priceInfo.market", "市场价", "number", ["市场价"]),
  field("priceInfo.minimum", "最低价", "number", ["最低价"]),
  field("priceInfo.influencer", "达人分销价", "number", ["达人分销", "达人分销价"]),
  field("priceInfo.dropship", "一件代发价", "number", ["一件代发价"]),
  field("shelfLifeDays", "有效期天数", "number", ["有效期天数"]),
  field("pointsInfo.sales", "销售积分", "number", ["销售积分"]),
  field("pointsInfo.weighing", "称重积分", "number", ["称重积分"]),
  field("unitInfo.base", "基本单位", "text", ["基本单位"]),
  field("unitInfo.auxiliary", "辅助单位", "text", ["辅助单位"]),
  field("unitInfo.auxiliaryBoxVolume", "辅助箱体积", "number", ["辅助箱体积"]),
  field("productType", "品类", "text", ["品类"]),
  field("style", "风格", "text", ["风格"]),
  field("material", "材质", "text", ["材质"]),
  field("placement", "摆放位置", "text", ["摆放位置"]),
  field("grade", "级别", "text", ["级别"]),
  field("warehouseInfo.actualShipmentQuantity", "实际发货数量", "number", ["实际发货数量"]),
  field("remark", "备注", "text", ["备注"]),
  field("sourceCreatedAt", "ERP创建时间", "date", ["创建时间"]),
  field("sourceUpdatedAt", "ERP修改时间", "date", ["修改时间"]),
  field("supplierInfo.primarySupplier", "主供应商", "text", ["主供应商"]),
  field("supplierInfo.attributes", "供应商属性", "text", ["供应商属性"]),
  field("preSaleInfo.3", "3天内预售", "text", ["3天内预售"]),
  field("preSaleInfo.5", "5天内预售", "text", ["5天内预售"]),
  field("preSaleInfo.7", "7天内预售", "text", ["7天内预售"]),
  field("preSaleInfo.10", "10天内预售", "text", ["10天内预售"]),
  field("preSaleInfo.15", "15天内预售", "text", ["15天内预售"]),
  field("erpStatusRaw", "ERP单品状态", "text", ["单品状态", "商品状态"]),
  field("erpAttributes.calculatedColumn1", "自定义计算列1", "text", ["自定义计算列1"]),
  field("erpAttributes.calculatedColumn2", "自定义计算列2", "text", ["自定义计算列2"]),
  field("erpAttributes.calculatedColumn3", "自定义计算列3", "text", ["自定义计算列3"]),
  field("identifiers.barcode", "主条码", "text", ["主条码", "条码"]),
  field("identifiers.shortName", "简称", "text", ["简称"]),
  field("erpAttributes.itemMarkName", "单品标记名称", "text", ["单品标记名称"]),
  field("erpAttributes.attribute7", "单品属性7", "text", ["单品属性7"]),
  field("erpAttributes.attribute8", "单品属性8", "text", ["单品属性8"]),
  field("erpAttributes.attribute9", "单品属性9", "text", ["单品属性9"]),
  field("erpAttributes.attribute10", "单品属性10", "text", ["单品属性10"]),
  field("identifiers.specCode", "规格码", "text", ["规格码"]),
  field("identifiers.productCode", "货品编号", "text", ["货品编号"]),
  field("identifiers.sameStyleCode", "同款识别码", "text", ["同款识别码"]),
];

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(/\s+/g, "").replaceAll(/[（）]/g, (match) => match === "（" ? "(" : ")");
}

const aliasesByHeader = new Map();
for (const definition of productImportFieldDefinitions) {
  for (const alias of [definition.label, definition.key, ...definition.aliases]) aliasesByHeader.set(normalizeHeader(alias), definition.key);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolvePartPath(basePath, target) {
  const normalizedTarget = String(target ?? "").replace(/^\/+/, "");
  if (normalizedTarget.startsWith("xl/")) return normalizedTarget;
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePath), normalizedTarget));
}

async function readXml(zip, partPath) {
  const file = zip.file(partPath);
  if (file === null) return null;
  return xmlParser.parse(await file.async("text"));
}

function relationshipMap(document) {
  const relations = asArray(document?.Relationships?.Relationship);
  return new Map(relations.map((relation) => [relation.Id, relation.Target]));
}

function getDrawingAnchors(drawingDocument) {
  const root = drawingDocument?.["xdr:wsDr"] ?? {};
  return [
    ...asArray(root["xdr:oneCellAnchor"]),
    ...asArray(root["xdr:twoCellAnchor"]),
    ...asArray(root["xdr:absoluteAnchor"]),
  ];
}

async function extractXlsxImages(buffer, sheetName, batchDir) {
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await readXml(zip, "xl/workbook.xml");
  const workbookRelations = relationshipMap(await readXml(zip, "xl/_rels/workbook.xml.rels"));
  const sheets = asArray(workbook?.workbook?.sheets?.sheet);
  const sheet = sheets.find((item) => item.name === sheetName) ?? sheets[0];
  const worksheetPath = resolvePartPath("xl/workbook.xml", workbookRelations.get(sheet?.["r:id"]));
  const worksheet = await readXml(zip, worksheetPath);
  const worksheetRelationsPath = path.posix.join(path.posix.dirname(worksheetPath), "_rels", `${path.posix.basename(worksheetPath)}.rels`);
  const worksheetRelations = relationshipMap(await readXml(zip, worksheetRelationsPath));
  const drawingId = worksheet?.worksheet?.drawing?.["r:id"];
  if (!drawingId) return {};
  const drawingPath = resolvePartPath(worksheetPath, worksheetRelations.get(drawingId));
  const drawing = await readXml(zip, drawingPath);
  const drawingRelationsPath = path.posix.join(path.posix.dirname(drawingPath), "_rels", `${path.posix.basename(drawingPath)}.rels`);
  const drawingRelations = relationshipMap(await readXml(zip, drawingRelationsPath));
  const result = {};
  let imageIndex = 0;
  for (const anchor of getDrawingAnchors(drawing)) {
    const rowIndex = Number(anchor?.["xdr:from"]?.["xdr:row"]);
    const embedId = anchor?.["xdr:pic"]?.["xdr:blipFill"]?.["a:blip"]?.["r:embed"];
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || !embedId) continue;
    const mediaPath = resolvePartPath(drawingPath, drawingRelations.get(embedId));
    const mediaFile = zip.file(mediaPath);
    if (mediaFile === null) continue;
    const extension = path.extname(mediaPath).toLowerCase() || ".png";
    const filename = `row-${rowIndex + 1}-${imageIndex += 1}${extension}`;
    fs.writeFileSync(path.join(batchDir, filename), await mediaFile.async("nodebuffer"));
    (result[rowIndex] ??= []).push(`/uploads/product-imports/${path.basename(batchDir)}/${filename}`);
  }
  return result;
}

function carveXlsImages(buffer, rowCount, batchDir) {
  const candidates = [];
  const signatures = [
    { extension: ".jpg", start: Buffer.from([0xff, 0xd8, 0xff]), end: Buffer.from([0xff, 0xd9]), endOffset: 2 },
    { extension: ".png", start: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), end: Buffer.from("IEND"), endOffset: 8 },
  ];
  for (const signature of signatures) {
    let offset = 0;
    while (offset < buffer.length && candidates.length < rowCount * 4) {
      const start = buffer.indexOf(signature.start, offset);
      if (start < 0) break;
      const endMarker = buffer.indexOf(signature.end, start + signature.start.length);
      if (endMarker < 0) break;
      const end = endMarker + signature.endOffset;
      const data = buffer.subarray(start, end);
      if (data.length >= 1024) candidates.push({ start, extension: signature.extension, data });
      offset = end;
    }
  }
  candidates.sort((left, right) => left.start - right.start);
  const seen = new Set();
  const unique = candidates.filter((candidate) => {
    const hash = crypto.createHash("sha1").update(candidate.data).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  }).slice(0, rowCount);
  const result = {};
  unique.forEach((candidate, index) => {
    const rowIndex = index + 1;
    const filename = `row-${rowIndex + 1}-${index + 1}${candidate.extension}`;
    fs.writeFileSync(path.join(batchDir, filename), candidate.data);
    result[rowIndex] = [`/uploads/product-imports/${path.basename(batchDir)}/${filename}`];
  });
  return result;
}

function makeUniqueHeaders(values) {
  const counts = new Map();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `未命名列${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}（${count}）`;
  });
}

function findSofficeExecutable() {
  const candidates = [
    process.env.SOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/Applications/OpenOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 5000 });
    return result.status === 0;
  }) ?? null;
}

async function convertXlsToXlsx(filePath) {
  const executable = findSofficeExecutable();
  if (executable === null) return null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-product-import-"));
  try {
    await execFileAsync(executable, ["--headless", "--convert-to", "xlsx", "--outdir", tempDir, filePath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    const outputPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.xlsx`);
    if (!fs.existsSync(outputPath)) throw new Error("LibreOffice 未生成转换文件。");
    return { buffer: fs.readFileSync(outputPath), tempDir };
  } catch {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return null;
  }
}

export async function parseProductWorkbook(filePath, batchId, originalName) {
  const sourceBuffer = fs.readFileSync(filePath);
  const extension = path.extname(originalName).toLowerCase();
  const converted = extension === ".xls" ? await convertXlsToXlsx(filePath) : null;
  const workbookBuffer = converted?.buffer ?? sourceBuffer;
  if (converted !== null) fs.rmSync(converted.tempDir, { recursive: true, force: true });
  const workbook = XLSX.read(workbookBuffer, { type: "buffer", cellDates: true, cellText: true });
  const sheetName = workbook.SheetNames.find((name) => workbook.Sheets[name]?.["!ref"]) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
  if (rows.length < 2) throw new Error("Excel 中没有产品数据。");
  const headers = makeUniqueHeaders(rows[0]);
  const dataRows = rows.slice(1)
    .map((row, index) => ({ row, sheetRowIndex: index + 1 }))
    .filter((item) => item.row.some((value) => String(value ?? "").trim() !== ""));
  const batchDir = path.join(importRoot, batchId);
  fs.mkdirSync(batchDir, { recursive: true });
  const usesDrawingAnchors = extension === ".xlsx" || converted !== null;
  const extractedImagesBySheetRow = usesDrawingAnchors
    ? await extractXlsxImages(workbookBuffer, sheetName, batchDir)
    : carveXlsImages(sourceBuffer, dataRows.length, batchDir);
  const imageUrlsByRow = Object.fromEntries(dataRows.map((item, dataIndex) => [
    dataIndex + 1,
    extractedImagesBySheetRow[usesDrawingAnchors ? item.sheetRowIndex : dataIndex + 1] ?? [],
  ]).filter(([, urls]) => urls.length > 0));
  const records = dataRows.map((item) => Object.fromEntries(headers.map((header, columnIndex) => [header, item.row[columnIndex] ?? ""])));
  const mapping = Object.fromEntries(headers.map((header) => [header, aliasesByHeader.get(normalizeHeader(header)) ?? "rawSourceData"]));
  const warnings = usesDrawingAnchors ? [] : ["当前服务未找到 LibreOffice，旧版 .xls 图片按文件内顺序与数据行匹配；建议安装 LibreOffice 或上传 .xlsx 以获得精确行锚点。"];
  const staging = {
    fileName: originalName,
    sheetName,
    headers,
    records,
    imageUrlsByRow,
    imageExtractionMode: usesDrawingAnchors ? "drawingAnchors" : "sequentialFallback",
    warnings,
    parsedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(batchDir, "staging.json"), JSON.stringify(staging));
  return {
    staging,
    mapping,
    preview: records.slice(0, 20).map((record, index) => ({ rowNumber: index + 2, record, imageUrls: imageUrlsByRow[index + 1] ?? [] })),
    imageCount: Object.values(imageUrlsByRow).flat().length,
    warnings,
  };
}

export function readProductImportStaging(batchId) {
  const filePath = path.join(importRoot, batchId, "staging.json");
  if (!fs.existsSync(filePath)) throw new Error("导入暂存数据不存在，请重新上传 Excel。");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseValue(value, type) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (type === "number") {
    const number = Number(raw.replaceAll(",", ""));
    return Number.isFinite(number) ? number : raw;
  }
  if (type === "list") return raw.split(/[,，;；|]/).map((item) => item.trim()).filter(Boolean);
  return raw;
}

function setNestedValue(target, key, value) {
  if (value === null || value === "") return;
  const parts = key.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function normalizeImportedStatus(value) {
  const raw = String(value ?? "").trim();
  if (/归档/.test(raw)) return "已归档";
  if (/清仓/.test(raw)) return "清仓";
  if (/停售|停用|禁用/.test(raw)) return "停售";
  if (/待上架|待售/.test(raw)) return "待上架";
  if (/在售|正常|启用/.test(raw)) return "在售";
  return "开发中";
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== "").map(([key, item]) => [key, compactObject(item)]));
}

export function validateProductImport(staging, mapping, existingProducts, batchId, sourceSystem) {
  const definitions = new Map(productImportFieldDefinitions.map((definition) => [definition.key, definition]));
  const mappedTargets = Object.values(mapping);
  const mappingErrors = [];
  if (!mappedTargets.includes("skuCode")) mappingErrors.push("必须将一个 ERP 字段映射为 SKU编码。");
  if (!mappedTargets.includes("name")) mappingErrors.push("必须将一个 ERP 字段映射为 产品名称。");
  const duplicateTargets = mappedTargets.filter((target, index) => target !== "rawSourceData" && mappedTargets.indexOf(target) !== index);
  if (duplicateTargets.length > 0) mappingErrors.push(`以下系统字段被重复映射：${[...new Set(duplicateTargets)].join("、")}`);
  const existingBySku = new Map(existingProducts.map((product) => [product.skuCode.toLowerCase(), product]));
  const seenSku = new Set();
  const now = new Date().toISOString();
  const rows = staging.records.map((record, index) => {
    const product = {
      id: `product-${batchId}-${index + 2}`,
      rawSourceData: record,
      sourceSystem,
      createdAt: now,
      updatedAt: now,
    };
    for (const header of staging.headers) {
      const target = mapping[header] ?? "rawSourceData";
      if (target === "rawSourceData") continue;
      const definition = definitions.get(target);
      if (definition) setNestedValue(product, target, parseValue(record[header], definition.type));
    }
    product.skuCode = String(product.skuCode ?? "").trim();
    product.name = String(product.name ?? product.identifiers?.shortName ?? product.skuName ?? "").trim();
    product.mainImage = staging.imageUrlsByRow[index + 1]?.[0] ?? null;
    product.galleryImages = staging.imageUrlsByRow[index + 1]?.slice(1) ?? [];
    product.status = normalizeImportedStatus(product.erpStatusRaw);
    product.lastImportedAt = now;
    const errors = [];
    if (!product.skuCode) errors.push("SKU编码为空");
    if (!product.name) errors.push("产品名称为空");
    const skuKey = product.skuCode.toLowerCase();
    if (skuKey && seenSku.has(skuKey)) errors.push("Excel 内 SKU编码重复");
    if (skuKey) seenSku.add(skuKey);
    for (const definition of productImportFieldDefinitions.filter((item) => item.type === "number")) {
      const value = definition.key.split(".").reduce((cursor, part) => cursor?.[part], product);
      if (typeof value === "string" && value !== "") errors.push(`${definition.label}不是有效数字`);
    }
    return {
      rowNumber: index + 2,
      action: existingBySku.has(skuKey) ? "update" : "create",
      product: { ...compactObject(product), rawSourceData: record },
      errors,
    };
  });
  const rowErrors = rows.reduce((total, row) => total + row.errors.length, 0);
  const summary = {
    total: rows.length,
    create: rows.filter((row) => row.action === "create").length,
    update: rows.filter((row) => row.action === "update").length,
    valid: rows.filter((row) => row.errors.length === 0).length,
    invalid: rows.filter((row) => row.errors.length > 0).length,
    imageCount: Object.values(staging.imageUrlsByRow).flat().length,
    mappingErrors,
    rowErrors,
    imageExtractionMode: staging.imageExtractionMode,
    warnings: staging.warnings ?? [],
  };
  return { rows, summary, valid: mappingErrors.length === 0 && rowErrors === 0 };
}
