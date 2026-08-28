import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const legacyIndexes = Object.freeze({
  idx_product_marketing_assets_product: ["product_marketing_assets", ["productId"]],
  idx_action_products_action: ["action_products", ["actionId"]],
  idx_action_products_product: ["action_products", ["productId"]],
  idx_product_lifecycle_events_product_time: ["product_lifecycle_events", ["productId", "changedAt"]],
  idx_product_health_records_status_time: ["product_health_records", ["healthStatus", "updatedAt"]],
  idx_product_issues_product_status: ["product_issues", ["productId", "status", "updatedAt"]],
  idx_product_improvements_product_status: ["product_improvements", ["productId", "status", "updatedAt"]],
  idx_product_strategy_current: ["product_strategy_versions", ["productId"]],
  idx_product_strategy_history: ["product_strategy_versions", ["productId", "version"]],
  idx_product_insights_product_type: ["product_insights", ["productId", "insightType", "updatedAt"]],
  idx_product_insights_improvement: ["product_insights", ["relatedImprovementId"]],
  idx_product_insights_action: ["product_insights", ["relatedActionId"]],
  idx_product_clearance_plans_active: ["product_clearance_plans", ["productId"]],
  idx_product_clearance_plans_status_end: ["product_clearance_plans", ["status", "targetEndDate", "updatedAt"]],
});

const extensionTables = Object.freeze([
  "product_marketing_assets", "action_products", "product_lifecycle_events", "product_health_records",
  "product_issues", "product_improvements", "product_strategy_versions", "product_insights", "product_clearance_plans",
]);

function schemaSnapshot(database) {
  return database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all();
}

function dataSnapshot(database) {
  const domains = Object.fromEntries(extensionTables.map((table) => [table, database.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN erpSkuId IS NOT NULL THEN 1 ELSE 0 END) erpSkuIds,
    SUM(CASE WHEN productId IS NOT NULL THEN 1 ELSE 0 END) legacyProductIds FROM ${table}`).get()]));
  return {
    profiles: database.prepare("SELECT COUNT(*) total FROM product_business_profiles").get().total,
    products: database.prepare("SELECT COUNT(*) total FROM products").get().total,
    mappings: database.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
    domains,
  };
}

function assertDatabaseHealthy(database) {
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(database.pragma("foreign_key_check"), []);
}

function assertLegacyIndexes(database) {
  for (const [name, [table, columns]] of Object.entries(legacyIndexes)) {
    const index = database.prepare("SELECT tbl_name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    assert.equal(index?.tbl_name, table, `${name} 应在同轮迁移后存在`);
    assert.deepEqual(database.prepare(`PRAGMA index_info(${name})`).all().map((item) => item.name), columns, `${name} 字段应保持不变`);
  }
}

function downgradeProductExtensions(database) {
  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP TABLE product_business_profiles;

    CREATE TABLE product_marketing_assets_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,positioning TEXT,targetAudience TEXT,usageScenariosJson TEXT NOT NULL DEFAULT '[]',
      sellingPointsJson TEXT NOT NULL DEFAULT '[]',productStory TEXT,keywordsJson TEXT NOT NULL DEFAULT '[]',createdBy TEXT,updatedBy TEXT,
      createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    INSERT INTO product_marketing_assets_legacy SELECT id,productId,positioning,targetAudience,usageScenariosJson,sellingPointsJson,productStory,keywordsJson,createdBy,updatedBy,createdAt,updatedAt FROM product_marketing_assets;
    CREATE TABLE action_products_legacy (id TEXT PRIMARY KEY,actionId TEXT NOT NULL,productId TEXT NOT NULL,createdAt TEXT,UNIQUE(actionId,productId));
    INSERT INTO action_products_legacy SELECT id,actionId,productId,createdAt FROM action_products;
    CREATE TABLE product_lifecycle_events_legacy (id TEXT PRIMARY KEY,productId TEXT NOT NULL,fromStatus TEXT,toStatus TEXT NOT NULL,reason TEXT,changedBy TEXT,changedAt TEXT NOT NULL);
    INSERT INTO product_lifecycle_events_legacy SELECT id,productId,fromStatus,toStatus,reason,changedBy,changedAt FROM product_lifecycle_events;
    CREATE TABLE product_health_records_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,snapshotKey TEXT NOT NULL,healthScore REAL,healthStatus TEXT NOT NULL,metricsJson TEXT NOT NULL DEFAULT '{}',
      problemsJson TEXT NOT NULL DEFAULT '[]',suggestionsJson TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(productId,snapshotKey)
    );
    INSERT INTO product_health_records_legacy SELECT id,productId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt FROM product_health_records;
    CREATE TABLE product_issues_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,healthRecordId TEXT NOT NULL,issueType TEXT NOT NULL,title TEXT NOT NULL,severity TEXT NOT NULL,
      detailJson TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'open',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(healthRecordId,issueType)
    );
    INSERT INTO product_issues_legacy SELECT id,productId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt FROM product_issues;
    CREATE TABLE product_improvements_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,issueId TEXT NOT NULL,actionId TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned',
      beforeMetricsJson TEXT NOT NULL DEFAULT '{}',afterMetricsJson TEXT NOT NULL DEFAULT '{}',improvementMeasures TEXT,resultSummary TEXT,completedAt TEXT,
      createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(issueId,actionId)
    );
    INSERT INTO product_improvements_legacy SELECT id,productId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,improvementMeasures,resultSummary,completedAt,createdAt,updatedAt FROM product_improvements;
    CREATE TABLE product_strategy_versions_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'current',effectiveAt TEXT NOT NULL,endedAt TEXT,
      changedBy TEXT,contentJson TEXT NOT NULL DEFAULT '{}',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(productId,version)
    );
    INSERT INTO product_strategy_versions_legacy SELECT id,productId,version,status,effectiveAt,endedAt,changedBy,contentJson,createdAt,updatedAt FROM product_strategy_versions;
    CREATE TABLE product_insights_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,insightType TEXT NOT NULL,content TEXT NOT NULL,source TEXT NOT NULL,importance INTEGER,description TEXT,
      frequencyText TEXT,note TEXT,impactLevel TEXT,handlingStatus TEXT,opportunityType TEXT,priority TEXT,status TEXT,relatedStrategyVersionId TEXT,
      relatedImprovementId TEXT,relatedActionId TEXT,providerId TEXT NOT NULL DEFAULT 'manual',createdBy TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    INSERT INTO product_insights_legacy SELECT id,productId,insightType,content,source,importance,description,frequencyText,note,impactLevel,handlingStatus,
      opportunityType,priority,status,relatedStrategyVersionId,relatedImprovementId,relatedActionId,providerId,createdBy,createdAt,updatedAt FROM product_insights;
    CREATE TABLE product_clearance_plans_legacy (
      id TEXT PRIMARY KEY,productId TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',startDate TEXT NOT NULL,targetDays INTEGER NOT NULL,targetEndDate TEXT NOT NULL,
      initialInventoryQuantity REAL,targetInventoryQuantity REAL NOT NULL DEFAULT 0,note TEXT,createdBy TEXT,completedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    INSERT INTO product_clearance_plans_legacy SELECT id,productId,status,startDate,targetDays,targetEndDate,initialInventoryQuantity,targetInventoryQuantity,note,createdBy,completedAt,createdAt,updatedAt FROM product_clearance_plans;

    DROP TABLE product_insights; DROP TABLE product_improvements; DROP TABLE product_issues; DROP TABLE product_health_records;
    DROP TABLE product_strategy_versions; DROP TABLE product_marketing_assets; DROP TABLE product_lifecycle_events; DROP TABLE product_clearance_plans; DROP TABLE action_products;
    ALTER TABLE product_health_records_legacy RENAME TO product_health_records;
    ALTER TABLE product_issues_legacy RENAME TO product_issues;
    ALTER TABLE product_improvements_legacy RENAME TO product_improvements;
    ALTER TABLE product_strategy_versions_legacy RENAME TO product_strategy_versions;
    ALTER TABLE product_insights_legacy RENAME TO product_insights;
    ALTER TABLE product_marketing_assets_legacy RENAME TO product_marketing_assets;
    ALTER TABLE product_lifecycle_events_legacy RENAME TO product_lifecycle_events;
    ALTER TABLE product_clearance_plans_legacy RENAME TO product_clearance_plans;
    ALTER TABLE action_products_legacy RENAME TO action_products;

    CREATE INDEX idx_product_marketing_assets_product ON product_marketing_assets(productId);
    CREATE INDEX idx_action_products_action ON action_products(actionId);
    CREATE INDEX idx_action_products_product ON action_products(productId);
    CREATE INDEX idx_product_lifecycle_events_product_time ON product_lifecycle_events(productId,changedAt DESC);
    CREATE INDEX idx_product_health_records_status_time ON product_health_records(healthStatus,updatedAt DESC);
    CREATE INDEX idx_product_issues_product_status ON product_issues(productId,status,updatedAt DESC);
    CREATE INDEX idx_product_improvements_product_status ON product_improvements(productId,status,updatedAt DESC);
    CREATE UNIQUE INDEX idx_product_strategy_current ON product_strategy_versions(productId) WHERE status='current';
    CREATE INDEX idx_product_strategy_history ON product_strategy_versions(productId,version DESC);
    CREATE INDEX idx_product_insights_product_type ON product_insights(productId,insightType,updatedAt DESC);
    CREATE INDEX idx_product_insights_improvement ON product_insights(relatedImprovementId) WHERE relatedImprovementId IS NOT NULL;
    CREATE INDEX idx_product_insights_action ON product_insights(relatedActionId) WHERE relatedActionId IS NOT NULL;
    CREATE UNIQUE INDEX idx_product_clearance_plans_active ON product_clearance_plans(productId) WHERE status='active';
    CREATE INDEX idx_product_clearance_plans_status_end ON product_clearance_plans(status,targetEndDate,updatedAt DESC);
  `);
  database.pragma("foreign_keys = ON");
}

test("Phase B 经营扩展表重建在第一次初始化即恢复完整 Schema 且数据幂等", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-business-migration-idempotency-"));
  const databasePath = path.join(directory, "workstation.db");
  process.env.WUFAN_DB_PATH = databasePath;
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const timestamp = "2026-08-28T08:00:00.000Z";
    const userId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    const actionId = "process-idempotency";
    database.prepare(`INSERT INTO process_instances(id,templateId,templateVersion,name,goalId,initiatorId,status,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(actionId, "template-idempotency", 1, "迁移幂等行动", "goal-idempotency", userId, "draft", timestamp, timestamp);
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("product-idempotency", "IDEMP001", "迁移幂等样本", "成长", timestamp, timestamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("erp-goods-idempotency", "IDEMP", "迁移幂等样本", "{}", "active", timestamp, timestamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-idempotency", "IDEMP001", "erp-goods-idempotency", "{}", "fixture", "fixture", "active", timestamp, timestamp);
    database.prepare(`INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,inventoryCurrentState,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run("mapping-idempotency", "product-idempotency", "erp-goods-idempotency", "erp-sku-idempotency", "IDEMP001", "manual", "active", "active", timestamp, timestamp);
    database.prepare("INSERT INTO product_marketing_assets(id,productId,positioning,createdAt,updatedAt) VALUES(?,?,?,?,?)").run("marketing-idempotency", "product-idempotency", "定位", timestamp, timestamp);
    database.prepare("INSERT INTO action_products(id,actionId,productId,createdAt) VALUES(?,?,?,?)").run("action-product-idempotency", actionId, "product-idempotency", timestamp);
    database.prepare("INSERT INTO product_lifecycle_events(id,productId,toStatus,changedBy,changedAt) VALUES(?,?,?,?,?)").run("lifecycle-idempotency", "product-idempotency", "成长", userId, timestamp);
    database.prepare("INSERT INTO product_health_records(id,productId,snapshotKey,healthStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?)").run("health-idempotency", "product-idempotency", "fixture", "healthy", timestamp, timestamp);
    database.prepare("INSERT INTO product_issues(id,productId,healthRecordId,issueType,title,severity,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)").run("issue-idempotency", "product-idempotency", "health-idempotency", "sales", "销售问题", "attention", timestamp, timestamp);
    database.prepare("INSERT INTO product_improvements(id,productId,issueId,actionId,title,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)").run("improvement-idempotency", "product-idempotency", "issue-idempotency", actionId, "改善事项", timestamp, timestamp);
    database.prepare("INSERT INTO product_strategy_versions(id,productId,version,effectiveAt,contentJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)").run("strategy-idempotency", "product-idempotency", 1, timestamp, "{}", timestamp, timestamp);
    database.prepare("INSERT INTO product_insights(id,productId,insightType,content,source,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)").run("insight-idempotency", "product-idempotency", "attention", "关注设计", "manual", timestamp, timestamp);
    database.prepare("INSERT INTO product_clearance_plans(id,productId,startDate,targetDays,targetEndDate,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)").run("clearance-idempotency", "product-idempotency", "2026-08-28", 30, "2026-09-27", timestamp, timestamp);
    closeDatabase();

    const legacy = new Database(databasePath);
    downgradeProductExtensions(legacy);
    assertLegacyIndexes(legacy);
    legacy.close();

    initializeDatabase();
    const firstDatabase = getDatabase();
    assertLegacyIndexes(firstDatabase);
    assertDatabaseHealthy(firstDatabase);
    const firstSchema = schemaSnapshot(firstDatabase);
    const firstData = dataSnapshot(firstDatabase);
    assert.equal(firstDatabase.prepare("SELECT COUNT(*) total FROM product_business_profiles WHERE erpSkuId='erp-sku-idempotency'").get().total, 1);
    for (const table of extensionTables) {
      assert.deepEqual(firstDatabase.prepare(`SELECT productId,erpSkuId FROM ${table} WHERE productId='product-idempotency' LIMIT 1`).get(),
        { productId: "product-idempotency", erpSkuId: "erp-sku-idempotency" }, `${table} 应保留 Legacy productId 并回填 ERP SKU`);
    }

    initializeDatabase();
    const secondDatabase = getDatabase();
    assertLegacyIndexes(secondDatabase);
    assertDatabaseHealthy(secondDatabase);
    assert.deepEqual(schemaSnapshot(secondDatabase), firstSchema);
    assert.deepEqual(dataSnapshot(secondDatabase), firstData);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
