import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");
const sourceRoot = path.join(root, "src");
const legacyRuntimeTables = [
  "sales_link_sku_erp_mappings",
  "sales_link_sku_product_structures",
  "sales_link_sku_product_structure_components",
  "sales_link_sku_combo_groups",
  "sales_link_sku_combo_group_components",
  "platform_sku_manual_bindings",
];
const allowedLegacyFactFiles = new Set(["server/db.js"]);
const allowedLegacyProfileWriterFiles = new Set(["server/db.js"]);
const allowedMappingWriterFiles = new Set(["server/db.js"]);
const allowedComboWriterFiles = new Set(["server/db.js"]);
const allowedLegacyStructureWriterFiles = new Set(["server/db.js", "server/productStructureSchema.js"]);
const allowedLegacyRelationReadFiles = new Set([
  "server/db.js",
  "server/productStructureSchema.js",
  "server/dataAssetMapService.js",
  "server/v3ShadowObservationService.js",
  "server/capabilities/resolveLinkSkuErpRelation.js",
  "server/capabilities/resolveLinkSkuRelationRead.js",
]);
const allowedLegacyDiagnosticFiles = new Set(["server/v3ShadowObservationService.js"]);
const allowedLegacySalesReadFiles = new Set(["server/db.js", "server/dataAssetMapService.js"]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function collect(source, relative, pattern, type, allowedFiles) {
  if (allowedFiles.has(relative)) return [];
  return [...source.matchAll(pattern)].map((match) => ({ file: relative, line: lineAt(source, match.index), type }));
}

const findings = [];
const schemaSource = fs.readFileSync(path.join(root, "server/schema.sql"), "utf8");
const legacyProfileTable = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+connection_profiles\b/iu.exec(schemaSource);
if (legacyProfileTable) {
  findings.push({
    file: "server/schema.sql",
    line: lineAt(schemaSource, legacyProfileTable.index),
    type: "legacy_connection_profile_table_create",
  });
}
if (!/CREATE\s+VIEW\s+IF\s+NOT\s+EXISTS\s+connection_profiles\b/iu.test(schemaSource)) {
  findings.push({ file: "server/schema.sql", line: 1, type: "missing_link_asset_compatibility_view" });
}
for (const tableName of legacyRuntimeTables) {
  const createPattern = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\b`, "iu");
  const match = createPattern.exec(schemaSource);
  if (match) findings.push({ file: "server/schema.sql", line: lineAt(schemaSource, match.index), type: "legacy_schema_auto_create", tableName });
}
const databaseSource = fs.readFileSync(path.join(root, "server/db.js"), "utf8");
const migrationStart = databaseSource.indexOf("export function runLightweightMigrations");
const migrationEnd = databaseSource.indexOf("\nexport function ", migrationStart + 1);
const activeMigrationSource = migrationStart >= 0 ? databaseSource.slice(migrationStart, migrationEnd >= 0 ? migrationEnd : undefined) : "";
for (const migrationName of ["migrateSalesLinkSkuComboGroupsV1", "migrateSalesLinkSkuProductStructuresV1"]) {
  const match = new RegExp(`\\b${migrationName}\\s*\\(`, "u").exec(activeMigrationSource);
  if (match) findings.push({ file: "server/db.js", line: lineAt(databaseSource, migrationStart + match.index), type: "legacy_schema_startup_migration", migrationName });
}
for (const file of files(serverRoot)) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+connection_sku_sales_facts\b/giu,
    "legacy_sales_fact_write",
    allowedLegacyFactFiles,
  ));
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+connection_profiles\b/giu,
    "legacy_connection_profile_write",
    allowedLegacyProfileWriterFiles,
  ));
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+sales_link_sku_erp_mappings\b/giu,
    "mapping_write_outside_product_structure_approval",
    allowedMappingWriterFiles,
  ));
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+sales_link_sku_product_structure(?:s|_components)\b/giu,
    "legacy_product_structure_write",
    allowedLegacyStructureWriterFiles,
  ));
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+platform_sku_manual_bindings\b/giu,
    "legacy_manual_binding_write",
    new Set(),
  ));
  findings.push(...collect(
    source,
    relative,
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+sales_link_sku_combo_(?:groups|group_components)\b/giu,
    "combo_write",
    allowedComboWriterFiles,
  ));
  for (const match of source.matchAll(/exceptionType\s*:\s*["'](?:combo_goods|bundle_sku)["']/gu)) {
    findings.push({ file: relative, line: lineAt(source, match.index), type: "legacy_combo_exception_generation" });
  }
  if (!["server/capabilities/resolveLinkSkuErpRelation.js", "server/capabilities/resolveLinkSkuRelationRead.js"].includes(relative)) {
    for (const match of source.matchAll(/from\s+["'][^"']*resolveLinkSkuErpRelation\.js["']/gu)) {
      findings.push({ file: relative, line: lineAt(source, match.index), type: "direct_legacy_resolver_import" });
    }
  }
  if (relative !== "server/db.js") {
    for (const match of source.matchAll(/\bsales_link_sku_combo_(?:groups|group_components)\b/gu)) {
      findings.push({ file: relative, line: lineAt(source, match.index), type: "legacy_combo_runtime_dependency" });
    }
    if (!allowedLegacyDiagnosticFiles.has(relative)) for (const match of source.matchAll(/\bplatform_sku_manual_bindings\b/gu)) {
      findings.push({ file: relative, line: lineAt(source, match.index), type: "legacy_manual_binding_runtime_dependency" });
    }
  }
  findings.push(...collect(
    source,
    relative,
    /\bsales_link_sku_(?:erp_mappings|product_structures|product_structure_components)\b/gu,
    "legacy_relation_runtime_read",
    allowedLegacyRelationReadFiles,
  ));
  findings.push(...collect(
    source,
    relative,
    /\bconnection_sku_sales_facts\b/gu,
    "legacy_sales_fact_runtime_read",
    allowedLegacySalesReadFiles,
  ));
}

for (const file of files(sourceRoot)) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of [
    { regex: /\bloadComboReview(?:s|Detail|AnomalyDates|SourceRows)\b/gu, type: "legacy_combo_frontend_entry" },
    { regex: /\bplatformSkuManualBindings\b/gu, type: "legacy_manual_binding_frontend_state" },
    { regex: /\bunbindPlatformSku\b|data-action=["']unbind-platform-sku["']/gu, type: "legacy_manual_binding_frontend_action" },
    { regex: /\bmigrate-legacy\b|\breparseLegacyConnectionSalesFactImport\b|data-reparse-legacy-sales-fact/gu, type: "legacy_sales_fact_migration_frontend_entry" },
  ]) {
    for (const match of source.matchAll(pattern.regex)) findings.push({ file: relative, line: lineAt(source, match.index), type: pattern.type });
  }
}

const resolverFile = "server/capabilities/resolveLinkSkuRelationRead.js";
const resolverSource = fs.readFileSync(path.join(root, resolverFile), "utf8");
for (const pattern of [
  { regex: /resolverSource\s*:\s*["']legacy["']/gu, type: "legacy_resolver_business_fallback" },
  { regex: /salesObjectFallbackReason|safeToUseNew/gu, type: "legacy_resolver_conditional_fallback" },
]) {
  for (const match of resolverSource.matchAll(pattern.regex)) findings.push({ file: resolverFile, line: lineAt(resolverSource, match.index), type: pattern.type });
}

const result = {
  check: "link center V2 cleanup gate",
  protectedRules: [
    "经营档案实体已并入Link资产，禁止生产代码写入旧connection_profiles",
    "新环境只允许创建由sales_links派生的connection_profiles只读兼容视图",
    "旧周期销售事实禁止生产写入",
    "旧关系字段禁止业务读取（由check:legacy-relations检查）",
    "正式业务Resolver禁止回退旧结果",
    "旧Resolver只能由统一读取能力用于审计对比",
    "新环境不得创建Combo、Manual Binding、Legacy Mapping或Legacy Product Structure运行表",
    "Legacy active Mapping只读，生产服务不得新增、更新或删除",
    "正式业务不得读取Legacy Mapping或Link Product Structure；旧Resolver仅允许诊断读取",
    "旧周期销售事实仅保留Schema与资产目录，不提供运行时读取或迁移入口",
    "新关系审批只写Sales Object结构，不新增Legacy Mapping或Link Product Structure",
    "产品关系建议只生成Sales Object关系审批，正式服务不得读写platform_sku_manual_bindings",
    "禁止新生成combo_goods和bundle_sku异常",
  ],
  riskCount: findings.length,
  status: findings.length ? "risk_detected" : "none",
  findings,
};

console.log("link center V2 cleanup risk:", result.status);
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
