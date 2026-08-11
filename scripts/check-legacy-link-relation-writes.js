import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");
const legacyColumns = new Set(["erpskuid", "productid"]);

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

function inspectFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const findings = [];
  const insertPattern = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+sales_link_skus\s*\(([^)]*)\)/giu;
  for (const match of source.matchAll(insertPattern)) {
    const columns = match[1].split(",").map((column) => column.replaceAll(/[\s`"']/gu, "").toLowerCase());
    const risky = columns.filter((column) => legacyColumns.has(column));
    if (risky.length) findings.push({ file, line: lineFor(source, match.index), type: "insert", columns: risky });
  }
  const updatePattern = /UPDATE\s+sales_link_skus\s+SET[\s\S]{0,2000}?\b(erpSkuId|productId)\s*=/giu;
  for (const match of source.matchAll(updatePattern)) findings.push({ file, line: lineFor(source, match.index), type: "update", columns: [match[1]] });
  return findings;
}

const findings = listJavaScriptFiles(serverRoot).flatMap(inspectFile);
const result = {
  check: "legacy relation write risk",
  scope: "server/**/*.js",
  protectedColumns: ["sales_link_skus.erpSkuId", "sales_link_skus.productId"],
  riskCount: findings.length,
  status: findings.length ? "risk_detected" : "none",
  findings: findings.map((item) => ({ ...item, file: path.relative(root, item.file) })),
};

console.log("legacy relation write risk:", result.status);
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
