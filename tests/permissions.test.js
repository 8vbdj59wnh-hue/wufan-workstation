import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  PERMISSION_SCHEMA_VERSION,
  canAccessModule,
  canAccessTemplateCenter,
  createEmptyPermissions,
  hasPermission,
  normalizePermissions,
  permissionCount,
  permissionGroups,
  validatePermissionDependencies,
} from "../shared/permissions.js";

function groupKeys(groupKey) {
  return permissionGroups.find((group) => group.key === groupKey)?.permissions.map((item) => item.key) ?? [];
}

test("V2 正式目录固定为 56 项且不暴露 Legacy 或退役模块", () => {
  assert.equal(permissionCount, 56);
  assert.equal(PERMISSION_SCHEMA_VERSION, 2);
  assert.deepEqual(groupKeys("links"), ["view", "manage", "rating", "diagnosis", "improve", "import", "manageRelations"]);
  assert.deepEqual(groupKeys("products"), ["view", "manage", "archive", "import"]);
  assert.deepEqual(groupKeys("skus"), ["view", "manage"]);
  assert.deepEqual(groupKeys("combos"), ["view"]);
  for (const retiredGroup of ["modules", "supplyChain", "customers", "aiAssistant"]) assert.deepEqual(groupKeys(retiredGroup), []);
  for (const legacyPermission of ["links.health", "links.manageHealth"]) {
    const [group, key] = legacyPermission.split(".");
    assert.equal(groupKeys(group).includes(key), false);
  }
});

test("前后端和数据库从同一份权限定义读取", async () => {
  const compatibilityFacade = await import("../src/permissions.js");
  assert.equal(compatibilityFacade.hasPermission, hasPermission);
  assert.equal(compatibilityFacade.permissionGroups, permissionGroups);
  const databaseSource = fs.readFileSync(new URL("../server/db.js", import.meta.url), "utf8");
  const authSource = fs.readFileSync(new URL("../server/modules/auth/index.js", import.meta.url), "utf8");
  const frontendSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(databaseSource, /from "\.\.\/shared\/permissions\.js"/);
  assert.match(authSource, /from "\.\.\/\.\.\/\.\.\/shared\/permissions\.js"/);
  assert.match(frontendSource, /from "\.\.\/shared\/permissions\.js"/);
});

test("V2 权限依赖阻止只有写权限而没有查看权限", () => {
  const invalid = createEmptyPermissions();
  invalid.templates.manage = true;
  invalid.tasks.execute = true;
  assert.deepEqual(validatePermissionDependencies(invalid), [
    { permission: "tasks.execute", missing: ["tasks.view"] },
    { permission: "templates.manage", missing: ["templates.view"] },
  ]);
});

test("Legacy 映射保守收敛，不把歧义权限自动扩大", () => {
  const permissions = normalizePermissions({
    modules: { products: true, links: true },
    products: { view: true, create: true, edit: true, archive: false },
    links: { view: true, manage: true, improve: true, import: false, health: true, manageHealth: true },
    tasks: { view: true, submitResult: true, changeStatus: false, batchComplete: true, batchCancel: false },
  });
  assert.equal(permissions.permissionVersion, 2);
  assert.equal(permissions.products.manage, true);
  assert.equal(permissions.products.import, true);
  assert.equal(permissions.skus.manage, false);
  assert.equal(permissions.links.rating, false);
  assert.equal(permissions.links.diagnosis, true);
  assert.equal(permissions.links.improve, true);
  assert.equal(permissions.links.manageRelations, false);
  assert.equal(permissions.tasks.execute, false);
  assert.equal(permissions.tasks.manage, false);
  assert.equal(permissions.tasks.cancel, false);
  assert.equal(permissions.links.health, undefined);
  assert.equal(permissions.modules, undefined);
});

test("Legacy 中依赖不完整的写权限会被撤销而非补发查看权限", () => {
  const permissions = normalizePermissions({ workPlans: { launch: true }, processes: { viewInstances: true, viewTemplates: false } });
  assert.equal(permissions.keyActions.view, true);
  assert.equal(permissions.actionStandards.view, false);
  assert.equal(permissions.keyActions.launch, false);
  assert.deepEqual(validatePermissionDependencies(permissions), []);
});

test("模板中心和产品中心按独立正式查看权限开放", () => {
  const templateViewer = createEmptyPermissions();
  templateViewer.templates.view = true;
  assert.equal(canAccessTemplateCenter(templateViewer), true);
  assert.equal(canAccessModule(templateViewer, "templateCenter"), true);
  const skuViewer = createEmptyPermissions();
  skuViewer.skus.view = true;
  assert.equal(canAccessModule(skuViewer, "products"), true);
  assert.equal(hasPermission(skuViewer, "products.view"), false);
  const retiredPayload = normalizePermissions({ modules: { customers: true, supplyChain: true, aiAssistant: true }, customers: { view: true }, supplyChain: { view: true } });
  assert.equal(canAccessModule(retiredPayload, "customerCenter"), false);
  assert.equal(canAccessModule(retiredPayload, "supplyChainCenter"), false);
});

test("旧账号保留上传兼容，但 V2 新账号默认不获得上传权限", () => {
  const legacy = normalizePermissions({ tasks: { view: true } });
  assert.equal(legacy.uploads.image, true);
  assert.equal(legacy.uploads.file, true);
  const v2 = createEmptyPermissions();
  assert.equal(v2.uploads.image, false);
  assert.equal(v2.uploads.file, false);
});

test("权限门禁不再把 Legacy health 或产品权限作为链接授权依据", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const linkPageSource = fs.readFileSync(new URL("../src/connectionCenterPage.js", import.meta.url), "utf8");
  assert.match(serverSource, /const requireLinkRating = requirePermission\("links\.rating"\)/);
  assert.match(serverSource, /const requireLinkRelations = requirePermission\("links\.manageRelations"\)/);
  assert.doesNotMatch(serverSource, /requireAnyPermission\("links\.[^"]+", "products\.[^"]+"\)/);
  assert.doesNotMatch(linkPageSource, /links\.[^"]+"\) \|\| hasPermission\([^\n]+products\./);
  assert.doesNotMatch(serverSource, /requirePermission\("links\.(?:health|manageHealth)"\)/);
});
