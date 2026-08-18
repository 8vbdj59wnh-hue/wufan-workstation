import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");
const legacyColumns = new Set(["erpskuid", "productid"]);
const compatibilityReadRules = [
  { file: "server/db.js", marker: "legacy_migration", reason: "显式一次性旧关系迁移" },
  { file: "server/db.js", marker: "connection_sku_sales_facts_v2", reason: "旧销售事实表结构升级" },
];

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function lineFor(source, index) {
  return source.slice(0, index).split("\n").length;
}

function inspectSqlReads(source, relative) {
  const findings = [];
  const compatibilityReads = [];
  const sqlLiteralPattern = /(?:prepare|exec)\(\s*(`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu;
  for (const match of source.matchAll(sqlLiteralPattern)) {
    const sql = match[1];
    if (!/\b(?:FROM|JOIN)\s+sales_link_skus\b/iu.test(sql)) continue;
    const aliases = [...sql.matchAll(/\b(?:FROM|JOIN)\s+sales_link_skus(?:\s+AS)?\s+([A-Za-z_]\w*)/giu)]
      .map((item) => item[1]);
    const columns = new Set();
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      for (const column of legacyColumns) {
        if (new RegExp(`\\b${escaped}\\.${column}\\b`, "iu").test(sql)) columns.add(column);
      }
    }
    for (const column of legacyColumns) {
      if (new RegExp(`\\bsales_link_skus\\.${column}\\b`, "iu").test(sql)) columns.add(column);
    }
    if (!columns.size) continue;
    const compatibility = compatibilityReadRules.find((rule) => rule.file === relative && sql.includes(rule.marker));
    const detail = { file: path.join(root, relative), line: lineFor(source, match.index), type: "read", columns: [...columns] };
    if (compatibility) compatibilityReads.push({ ...detail, reason: compatibility.reason });
    else findings.push(detail);
  }
  return { findings, compatibilityReads };
}

function inspectFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const findings = [];
  const relative = path.relative(root, file);
  const reads = inspectSqlReads(source, relative);
  findings.push(...reads.findings);
  const insertPattern = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+sales_link_skus\s*\(([^)]*)\)/giu;
  for (const match of source.matchAll(insertPattern)) {
    const columns = match[1].split(",").map((column) => column.replaceAll(/[\s`"']/gu, "").toLowerCase());
    const risky = columns.filter((column) => legacyColumns.has(column));
    if (risky.length) findings.push({ file, line: lineFor(source, match.index), type: "insert", columns: risky });
  }
  const updatePattern = /UPDATE\s+sales_link_skus\s+SET[\s\S]{0,2000}?\b(erpSkuId|productId)\s*=/giu;
  for (const match of source.matchAll(updatePattern)) findings.push({ file, line: lineFor(source, match.index), type: "update", columns: [match[1]] });
  const linkInsertPattern = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+sales_links\s*\(/giu;
  for (const match of source.matchAll(linkInsertPattern)) {
    if (relative !== "server/productV2Import.js") findings.push({ file, line: lineFor(source, match.index), type: "sales_link_write_outside_platform_goods", columns: [] });
  }
  if (relative === "server/productV2Import.js") {
    for (const pattern of [
      /platformGoodsId\s*\|\|\s*(?:row\.)?canonicalUrl/gu,
      /platformGoodsId\s*\?[^:]+:\s*database\.prepare\([^)]*canonicalUrl/gu,
      /identityStrength\s*:\s*[^,\n]*\?\s*["']strong["']\s*:\s*["']weak["']/gu,
    ]) for (const match of source.matchAll(pattern)) findings.push({ file, line: lineFor(source, match.index), type: "url_identity_fallback", columns: [] });
  }
  if (relative === "server/connectionDataFoundationService.js") {
    const skuInsertPattern = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+sales_link_skus\s*\(/giu;
    for (const match of source.matchAll(skuInsertPattern)) findings.push({ file, line: lineFor(source, match.index), type: "relation_import_creates_link_sku", columns: [] });
  }
  return { findings, compatibilityReads: reads.compatibilityReads };
}

const inspections = listJavaScriptFiles(serverRoot).map(inspectFile);
const findings = inspections.flatMap((item) => item.findings);
const compatibilityReads = inspections.flatMap((item) => item.compatibilityReads);
const result = {
  check: "legacy relation write risk",
  scope: "server/**/*.js",
  protectedColumns: ["sales_link_skus.erpSkuId", "sales_link_skus.productId"],
  protectedReads: ["生产业务SQL不得直接读取sales_link_skus.erpSkuId", "生产业务SQL不得直接读取sales_link_skus.productId"],
  protectedIdentityRules: ["经营数据不创建sales_links", "ERP关系导入不创建sales_link_skus", "URL不作为链接身份", "新链接只由平台货品导入创建"],
  riskCount: findings.length,
  status: findings.length ? "risk_detected" : "none",
  findings: findings.map((item) => ({ ...item, file: path.relative(root, item.file) })),
  compatibilityReads: compatibilityReads.map((item) => ({ ...item, file: path.relative(root, item.file) })),
};

console.log("legacy relation write risk:", result.status);
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
