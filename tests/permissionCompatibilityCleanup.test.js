import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEmptyPermissions } from "../shared/permissions.js";

function legacyDeniedPermissions() {
  const permissions = createEmptyPermissions("self");
  delete permissions.modules.templateCenter;
  permissions.settings.viewStandardWorks = false;
  permissions.processes.viewTemplates = false;
  permissions.methods.view = false;
  return permissions;
}

test("历史部门兼容结果被一次性固化为显式权限", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "permission-compat-cleanup-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");

  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const denied = legacyDeniedPermissions();
    const timestamp = "2026-08-20T00:00:00.000Z";

    database.prepare("UPDATE persons SET permissions = @permissions, permissionTemplateId = NULL, permissionOverrides = '{}' WHERE id = 'person-004'")
      .run({ permissions: JSON.stringify(denied) });
    database.prepare("UPDATE persons SET permissions = @permissions, permissionTemplateId = NULL, permissionOverrides = '{}' WHERE id = 'person-005'")
      .run({ permissions: JSON.stringify(denied) });
    database.prepare("UPDATE persons SET permissions = '[]', permissionTemplateId = NULL, permissionOverrides = '[]' WHERE id = 'person-006'").run();
    database.prepare(`INSERT INTO permission_templates (id, name, description, permissions, status, createdAt, updatedAt)
      VALUES ('legacy-template', '历史受限模板', '', @permissions, 'active', @timestamp, @timestamp)`)
      .run({ permissions: JSON.stringify(denied), timestamp });
    database.prepare("UPDATE persons SET permissionTemplateId = 'legacy-template', permissionOverrides = '{}' WHERE id = 'person-007'").run();

    initializeDatabase();

    const productPersonPermissions = JSON.parse(database.prepare("SELECT permissions FROM persons WHERE id = 'person-004'").get().permissions);
    const marketingPersonPermissions = JSON.parse(database.prepare("SELECT permissions FROM persons WHERE id = 'person-005'").get().permissions);
    const arrayShapedPersonPermissions = JSON.parse(database.prepare("SELECT permissions FROM persons WHERE id = 'person-006'").get().permissions);
    const channelPersonOverrides = JSON.parse(database.prepare("SELECT permissionOverrides FROM persons WHERE id = 'person-007'").get().permissionOverrides);
    const templatePermissions = JSON.parse(database.prepare("SELECT permissions FROM permission_templates WHERE id = 'legacy-template'").get().permissions);

    assert.equal(productPersonPermissions.modules.templateCenter, false);
    assert.equal(marketingPersonPermissions.modules.templateCenter, true);
    assert.equal(Array.isArray(arrayShapedPersonPermissions), false);
    assert.equal(arrayShapedPersonPermissions.modules.templateCenter, true);
    assert.equal(templatePermissions.modules.templateCenter, false);
    assert.equal(channelPersonOverrides.modules.templateCenter, true);

    database.prepare("UPDATE persons SET departmentId = 'dept-product' WHERE id IN ('person-005', 'person-007')").run();
    initializeDatabase();
    assert.equal(JSON.parse(database.prepare("SELECT permissions FROM persons WHERE id = 'person-005'").get().permissions).modules.templateCenter, true);
    assert.equal(JSON.parse(database.prepare("SELECT permissionOverrides FROM persons WHERE id = 'person-007'").get().permissionOverrides).modules.templateCenter, true);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
