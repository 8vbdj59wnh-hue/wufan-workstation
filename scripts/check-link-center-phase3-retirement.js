import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const line = (source, index) => source.slice(0, index).split("\n").length;
const report = (file, source, pattern, type) => {
  for (const match of source.matchAll(pattern)) findings.push({ file, line: line(source, match.index), type, sample: match[0] });
};
const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : entry.isFile() && entry.name.endsWith(".js") ? [relative] : [];
});

const schema = read("server/schema.sql");
const linkAssetSchema = ["sales_links", "sales_link_skus"].map((table) =>
  new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "u").exec(schema)?.[1] || "").join("\n");
report("server/schema.sql", linkAssetSchema, /\b(?:rawUrl|lastSeenBatchId)\s+TEXT\b/gu, "retired_link_asset_schema_field");
for (const [pattern, type] of [
  [/CREATE\s+(?:TABLE|VIEW)\s+IF\s+NOT\s+EXISTS\s+connection_profiles\b/giu, "retired_connection_profiles_runtime_object"],
  [/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:connection_sku_inventory_facts|platform_link_shop_mappings|platform_link_shop_mapping_import_batches|platform_link_shop_mapping_import_rows|connection_health_records|connection_diagnosis_entries|connection_improvements)\b/giu, "retired_runtime_table"],
]) report("server/schema.sql", schema, pattern, type);

for (const file of [...walk("server"), ...walk("src")]) {
  if (file === "server/db.js") continue;
  const source = read(file);
  report(file, source, /\bconnection_profiles\b/gu, "legacy_connection_profiles_runtime_dependency");
  report(file, source, /\bconnection_sku_inventory_facts\b/gu, "legacy_link_inventory_runtime_dependency");
  report(file, source, /\bplatform_link_shop_(?:mappings|mapping_import_batches|mapping_import_rows)\b/gu, "legacy_shop_mapping_runtime_dependency");
  report(file, source, /\/api\/(?:connection-health-records|connection-improvements|connection-hospital)\b|\/health-records\b|\/diagnosis-entry\b/gu, "legacy_link_health_api");
  report(file, source, /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE)\s+sales_links[\s\S]{0,800}\blastSeenBatchId\b/giu, "link_last_seen_write");
  report(file, source, /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE)\s+sales_link_skus[\s\S]{0,800}\blastSeenBatchId\b/giu, "link_sku_last_seen_write");
  report(file, source, /\b(?:sales_links|sales_link_skus)\s*\.\s*rawUrl\b|\b(?:l|link)\.rawUrl\b/gu, "raw_url_business_read");
}

for (const file of ["server/productBusinessReadModel.js", "server/connectionBusinessCockpitService.js", "server/connectionService.js", "server/connectionCorePageService.js", "server/connectionBenchmarkService.js", "server/operationManagementService.js"]) {
  const source = read(file);
  report(file, source, /(?:SUM\s*\(\s*(?:ps\.)?payAmount\s*\)|SELECT\s+(?:ps\.)?payAmount\s+FROM\s+connection_period_snapshots)/giu,
    "platform_snapshot_used_as_formal_sales");
}

const result = { check: "link center Phase 3 retirement gate", riskCount: findings.length,
  status: findings.length ? "risk_detected" : "none", findings };
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
