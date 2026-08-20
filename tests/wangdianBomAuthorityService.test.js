import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  calculateBomStructureHash,
  canonicalizeBomComponents,
  closeBomEffectivePeriod,
  compareBomComponents,
  assertWangdianBomManualOverrideAllowed,
  openBomEffectivePeriod,
  resolveBundleBomVersion,
} from "../server/wangdianBomAuthorityService.js";

function fixture() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys=ON");
  database.exec(`
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT NOT NULL,version INTEGER,structureHash TEXT,sourceType TEXT,status TEXT,UNIQUE(id,salesObjectId));
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,erpSkuId TEXT,quantity REAL,status TEXT);
    CREATE TABLE sales_object_structure_effective_periods(
      id TEXT PRIMARY KEY,structureId TEXT NOT NULL,salesObjectId TEXT NOT NULL,validFrom TEXT NOT NULL,validTo TEXT,
      sourceState TEXT NOT NULL,validityBasis TEXT NOT NULL,sourceUpdatedAt TEXT,firstVerifiedAt TEXT NOT NULL,lastVerifiedAt TEXT NOT NULL,
      syncedAt TEXT NOT NULL,sourceReferenceJson TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
      FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId));
    CREATE UNIQUE INDEX one_open_period ON sales_object_structure_effective_periods(salesObjectId) WHERE validTo IS NULL AND sourceState='active';
    INSERT INTO sales_objects VALUES ('bundle');
    INSERT INTO sales_object_structures VALUES ('v1','bundle',1,'h1','wangdian_suite_api','active');
    INSERT INTO sales_object_structures VALUES ('v2','bundle',2,'h2','wangdian_suite_api','superseded');
    INSERT INTO sales_object_structure_components VALUES ('c1','v1','bundle','erp-a',2,'active');
    INSERT INTO sales_object_structure_components VALUES ('c2','v2','bundle','erp-b',3,'active');
  `);
  return database;
}

test("BOM组件排序稳定", () => assert.deepEqual(canonicalizeBomComponents([{ erpSkuId: "b", quantity: 1 }, { erpSkuId: "a", quantity: 2 }]), [{ erpSkuId: "a", quantity: 2 }, { erpSkuId: "b", quantity: 1 }]));
test("重复组件会合并数量", () => assert.deepEqual(canonicalizeBomComponents([{ erpSkuId: "a", quantity: 1 }, { erpSkuId: "a", quantity: 2 }]), [{ erpSkuId: "a", quantity: 3 }]));
test("缺失组件身份被拒绝", () => assert.throws(() => canonicalizeBomComponents([{ quantity: 1 }]), /bundle_component_not_found/u));
test("无效数量被拒绝", () => assert.throws(() => canonicalizeBomComponents([{ erpSkuId: "a", quantity: 0 }]), /invalid_bundle_component_quantity/u));
test("结构Hash不受输入顺序影响", () => assert.equal(calculateBomStructureHash([{ erpSkuId: "a", quantity: 1 }, { erpSkuId: "b", quantity: 2 }]), calculateBomStructureHash([{ erpSkuId: "b", quantity: 2 }, { erpSkuId: "a", quantity: 1 }])));
test("首次验证建立有效期", () => { const db = fixture(); assert.equal(openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }).outcome, "opened"); });
test("相同BOM重复验证保持幂等", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }); assert.equal(openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-21T00:00:00Z" }, { database: db }).outcome, "verified"); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structure_effective_periods").get().total, 1); });
test("Component变化关闭旧期并开启新期", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }); assert.equal(openBomEffectivePeriod({ structureId: "v2", salesObjectId: "bundle", validFrom: "2026-08-21T00:00:00Z" }, { database: db }).outcome, "changed"); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structure_effective_periods WHERE validTo IS NULL").get().total, 1); });
test("Bundle删除保留历史并关闭当前期", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }); assert.equal(closeBomEffectivePeriod("bundle", "2026-08-21T00:00:00Z", { database: db }).closed, 1); assert.equal(db.prepare("SELECT sourceState FROM sales_object_structure_effective_periods").get().sourceState, "source_removed"); });
test("Bundle重新启用可建立同结构新期间", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }); closeBomEffectivePeriod("bundle", "2026-08-21T00:00:00Z", { database: db }); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-22T00:00:00Z" }, { database: db }); assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_object_structure_effective_periods").get().total, 2); });
test("销售日期选择对应BOM版本", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z", validityBasis: "exact" }, { database: db }); openBomEffectivePeriod({ structureId: "v2", salesObjectId: "bundle", validFrom: "2026-08-22T00:00:00Z", validityBasis: "inferred" }, { database: db }); assert.equal(resolveBundleBomVersion({ salesObjectId: "bundle", saleDate: "2026-08-20" }, { database: db }).structure.structureId, "v1"); assert.equal(resolveBundleBomVersion({ salesObjectId: "bundle", saleDate: "2026-08-23" }, { database: db }).status, "inferred"); });
test("无历史有效期不会拿当前BOM冒充精确历史", () => { const db = fixture(); openBomEffectivePeriod({ structureId: "v1", salesObjectId: "bundle", validFrom: "2026-08-20T00:00:00Z" }, { database: db }); assert.equal(resolveBundleBomVersion({ salesObjectId: "bundle", saleDate: "2026-08-01" }, { database: db }).status, "unknown"); });
test("组件差异与数量差异分别识别", () => { assert.equal(compareBomComponents([{ erpSkuId: "a", quantity: 1 }], [{ erpSkuId: "b", quantity: 1 }]).status, "component_conflict"); assert.equal(compareBomComponents([{ erpSkuId: "a", quantity: 1 }], [{ erpSkuId: "a", quantity: 2 }]).status, "quantity_conflict"); });
test("人工覆盖旺店通权威BOM被拒绝", () => assert.throws(() => assertWangdianBomManualOverrideAllowed({ sourceType: "wangdian_suite_api", sourceState: "active" }, [{ erpSkuId: "a", quantity: 1 }], [{ erpSkuId: "a", quantity: 2 }]), (error) => error.code === "wangdian_bom_manual_override_blocked"));
