import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  canAccessModule,
  hasPermission,
  normalizePermissions,
  permissionGroups,
  serializePermissions,
} from "../src/permissions.js";

function groupKeys(groupKey) {
  return permissionGroups.find((group) => group.key === groupKey)?.permissions.map((item) => item.key) ?? [];
}

test("权限清单包含独立链接和供应链权限域", () => {
  assert.deepEqual(groupKeys("links"), ["view", "manage", "import", "health", "manageHealth", "improve"]);
  assert.deepEqual(groupKeys("supplyChain"), ["view", "manage", "purchase", "quality"]);
  assert(groupKeys("modules").includes("links"));
  assert(groupKeys("modules").includes("supplyChain"));
  assert.deepEqual(groupKeys("products"), ["view", "create", "edit", "archive"]);
});

test("权限清单包含独立上传权限域", () => {
  assert.deepEqual(groupKeys("uploads"), ["image", "file", "standardWorkAttachment"]);
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

test("旧产品查看角色继续获得链接和供应链只读兼容权限", () => {
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
  assert.equal(permissions.supplyChain.view, true);
  assert.equal(permissions.supplyChain.manage, false);
  assert.equal(permissions.supplyChain.purchase, false);
  assert.equal(permissions.supplyChain.quality, false);
});

test("旧产品编辑角色继续获得原有业务写权限", () => {
  const permissions = normalizePermissions({
    modules: { products: true },
    products: { view: true, edit: true },
  });

  for (const permissionKey of ["manage", "import", "health", "manageHealth", "improve"]) {
    assert.equal(permissions.links[permissionKey], true);
  }
  for (const permissionKey of ["manage", "purchase", "quality"]) {
    assert.equal(permissions.supplyChain[permissionKey], true);
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
    modules: { products: true, links: false, supplyChain: false },
    products: { view: true, edit: true },
    links: { view: false, manage: false, import: false, health: false, manageHealth: false, improve: false },
    supplyChain: { view: false, manage: false, purchase: false, quality: false },
  };
  const permissions = normalizePermissions(productOnly);

  assert.equal(hasPermission(permissions, "products.view"), true);
  assert.equal(hasPermission(permissions, "products.edit"), true);
  assert.equal(hasPermission(permissions, "links.view"), false);
  assert.equal(hasPermission(permissions, "links.manage"), false);
  assert.equal(hasPermission(permissions, "supplyChain.view"), false);
  assert.equal(canAccessModule(permissions, "products"), true);
  assert.equal(canAccessModule(permissions, "connectionCenter"), false);
  assert.equal(canAccessModule(permissions, "supplyChainCenter"), false);

  const roundTrip = JSON.parse(serializePermissions(productOnly));
  assert.equal(roundTrip.links.view, false);
  assert.equal(roundTrip.supplyChain.view, false);
});

test("链接角色和供应链角色可以独立授权", () => {
  const linkRole = normalizePermissions({
    modules: { products: false, links: true, supplyChain: false },
    products: { view: false, edit: false },
    links: { view: true, manage: true, import: false, health: true, manageHealth: false, improve: false },
    supplyChain: { view: false, manage: false, purchase: false, quality: false },
  });
  assert.equal(canAccessModule(linkRole, "connectionCenter"), true);
  assert.equal(canAccessModule(linkRole, "products"), false);
  assert.equal(canAccessModule(linkRole, "supplyChainCenter"), false);
  assert.equal(hasPermission(linkRole, "links.manage"), true);
  assert.equal(hasPermission(linkRole, "links.import"), false);

  const supplyRole = normalizePermissions({
    modules: { products: false, links: false, supplyChain: true },
    products: { view: false, edit: false },
    links: { view: false, manage: false, import: false, health: false, manageHealth: false, improve: false },
    supplyChain: { view: true, manage: false, purchase: true, quality: false },
  });
  assert.equal(canAccessModule(supplyRole, "supplyChainCenter"), true);
  assert.equal(canAccessModule(supplyRole, "products"), false);
  assert.equal(canAccessModule(supplyRole, "connectionCenter"), false);
  assert.equal(hasPermission(supplyRole, "supplyChain.purchase"), true);
  assert.equal(hasPermission(supplyRole, "supplyChain.manage"), false);
});

test("前后端业务守卫不再直接拼接产品权限回退", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const linkPageSource = fs.readFileSync(new URL("../src/connectionCenterPage.js", import.meta.url), "utf8");
  const supplyPageSource = fs.readFileSync(new URL("../src/supplyChainCenterPage.js", import.meta.url), "utf8");

  assert.match(serverSource, /const requireLinkView = requirePermission\("links\.view"\)/);
  assert.match(serverSource, /const requireSupplyView = requirePermission\("supplyChain\.view"\)/);
  assert.doesNotMatch(serverSource, /requireAnyPermission\("links\.[^"]+", "products\.[^"]+"\)/);
  assert.doesNotMatch(serverSource, /requireAnyPermission\("supplyChain\.[^"]+", "products\.[^"]+"\)/);
  assert.doesNotMatch(linkPageSource, /links\.[^"]+"\) \|\| hasPermission\([^\n]+products\./);
  assert.doesNotMatch(supplyPageSource, /supplyChain\.[^"]+"\) \|\| hasPermission\([^\n]+products\./);
});
