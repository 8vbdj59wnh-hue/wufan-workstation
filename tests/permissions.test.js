import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  canAccessTemplateCenter,
  canAccessModule,
  hasPermission,
  normalizePermissions,
  permissionGroups,
  serializePermissions,
} from "../shared/permissions.js";

function groupKeys(groupKey) {
  return permissionGroups.find((group) => group.key === groupKey)?.permissions.map((item) => item.key) ?? [];
}

test("前后端从共享权限层读取同一套定义", async () => {
  const compatibilityFacade = await import("../src/permissions.js");
  assert.equal(compatibilityFacade.hasPermission, hasPermission);
  assert.equal(compatibilityFacade.permissionGroups, permissionGroups);

  const sharedSource = fs.readFileSync(new URL("../shared/permissions.js", import.meta.url), "utf8");
  const databaseSource = fs.readFileSync(new URL("../server/db.js", import.meta.url), "utf8");
  const authSource = fs.readFileSync(new URL("../server/modules/auth/index.js", import.meta.url), "utf8");
  const frontendSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

  assert.doesNotMatch(sharedSource, /^import\s/m);
  assert.match(databaseSource, /from "\.\.\/shared\/permissions\.js"/);
  assert.match(authSource, /from "\.\.\/\.\.\/\.\.\/shared\/permissions\.js"/);
  assert.match(frontendSource, /from "\.\.\/shared\/permissions\.js"/);
  assert.doesNotMatch(`${databaseSource}\n${authSource}`, /src\/permissions\.js/);
});

test("权限清单保留链接权限域并彻底移除客户与供应链权限入口", () => {
  assert.deepEqual(groupKeys("links"), ["view", "manage", "import", "health", "manageHealth", "improve"]);
  assert(groupKeys("modules").includes("links"));
  assert.equal(groupKeys("modules").includes("supplyChain"), false);
  assert.equal(groupKeys("modules").includes("customers"), false);
  assert.deepEqual(groupKeys("supplyChain"), []);
  assert.deepEqual(groupKeys("customers"), []);
  assert.deepEqual(groupKeys("products"), ["view", "create", "edit", "archive"]);
});

test("权限清单包含独立上传权限域", () => {
  assert.deepEqual(groupKeys("uploads"), ["image", "file", "standardWorkAttachment"]);
});

test("模板中心使用角色或显式权限，不再按部门自动放行", () => {
  assert(groupKeys("modules").includes("templateCenter"));
  const deniedPermissions = normalizePermissions({
    modules: { templateCenter: false },
    settings: { viewStandardWorks: false },
    processes: { viewTemplates: false },
    methods: { view: false },
  });

  assert.equal(canAccessTemplateCenter({
    role: "user",
    departmentId: "dept-marketing",
    departmentName: "视觉营销部",
    permissions: deniedPermissions,
  }), false);
  assert.equal(canAccessTemplateCenter({
    role: "user",
    permissions: { ...deniedPermissions, modules: { ...deniedPermissions.modules, templateCenter: true } },
  }), true);
  assert.equal(canAccessTemplateCenter({ role: "company_manager", permissions: deniedPermissions }), true);
  assert.equal(canAccessTemplateCenter({
    role: "user",
    permissions: { ...deniedPermissions, processes: { ...deniedPermissions.processes, viewTemplates: true } },
  }), true);
});

test("模板中心运行时权限守卫不读取部门字段", () => {
  const permissionSource = fs.readFileSync(new URL("../shared/permissions.js", import.meta.url), "utf8");
  const guardSource = permissionSource.match(/export function canAccessTemplateCenter[\s\S]*?\n}/)?.[0] ?? "";
  assert.notEqual(guardSource, "");
  assert.doesNotMatch(guardSource, /department(?:Id|Name)?/i);
});

test("旧账号保留上传能力，显式上传权限边界不会回退", () => {
  const legacyPermissions = normalizePermissions({
    modules: { execution: true },
    tasks: { view: true },
  });
  assert.equal(legacyPermissions.uploads.image, true);
  assert.equal(legacyPermissions.uploads.file, true);
  assert.equal(legacyPermissions.uploads.standardWorkAttachment, true);

  const explicitPermissions = normalizePermissions({
    uploads: { image: true, file: false, standardWorkAttachment: false },
  });
  assert.equal(explicitPermissions.uploads.image, true);
  assert.equal(explicitPermissions.uploads.file, false);
  assert.equal(explicitPermissions.uploads.standardWorkAttachment, false);
});

test("旧产品查看角色继续获得链接只读兼容权限", () => {
  const permissions = normalizePermissions({
    modules: { products: true },
    products: { view: true, edit: false },
  });

  assert.equal(permissions.links.view, true);
  assert.equal(permissions.links.health, true);
  assert.equal(permissions.links.manage, false);
  assert.equal(permissions.links.manageHealth, false);
  assert.equal(permissions.links.import, false);
  assert.equal(permissions.links.improve, false);
  assert.equal(permissions.supplyChain, undefined);
  assert.equal(permissions.customers, undefined);
});

test("旧产品编辑角色继续获得链接业务写权限", () => {
  const permissions = normalizePermissions({
    modules: { products: true },
    products: { view: true, edit: true },
  });

  for (const permissionKey of ["manage", "import", "health", "manageHealth", "improve"]) {
    assert.equal(permissions.links[permissionKey], true);
  }
});

test("历史上手工写入的部分链接权限继续生效", () => {
  const permissions = normalizePermissions({
    modules: { products: true },
    products: { view: true, edit: false },
    links: { manage: true, health: true },
  });

  assert.equal(permissions.links.view, true);
  assert.equal(permissions.links.manage, true);
  assert.equal(permissions.links.import, false);
  assert.equal(permissions.links.health, true);
  assert.equal(permissions.links.manageHealth, true);
  assert.equal(permissions.links.improve, false);
});

test("显式新权限域不会再回退到产品权限", () => {
  const productOnly = {
    modules: { products: true, links: false, supplyChain: true, customers: true },
    products: { view: true, edit: true },
    links: { view: false, manage: false, import: false, health: false, manageHealth: false, improve: false },
    supplyChain: { view: false, manage: false, purchase: false, quality: false },
    customers: { view: true, manage: true, maintain: true, analyze: true },
  };
  const permissions = normalizePermissions(productOnly);

  assert.equal(hasPermission(permissions, "products.view"), true);
  assert.equal(hasPermission(permissions, "products.edit"), true);
  assert.equal(hasPermission(permissions, "links.view"), false);
  assert.equal(hasPermission(permissions, "links.manage"), false);
  assert.equal(hasPermission(permissions, "supplyChain.view"), false);
  assert.equal(hasPermission(permissions, "customers.view"), false);
  assert.equal(canAccessModule(permissions, "products"), true);
  assert.equal(canAccessModule(permissions, "connectionCenter"), false);
  assert.equal(canAccessModule(permissions, "supplyChainCenter"), false);
  assert.equal(canAccessModule(permissions, "customerCenter"), false);

  const roundTrip = JSON.parse(serializePermissions(productOnly));
  assert.equal(roundTrip.links.view, false);
  assert.equal(roundTrip.supplyChain, undefined);
  assert.equal(roundTrip.customers, undefined);
});

test("退休模块不能通过历史权限负载重新授权", () => {
  const linkRole = normalizePermissions({
    modules: { products: false, links: true, supplyChain: true, customers: true },
    products: { view: false, edit: false },
    links: { view: true, manage: true, import: false, health: true, manageHealth: false, improve: false },
    supplyChain: { view: true, manage: true, purchase: true, quality: true },
    customers: { view: true, manage: true, maintain: true, analyze: true },
  });
  assert.equal(canAccessModule(linkRole, "connectionCenter"), true);
  assert.equal(canAccessModule(linkRole, "products"), false);
  assert.equal(canAccessModule(linkRole, "supplyChainCenter"), false);
  assert.equal(canAccessModule(linkRole, "customerCenter"), false);
  assert.equal(hasPermission(linkRole, "links.manage"), true);
  assert.equal(hasPermission(linkRole, "links.import"), false);
  assert.equal(linkRole.supplyChain, undefined);
  assert.equal(linkRole.customers, undefined);
});

test("链接业务守卫不再直接拼接产品权限回退", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const linkPageSource = fs.readFileSync(new URL("../src/connectionCenterPage.js", import.meta.url), "utf8");

  assert.match(serverSource, /const requireLinkView = requirePermission\("links\.view"\)/);
  assert.doesNotMatch(serverSource, /requireAnyPermission\("links\.[^"]+", "products\.[^"]+"\)/);
  assert.doesNotMatch(linkPageSource, /links\.[^"]+"\) \|\| hasPermission\([^\n]+products\./);
  assert.doesNotMatch(serverSource, /\/api\/(?:supply-chain|customer-center)/);
});
