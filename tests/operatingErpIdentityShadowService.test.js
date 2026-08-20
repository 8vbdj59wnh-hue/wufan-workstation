import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  calculateOperatingErpIdentityShadow,
  materializeOperatingErpIdentityShadow,
  queryOperatingErpIdentityShadow,
  resolveWangdianIdentityContract,
} from "../server/operatingErpIdentityShadowService.js";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,sourceUpdatedAt TEXT,rawSourceData TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,normalizedObjectCode TEXT,objectType TEXT,sourceType TEXT,updatedAt TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,structureHash TEXT,status TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,erpSkuId TEXT,quantity REAL,status TEXT);
    CREATE TABLE product_erp_mappings(id TEXT PRIMARY KEY,erpSkuId TEXT,productId TEXT,currentState TEXT);
    CREATE TABLE operating_erp_set_members(normalizedCode TEXT PRIMARY KEY,merchantSkuCode TEXT,erpSkuId TEXT,salesObjectId TEXT,lifecycleStatus TEXT);
    CREATE TABLE operating_erp_identity_observations(normalizedCode TEXT PRIMARY KEY,merchantSkuCode TEXT,inOperatingErpSet INTEGER,inOperatingObjectSet INTEGER,goodsStatus TEXT,suiteStatus TEXT,resolvedIdentityType TEXT,identityStatus TEXT,goodsErpSkuId TEXT,suiteSalesObjectId TEXT,sourceMode TEXT,sourceCheckedAt TEXT,sourceUpdatedAt TEXT,detailJson TEXT,calculatedAt TEXT,updatedAt TEXT);
    CREATE TABLE operating_erp_identity_shadow_comparisons(normalizedCode TEXT PRIMARY KEY,merchantSkuCode TEXT,currentIdentityType TEXT,v3IdentityType TEXT,comparisonStatus TEXT,currentSalesObjectId TEXT,projectedSalesObjectCode TEXT,bundleStructureStatus TEXT,productMappingStatus TEXT,detailJson TEXT,calculatedAt TEXT,updatedAt TEXT);
  `);
  const erp = db.prepare("INSERT INTO erp_skus VALUES (?,?,?,?)");
  erp.run("erp-a", "A", "2026-08-20", "{}");
  erp.run("erp-b", "B", "2026-08-20", "{}");
  erp.run("erp-external", "OLD", "2025-01-01", "{}");
  db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?,'active')").run("pm-a", "erp-a", "product-a");
  db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?,'active')").run("pm-b", "erp-b", "product-b");
  const object = db.prepare("INSERT INTO sales_objects VALUES (?,?,?,?,?,?)");
  object.run("so-a", "A", "a", "single", "platform_goods_excel", "2026-08-20");
  object.run("so-bundle", "PACK", "pack", "bundle", "wangdian_suite_api", "2026-08-20");
  db.prepare("INSERT INTO sales_object_structures VALUES (?,?,?,'active')").run("st-a", "so-a", "a");
  db.prepare("INSERT INTO sales_object_structures VALUES (?,?,?,'active')").run("st-pack", "so-bundle", "pack");
  const component = db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?,?,'active')");
  component.run("c-a", "st-a", "so-a", "erp-a", 1);
  component.run("c-b", "st-pack", "so-bundle", "erp-b", 2);
  const member = db.prepare("INSERT INTO operating_erp_set_members VALUES (?,?,?,?,?)");
  member.run("a", "A", "erp-a", "so-a", "active");
  member.run("b", "B", "erp-b", "so-bundle", "active_dependency");
  member.run("pack", "PACK", null, "so-bundle", "active");
  member.run("missing", "MISSING", null, null, "unresolved");
  member.run("old", "OLD", "erp-external", null, "external_unused");
  return db;
}

test("Single由Goods确认", () => {
  assert.deepEqual(resolveWangdianIdentityContract({ goodsFound: true, goodsChecked: true, suiteChecked: true }), {
    goodsStatus: "found", suiteStatus: "not_found", resolvedIdentityType: "single", identityStatus: "confirmed",
  });
});

test("Bundle由Suite确认", () => {
  assert.equal(resolveWangdianIdentityContract({ suiteFound: true, suiteChecked: true, goodsChecked: true }).resolvedIdentityType, "bundle");
});

test("同编码Goods和Suite同时存在时阻断为类型冲突", () => {
  assert.equal(resolveWangdianIdentityContract({ goodsFound: true, suiteFound: true, goodsChecked: true, suiteChecked: true }).identityStatus, "sku_type_conflict");
});

test("两边明确查不到时归为ERP不存在", () => {
  assert.equal(resolveWangdianIdentityContract({ goodsChecked: true, suiteChecked: true }).identityStatus, "erp_not_found");
});

test("API失败与不存在严格区分", () => {
  assert.equal(resolveWangdianIdentityContract({ goodsError: "timeout", suiteChecked: true }).identityStatus, "source_unavailable");
});

test("旺店通已删除身份归为来源冲突而非自动确认", () => {
  assert.equal(resolveWangdianIdentityContract({ suiteFound: true, suiteChecked: true, goodsChecked: true, suiteDeleted: true }).identityStatus, "source_conflict");
});

test("Operating范围外历史ERP不进入身份异常", () => {
  const result = calculateOperatingErpIdentityShadow({ database: fixture() });
  assert(!result.observations.some((item) => item.normalizedCode === "old"));
});

test("Sales Object影子投影覆盖Single与Bundle", () => {
  const result = calculateOperatingErpIdentityShadow({ database: fixture() });
  assert.equal(result.comparisons.find((item) => item.normalizedCode === "a").comparisonStatus, "consistent");
  assert.equal(result.comparisons.find((item) => item.normalizedCode === "pack").bundleStructureStatus, "complete");
});

test("Bundle BOM缺失可识别", () => {
  const db = fixture();
  db.prepare("DELETE FROM sales_object_structure_components WHERE salesObjectId='so-bundle'").run();
  const result = calculateOperatingErpIdentityShadow({ database: db });
  assert.equal(result.comparisons.find((item) => item.normalizedCode === "pack").bundleStructureStatus, "bom_missing");
  db.close();
});

test("Bundle Component缺失可识别", () => {
  const db = fixture();
  const result = calculateOperatingErpIdentityShadow({ database: db, liveObservations: {
    PACK: { goodsChecked: true, suiteChecked: true, suite: { components: [{ skuCode: "NO-SUCH", quantity: 1 }] }, checkedAt: "2026-08-21" },
  } });
  assert.equal(result.comparisons.find((item) => item.normalizedCode === "pack").bundleStructureStatus, "component_missing");
  db.close();
});

test("重复影子物化幂等且不修改正式业务表", () => {
  const db = fixture();
  const before = {
    erp: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
    objects: db.prepare("SELECT COUNT(*) total FROM sales_objects").get().total,
    mappings: db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
  };
  materializeOperatingErpIdentityShadow({ database: db, calculatedAt: "2026-08-21T01:00:00Z" });
  const repeated = materializeOperatingErpIdentityShadow({ database: db, calculatedAt: "2026-08-21T02:00:00Z" });
  assert.equal(queryOperatingErpIdentityShadow({}, { database: db }).total, 4);
  assert.equal(repeated.materialization.observationsChanged, 0);
  assert.equal(repeated.materialization.comparisonsChanged, 0);
  assert.equal(repeated.materialization.staleRowsDeleted, 0);
  assert.deepEqual({
    erp: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total,
    objects: db.prepare("SELECT COUNT(*) total FROM sales_objects").get().total,
    mappings: db.prepare("SELECT COUNT(*) total FROM product_erp_mappings").get().total,
  }, before);
  db.close();
});
