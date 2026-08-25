#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  PERMISSION_SCHEMA_VERSION,
  createPermissionOverrides,
  mergePermissionSources,
  normalizePermissions,
  permissionCount,
  permissionGroups,
  validatePermissionDependencies,
} from "../shared/permissions.js";

function parseArguments(argv) {
  const result = { apply: false, databasePath: "", reportPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") result.apply = true;
    else if (argument === "--db") result.databasePath = argv[++index] ?? "";
    else if (argument === "--report") result.reportPath = argv[++index] ?? "";
    else throw new Error(`未知参数：${argument}`);
  }
  if (!path.isAbsolute(result.databasePath)) throw new Error("必须通过 --db 指定绝对数据库路径。");
  if (!result.reportPath) result.reportPath = `${result.databasePath}.permission-v2-report.json`;
  if (!path.isAbsolute(result.reportPath)) throw new Error("--report 必须是绝对路径。");
  return result;
}

function parseJson(value, fallback = {}) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function deepMerge(base, overrides) {
  const result = structuredClone(base && typeof base === "object" ? base : {});
  for (const [key, value] of Object.entries(overrides && typeof overrides === "object" ? overrides : {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = deepMerge(result[key], value);
    else result[key] = structuredClone(value);
  }
  return result;
}

function enabledPermissionKeys(permissions, includeLegacy = false) {
  const keys = [];
  for (const [group, values] of Object.entries(permissions ?? {})) {
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (value === true && (includeLegacy || permissionGroups.some((item) => item.key === group && item.permissions.some((permission) => permission.key === key)))) {
        keys.push(`${group}.${key}`);
      }
    }
  }
  return keys.sort();
}

function checksum(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function readIntegrity(database) {
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyRows = database.pragma("foreign_key_check");
  return { integrity, foreignKeyViolationCount: foreignKeyRows.length };
}

function roleOf(person) {
  return person.authRole || "user";
}

function isActiveTemplate(template) {
  return template && template.status !== "inactive";
}

function legacyEffectiveSource(person, template) {
  if (!isActiveTemplate(template)) return parseJson(person.permissions);
  return deepMerge(parseJson(template.permissions), parseJson(person.permissionOverrides));
}

function replacementSummary(oldKeys, v2Keys) {
  const oldSet = new Set(oldKeys);
  const replacements = [];
  const rules = [
    [["settings.managePermissions"], ["permissions.manage"]],
    [["settings.manageAccounts"], ["people.manageAccounts"]],
    [["settings.viewDataAssetMap"], ["dataAssets.view"]],
    [["finance.manage"], ["finance.maintain", "finance.configureRules"]],
    [["products.create", "products.edit"], ["products.manage"]],
    [["products.archive"], ["products.archive"]],
    [["workPlans.launch"], ["keyActions.launch"]],
    [["processes.viewInstances"], ["keyActions.view"]],
    [["tasks.submitResult", "tasks.changeStatus"], ["tasks.execute"]],
    [["assessment.view"], ["workResults.view"]],
    [["contentSchedules.view"], ["contentNotes.view"]],
    [["links.improve"], ["links.diagnosis", "links.improve"]],
  ];
  for (const [oldCandidates, newCandidates] of rules) {
    const matchedOld = oldCandidates.filter((key) => oldSet.has(key));
    const matchedNew = newCandidates.filter((key) => v2Keys.includes(key));
    if (matchedOld.length && matchedNew.length) replacements.push({ from: matchedOld, to: matchedNew });
  }
  return replacements;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!fs.existsSync(options.databasePath)) throw new Error(`数据库不存在：${options.databasePath}`);
  const database = new Database(options.databasePath, { readonly: !options.apply, fileMustExist: true });
  database.pragma("busy_timeout = 5000");
  const before = readIntegrity(database);
  if (before.integrity !== "ok" || before.foreignKeyViolationCount !== 0) {
    throw new Error(`迁移前数据库校验失败：integrity=${before.integrity}，foreignKeys=${before.foreignKeyViolationCount}`);
  }

  const people = database.prepare("SELECT id,name,authRole,status,canLogin,departmentId,permissions,permissionTemplateId,permissionOverrides FROM persons ORDER BY id").all();
  const templates = database.prepare("SELECT id,name,status,permissions FROM permission_templates ORDER BY id").all();
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const migratedTemplates = new Map(templates.map((template) => [
    template.id,
    normalizePermissions(template.permissions, "user"),
  ]));

  const personPlans = people.map((person) => {
    const role = roleOf(person);
    const template = templateById.get(person.permissionTemplateId);
    const oldSource = legacyEffectiveSource(person, template);
    const oldKeys = enabledPermissionKeys(oldSource, true);
    const effectiveV2 = isActiveTemplate(template)
      ? mergePermissionSources(template.permissions, person.permissionOverrides, role)
      : normalizePermissions(person.permissions, role);
    const dependencyErrors = validatePermissionDependencies(effectiveV2, role);
    const templateV2 = isActiveTemplate(template) ? migratedTemplates.get(template.id) : null;
    const overridesV2 = templateV2
      ? createPermissionOverrides(templateV2, effectiveV2, role)
      : { permissionVersion: PERMISSION_SCHEMA_VERSION };
    const v2Keys = enabledPermissionKeys(effectiveV2);
    const directlyMappedKeys = new Set(enabledPermissionKeys(normalizePermissions(oldSource, role)));
    return {
      id: person.id,
      name: person.name,
      role,
      status: person.status,
      canLogin: Boolean(person.canLogin),
      departmentId: person.departmentId,
      permissionTemplateId: person.permissionTemplateId || null,
      dataScope: effectiveV2.dataScope,
      oldEnabledPermissions: oldKeys,
      v2EnabledPermissions: v2Keys,
      removedLegacyPermissions: oldKeys.filter((key) => !v2Keys.includes(key)),
      replacements: replacementSummary(oldKeys, v2Keys),
      addedWithoutLegacyEvidence: v2Keys.filter((permission) => !directlyMappedKeys.has(permission)),
      dependencyErrors,
      permissionsV2: effectiveV2,
      overridesV2,
    };
  });

  const blockers = personPlans.flatMap((person) => [
    ...person.dependencyErrors.map((error) => ({ personId: person.id, type: "dependency", error })),
    ...person.addedWithoutLegacyEvidence.map((permission) => ({ personId: person.id, type: "privilege_increase", permission })),
  ]);
  if (blockers.length) throw new Error(`迁移被安全校验阻止：${JSON.stringify(blockers)}`);

  if (options.apply) {
    const migrate = database.transaction(() => {
      const updateTemplate = database.prepare("UPDATE permission_templates SET permissions = ? WHERE id = ?");
      for (const template of templates) updateTemplate.run(JSON.stringify(migratedTemplates.get(template.id)), template.id);
      const updatePerson = database.prepare("UPDATE persons SET permissions = ?, permissionOverrides = ? WHERE id = ?");
      for (const person of personPlans) {
        updatePerson.run(JSON.stringify(person.permissionsV2), JSON.stringify(person.overridesV2), person.id);
      }
    });
    migrate();
  }

  const after = readIntegrity(database);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "isolated-copy-apply" : "preview",
    databasePath: options.databasePath,
    databaseFileSize: fs.statSync(options.databasePath).size,
    permissionCatalog: { version: PERMISSION_SCHEMA_VERSION, formalPermissionCount: permissionCount },
    counts: {
      people: people.length,
      activeLoginAccounts: people.filter((person) => person.status === "active" && Boolean(person.canLogin)).length,
      permissionTemplates: templates.length,
      migratedPeople: options.apply ? people.length : 0,
      migratedTemplates: options.apply ? templates.length : 0,
      privilegeIncreaseBlockers: blockers.filter((item) => item.type === "privilege_increase").length,
    },
    validation: { before, after, safeToApply: blockers.length === 0 },
    sourceFingerprint: checksum(JSON.stringify({ people, templates })),
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      status: template.status,
      oldEnabledPermissions: enabledPermissionKeys(parseJson(template.permissions), true),
      v2EnabledPermissions: enabledPermissionKeys(migratedTemplates.get(template.id)),
    })),
    people: personPlans.map(({ permissionsV2, overridesV2, dependencyErrors, ...person }) => ({
      ...person,
      dependencyErrors,
      permissionsChecksum: checksum(JSON.stringify(permissionsV2)),
      overridesChecksum: checksum(JSON.stringify(overridesV2)),
    })),
  };
  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  database.close();
  process.stdout.write(`${JSON.stringify({ mode: report.mode, reportPath: options.reportPath, counts: report.counts, validation: report.validation }, null, 2)}\n`);
}

main();
