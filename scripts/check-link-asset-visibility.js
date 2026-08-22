import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireMatch = (file, pattern, message) => {
  if (!pattern.test(read(file))) failures.push(`${file}: ${message}`);
};
const forbidMatch = (file, pattern, message) => {
  if (pattern.test(read(file))) failures.push(`${file}: ${message}`);
};

requireMatch("server/linkOperatingSetService.js", /`\$\{alias\}\.currentState='active'`/u,
  "全部链接默认范围必须由sales_links.currentState=active决定");
forbidMatch("server/linkOperatingSetService.js", /const predicate =[^;]*lastSeenBatchId/u,
  "禁止使用lastSeenBatchId作为Link默认可见性条件");
forbidMatch("server/connectionDataFoundationService.js", /UPDATE sales_links SET[\s\S]{0,700}lastSeenBatchId/u,
  "平台经营数据不得覆盖Link平台货品批次身份");
forbidMatch("server/erpReconciliation.js", /UPDATE sales_links[\s\S]{0,300}currentState='missing'/u,
  "ERP对账不得因本批未出现把Link标记为missing");

const allowedBatchWriters = new Set([
  "server/platformGoodsExcelDataSyncAdapter.js",
  "server/productV2Import.js",
]);
for (const name of fs.readdirSync(path.join(root, "server")).filter((item) => item.endsWith(".js"))) {
  const file = `server/${name}`;
  if (allowedBatchWriters.has(file)) continue;
  const source = read(file);
  if (/UPDATE sales_links SET[\s\S]{0,700}lastSeenBatchId/u.test(source)
    || /INSERT INTO sales_links[\s\S]{0,900}lastSeenBatchId/u.test(source)) {
    failures.push(`${file}: 非平台货品流程不得写入Link资产批次字段`);
  }
}

if (failures.length) {
  console.error(["[link-asset-visibility] failed", ...failures.map((item) => `- ${item}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("[link-asset-visibility] passed: active可见性、增量同步和资产批次职责门禁均正常");
}
