import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { readXlsxWorkbook } from "./workbookReader.js";

const entryTypes = new Set(["income", "refund", "cost", "expense"]);

function text(value) { return String(value ?? "").trim(); }
function now() { return new Date().toISOString(); }
function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  const parsed = Number(String(value ?? "").replace(/[¥￥,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}
function date(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const source = text(value).replace(/[./]/g, "-");
  const match = source.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}
function field(row, aliases) {
  for (const alias of aliases) if (row[alias] !== undefined && text(row[alias]) !== "") return row[alias];
  return "";
}
function rules(database) {
  return database.prepare("SELECT * FROM finance_rules WHERE status='active' ORDER BY priority ASC,createdAt ASC").all()
    .map((rule) => ({ ...rule, keywords: parseJson(rule.keywordsJson, []) }));
}

function classify(description, rawType, availableRules) {
  const explicit = text(rawType).toLowerCase();
  const aliases = { 收入: "income", 销售: "income", 退款: "refund", 退货: "refund", 成本: "cost", 费用: "expense", 支出: "expense" };
  const normalized = entryTypes.has(explicit) ? explicit : aliases[text(rawType)] || "";
  if (normalized) return { entryType: normalized, category: text(rawType) || normalized, matchMethod: "column" };
  const content = text(description).toLowerCase();
  const matched = availableRules.find((rule) => rule.keywords.some((keyword) => content.includes(text(keyword).toLowerCase())));
  return matched
    ? { entryType: matched.entryType, category: matched.category, matchMethod: `rule:${matched.id}` }
    : { entryType: "", category: "", matchMethod: "pending" };
}

function resolveRelations(database, skuCode, platformGoodsId) {
  const product = text(skuCode) ? database.prepare("SELECT id FROM products WHERE lower(skuCode)=lower(?)").get(text(skuCode)) : null;
  const salesLink = text(platformGoodsId) ? database.prepare("SELECT id FROM sales_links WHERE platformGoodsId=?").get(text(platformGoodsId)) : null;
  return { productId: product?.id ?? null, salesLinkId: salesLink?.id ?? null };
}

export function createFinanceImportBatch(file, userId) {
  if (!file?.buffer?.length) throw new Error("请选择账单文件。");
  const database = getDatabase();
  const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const existing = database.prepare("SELECT id FROM finance_import_batches WHERE fileHash=? AND status<>'failed' ORDER BY createdAt DESC LIMIT 1").get(fileHash);
  if (existing) return readFinanceImportBatch(existing.id);
  const workbook = readXlsxWorkbook(file.buffer, { type: "buffer", cellDates: true }, { context: "finance-import" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("账单没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const availableRules = rules(database);
  const preview = rows.map((row, index) => {
    const businessDate = date(field(row, ["日期", "交易日期", "账务日期", "业务日期", "时间", "date"]));
    const description = text(field(row, ["摘要", "说明", "交易内容", "商品名称", "费用名称", "description"]));
    const amount = number(field(row, ["金额", "实际收入", "支付金额", "费用金额", "成本金额", "amount"]));
    const classification = classify(description, field(row, ["类型", "收支类型", "科目", "账务类型", "type"]), availableRules);
    const skuCode = text(field(row, ["SKU", "SKU编码", "商家编码", "货号", "skuCode"]));
    const platformGoodsId = text(field(row, ["商品ID", "平台商品ID", "platformGoodsId"]));
    const relations = resolveRelations(database, skuCode, platformGoodsId);
    const errors = [];
    if (!businessDate) errors.push("缺少有效日期");
    if (amount === null) errors.push("缺少有效金额");
    if (!classification.entryType) errors.push("待选择财务类型");
    return {
      rowNumber: index + 2,
      externalId: text(field(row, ["交易单号", "订单号", "流水号", "账单ID", "externalId"])) || `row-${index + 2}`,
      businessDate, description, amount, ...classification,
      platform: text(field(row, ["平台", "渠道", "platform"])), skuCode, platformGoodsId,
      ...relations, sourceData: row, errors,
    };
  });
  const id = `finance-import-${crypto.randomUUID()}`;
  const timestamp = now();
  const matchedRows = preview.filter((row) => row.errors.length === 0).length;
  database.prepare(`INSERT INTO finance_import_batches
    (id,fileName,fileHash,status,totalRows,matchedRows,pendingRows,previewJson,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,'parsed',?,?,?,?,?,?,?)`)
    .run(id, file.originalname || "账单.xlsx", fileHash, preview.length, matchedRows, preview.length - matchedRows, JSON.stringify(preview), userId || null, timestamp, timestamp);
  return readFinanceImportBatch(id);
}

export function readFinanceImportBatch(id) {
  const row = getDatabase().prepare("SELECT * FROM finance_import_batches WHERE id=?").get(text(id));
  if (!row) throw new Error("账单导入批次不存在。");
  return { ...row, preview: parseJson(row.previewJson, []) };
}

export function listFinanceImportBatches() {
  return getDatabase().prepare("SELECT id,fileName,fileHash,status,totalRows,matchedRows,pendingRows,createdBy,createdAt,updatedAt FROM finance_import_batches ORDER BY createdAt DESC").all();
}

export function commitFinanceImportBatch(id, input, userId) {
  const database = getDatabase();
  const batch = readFinanceImportBatch(id);
  if (batch.status === "completed") return { batch, created: 0 };
  const adjustments = new Map((Array.isArray(input?.adjustments) ? input.adjustments : []).map((item) => [Number(item.rowNumber), item]));
  const prepared = batch.preview.map((row) => {
    const adjustment = adjustments.get(row.rowNumber) || {};
    const entryType = text(adjustment.entryType || row.entryType);
    const category = text(adjustment.category || row.category);
    if (!entryTypes.has(entryType)) throw new Error(`第${row.rowNumber}行需要选择有效财务类型。`);
    if (!category) throw new Error(`第${row.rowNumber}行需要填写科目分类。`);
    if (!row.businessDate || row.amount === null) throw new Error(`第${row.rowNumber}行日期或金额无效。`);
    return { ...row, entryType, category, description: text(adjustment.description ?? row.description) };
  });
  const commit = database.transaction(() => {
    let created = 0;
    const insert = database.prepare(`INSERT OR IGNORE INTO finance_entries
      (id,importBatchId,businessDate,entryType,category,amount,description,platform,productId,salesLinkId,externalId,sourceDataJson,status,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'confirmed',?,?,?)`);
    const timestamp = now();
    for (const row of prepared) {
      const result = insert.run(`finance-entry-${crypto.randomUUID()}`, batch.id, row.businessDate, row.entryType, row.category, row.amount,
        row.description, row.platform, row.productId, row.salesLinkId, row.externalId, JSON.stringify(row.sourceData), userId || null, timestamp, timestamp);
      created += result.changes;
    }
    database.prepare("UPDATE finance_import_batches SET status='completed',matchedRows=?,pendingRows=0,updatedAt=? WHERE id=?").run(prepared.length, timestamp, batch.id);
    return created;
  });
  const created = commit();
  return { batch: readFinanceImportBatch(id), created };
}

export function listFinanceRules() {
  return getDatabase().prepare("SELECT * FROM finance_rules ORDER BY priority ASC,createdAt ASC").all().map((row) => ({ ...row, keywords: parseJson(row.keywordsJson, []) }));
}

export function saveFinanceRule(input, userId, id = "") {
  const entryType = text(input?.entryType);
  if (!entryTypes.has(entryType)) throw new Error("规则财务类型无效。");
  const keywords = Array.isArray(input?.keywords) ? input.keywords.map(text).filter(Boolean) : text(input?.keywords).split(/[,，\n]/).map(text).filter(Boolean);
  if (!text(input?.name) || !keywords.length || !text(input?.category)) throw new Error("规则名称、关键词和科目不能为空。");
  const database = getDatabase();
  const timestamp = now();
  const ruleId = text(id) || `finance-rule-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO finance_rules (id,name,keywordsJson,entryType,category,priority,status,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?, ?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,keywordsJson=excluded.keywordsJson,
    entryType=excluded.entryType,category=excluded.category,priority=excluded.priority,status=excluded.status,updatedAt=excluded.updatedAt`)
    .run(ruleId, text(input.name), JSON.stringify(keywords), entryType, text(input.category), Number(input.priority) || 100,
      ["active", "inactive"].includes(text(input.status)) ? text(input.status) : "active", userId || null, timestamp, timestamp);
  return listFinanceRules().find((rule) => rule.id === ruleId);
}

export function removeFinanceRule(id) {
  const result = getDatabase().prepare("DELETE FROM finance_rules WHERE id=?").run(text(id));
  if (!result.changes) throw new Error("财务规则不存在。");
}

function whereRange(options) {
  const clauses = ["status IN ('confirmed','approved')"];
  const values = [];
  if (text(options.startDate)) { clauses.push("businessDate>=?"); values.push(text(options.startDate)); }
  if (text(options.endDate)) { clauses.push("businessDate<=?"); values.push(text(options.endDate)); }
  return { sql: clauses.join(" AND "), values };
}

function totals(rows) {
  const sum = (type) => rows.filter((row) => row.entryType === type).reduce((total, row) => total + Number(row.amount || 0), 0);
  const grossIncome = sum("income");
  const refunds = sum("refund");
  const income = grossIncome - refunds;
  const cost = sum("cost");
  const expense = sum("expense");
  const grossProfit = income - cost;
  const netProfit = grossProfit - expense;
  return { grossIncome, refunds, income, cost, grossProfit, expense, netProfit, profitMargin: income ? netProfit / income : null };
}

export function getFinanceStatement(options = {}) {
  const database = getDatabase();
  const range = whereRange(options);
  const rows = database.prepare(`SELECT * FROM finance_entries WHERE ${range.sql} ORDER BY businessDate`).all(...range.values);
  const periodType = ["day", "week", "month"].includes(text(options.periodType)) ? text(options.periodType) : "month";
  const key = (row) => periodType === "day" ? row.businessDate : periodType === "week"
    ? `${row.businessDate.slice(0, 4)}-W${String(database.prepare("SELECT strftime('%W',?) value").get(row.businessDate).value)}` : row.businessDate.slice(0, 7);
  const groups = new Map();
  for (const row of rows) { const period = key(row); const items = groups.get(period) || []; items.push(row); groups.set(period, items); }
  return { periodType, summary: totals(rows), periods: [...groups.entries()].map(([period, items]) => ({ period, ...totals(items) })).sort((a, b) => a.period.localeCompare(b.period)) };
}

export function listFinanceEntries(options = {}) {
  const range = whereRange(options);
  const clauses = [range.sql]; const values = [...range.values];
  if (text(options.entryType)) { clauses.push("entryType=?"); values.push(text(options.entryType)); }
  return getDatabase().prepare(`SELECT * FROM finance_entries WHERE ${clauses.join(" AND ")} ORDER BY businessDate DESC,createdAt DESC LIMIT 1000`).all(...values);
}

export function approveFinanceEntry(id, userId) {
  const timestamp = now();
  const result = getDatabase().prepare("UPDATE finance_entries SET status='approved',approvedBy=?,approvedAt=?,updatedAt=? WHERE id=? AND status='confirmed'").run(userId, timestamp, timestamp, text(id));
  if (!result.changes) throw new Error("财务记录不存在或已审核。");
}

export function getFinanceAnalysis(options = {}) {
  const range = whereRange(options);
  const database = getDatabase();
  const rows = database.prepare(`SELECT * FROM finance_entries WHERE ${range.sql}`).all(...range.values);
  const group = (field, labelResolver) => {
    const map = new Map();
    for (const row of rows) { const id = row[field] || "unassigned"; const items = map.get(id) || []; items.push(row); map.set(id, items); }
    return [...map.entries()].map(([id, items]) => ({ id, name: labelResolver(id), ...totals(items) })).sort((a, b) => b.netProfit - a.netProfit);
  };
  return {
    products: group("productId", (id) => id === "unassigned" ? "未关联产品" : database.prepare("SELECT name FROM products WHERE id=?").get(id)?.name || id),
    links: group("salesLinkId", (id) => id === "unassigned" ? "未关联链接" : database.prepare("SELECT title FROM sales_links WHERE id=?").get(id)?.title || id),
    platforms: group("platform", (id) => id === "unassigned" ? "未设置平台" : id),
  };
}
