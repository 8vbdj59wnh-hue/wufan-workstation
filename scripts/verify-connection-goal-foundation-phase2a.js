import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "connection-goal-phase2a-"));
process.env.WUFAN_DB_PATH = path.join(temporaryDirectory, "verification.db");

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const {
  readConnectionGoalFoundation,
  setConnectionBusinessPositioning,
} = await import("../server/connectionGoalFoundationService.js");

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  const timestamp = "2026-08-18T08:00:00.000Z";
  const owner = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
  const viewer = database.prepare("SELECT id FROM persons WHERE status='active' AND id<>? ORDER BY id LIMIT 1").get(owner.id);
  assert.ok(owner?.id, "缺少用于验证的负责人");
  assert.ok(viewer?.id, "缺少用于验证的普通查看人");

  const templates = database.prepare("SELECT * FROM connection_goal_templates WHERE status='active' ORDER BY positioningType").all();
  assert.equal(templates.length, 4);
  assert.deepEqual(templates.map((item) => item.windowDays), [30, 30, 30, 30]);
  const weights = database.prepare(`SELECT t.positioningType,m.metricCode,m.weight
    FROM connection_goal_templates t JOIN connection_goal_template_metrics m ON m.templateId=t.id
    WHERE t.status='active' ORDER BY t.positioningType,m.sortOrder`).all();
  assert.equal(weights.length, 8);
  const expectedWeights = {
    sales_growth: [0.7, 0.3],
    balanced_sales: [0.5, 0.5],
    long_tail: [0.6, 0.4],
    profit_contribution: [0.3, 0.7],
  };
  for (const [positioningType, expected] of Object.entries(expectedWeights)) {
    const actual = weights.filter((item) => item.positioningType === positioningType).map((item) => item.weight);
    assert.deepEqual(actual, expected);
    assert.equal(actual.reduce((sum, value) => sum + value, 0), 1);
  }
  initializeDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_templates").get().count, 4);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM connection_goal_template_metrics").get().count, 8);

  database.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('phase2a-shop','taobao','Phase 2A店铺','phase 2a店铺','Phase 2A店铺','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`INSERT INTO sales_links
    (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES ('phase2a-link','phase2a-shop','phase2a-goods','Phase 2A验证链接','strong','manual','complete','active',?,?)`).run(timestamp, timestamp);
  database.prepare(`UPDATE sales_links SET displayName='Phase 2A验证链接',ownerId=?,managementStatus='active',managementLevel='new',managementOriginSource='manual' WHERE id='phase2a-link'`).run(owner.id);

  const protectedTables = [
    "sales_links",
    "sales_link_skus",
    "connection_sku_sales_daily_facts",
  ];
  const countRows = () => Object.fromEntries(protectedTables.map((table) => [
    table,
    database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,
  ]));
  const before = countRows();

  const initial = readConnectionGoalFoundation("phase2a-link", { database, userId: owner.id });
  assert.equal(initial.current, null);
  assert.equal(initial.templates.length, 4);
  assert.equal(initial.permissions.canEdit, true);
  assert.equal(readConnectionGoalFoundation("phase2a-link", { database, userId: viewer.id }).permissions.canEdit, false);
  assert.throws(() => setConnectionBusinessPositioning("phase2a-link", {
    positioningType: "sales_growth",
    decisionReason: "无权限验证",
  }, { database, userId: viewer.id }), /仅管理员或该链接负责人/);
  const first = setConnectionBusinessPositioning("phase2a-link", {
    positioningType: "sales_growth",
  }, { database, userId: owner.id });
  assert.equal(first.changed, true);
  assert.equal(first.current.positioningType, "sales_growth");
  assert.equal(first.current.decisionReason, "人工修改经营定位");
  assert.equal(first.currentTemplate.positioningType, "sales_growth");

  const second = setConnectionBusinessPositioning("phase2a-link", {
    positioningType: "balanced_sales",
    decisionReason: "负责人复核后调整定位",
  }, { database, userId: owner.id });
  assert.equal(second.current.positioningType, "balanced_sales");
  assert.equal(second.history.length, 2);
  assert.equal(second.history.filter((item) => item.status === "active").length, 1);
  assert.ok(second.history.find((item) => item.status === "historical")?.effectiveTo);

  const repeated = setConnectionBusinessPositioning("phase2a-link", {
    positioningType: "balanced_sales",
    decisionReason: "重复提交验证",
  }, { database, userId: owner.id });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.history.length, 2);
  assert.deepEqual(countRows(), before);
  assert.throws(() => database.prepare("DELETE FROM connection_goal_templates WHERE id=?").run(templates[0].id), /不可直接删除/);
  assert.equal(database.pragma("foreign_key_check").length, 0);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");

  console.log(JSON.stringify({
    templates: templates.length,
    metrics: weights.length,
    activePositionings: second.history.filter((item) => item.status === "active").length,
    positioningHistory: second.history.length,
    protectedTableCounts: before,
    integrity: "ok",
  }, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
