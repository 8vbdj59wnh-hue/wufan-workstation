import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lineAt = (source, index) => source.slice(0, index).split("\n").length;
const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : entry.isFile() && entry.name.endsWith(".js") ? [relative] : [];
});
const report = (file, source, pattern, type) => {
  for (const match of source.matchAll(pattern)) findings.push({ file, line: lineAt(source, match.index), type, sample: match[0] });
};

const schema = read("server/schema.sql");
for (const [pattern, type] of [
  [/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+sales_link_sku_product_structure(?:s|_components)\b/giu, "legacy_link_structure_runtime_schema"],
  [/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+connection_sku_sales_facts\b/giu, "legacy_period_fact_runtime_schema"],
  [/CREATE\s+(?:TABLE|VIEW)\s+IF\s+NOT\s+EXISTS\s+legacy_connection_profiles\b/giu, "legacy_profile_normal_schema"],
  [/\bproductStructureId\b/gu, "legacy_structure_reference_in_normal_schema"],
]) report("server/schema.sql", schema, pattern, type);

const runtimeAllowlist = new Set([
  "server/db.js",
  "server/capabilities/resolveLinkSkuErpRelation.js",
]);
const archiveAllowlist = new Set([
  "server/legacy/linkCenterLegacyArchiveService.js",
]);
for (const file of walk("server")) {
  const source = read(file);
  const isAllowedHistoricalCode = runtimeAllowlist.has(file) || archiveAllowlist.has(file);
  if (!isAllowedHistoricalCode) {
    report(file, source, /\bsales_link_sku_product_structure(?:s|_components)\b/gu, "legacy_link_structure_runtime_dependency");
    report(file, source, /\bconnection_sku_sales_facts\b/gu, "legacy_period_fact_runtime_dependency");
    report(file, source, /\blegacy_connection_profiles\b/gu, "legacy_profile_runtime_dependency");
    report(file, source, /\blegacy_(?:link_product_structures|link_product_structure_components|connection_sku_sales_facts)\b/gu,
      "legacy_archive_read_outside_audit");
  }
  if (file !== "server/db.js") {
    report(file, source, /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+connection_sku_sales_facts\b/giu,
      "legacy_period_fact_write");
    report(file, source, /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+sales_link_sku_product_structure(?:s|_components)\b/giu,
      "legacy_link_structure_write");
  }
}

const currentResolver = read("server/capabilities/resolveLinkSkuRelationRead.js");
report("server/capabilities/resolveLinkSkuRelationRead.js", currentResolver,
  /resolveLinkSkuErpRelation|legacy_link_product_structure|sales_link_sku_product_structure/gu,
  "current_resolver_legacy_fallback");
const serverEntry = read("server/index.js");
report("server/index.js", serverEntry,
  /\/api\/[\w/-]*(?:legacy|product-structure-archive|period-sales-fact-archive|connection-profile-archive)/gu,
  "ordinary_api_exposes_legacy_archive");

const databaseSource = read("server/db.js");
for (const required of [
  "archiveLinkCenterLegacyStructuresPhase4",
  "legacy_link_product_structure_sales_object_map",
  "legacy_connection_sku_sales_facts",
  "createLegacyArchiveReadOnlyTriggers",
]) {
  if (!databaseSource.includes(required)) findings.push({ file: "server/db.js", line: 1, type: "missing_phase4_archive_control", sample: required });
}

const result = {
  check: "link center Phase 4 legacy archive gate",
  allowedLegacyScopes: ["migration", "audit", "historical comparison"],
  riskCount: findings.length,
  status: findings.length ? "risk_detected" : "none",
  findings,
};
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
