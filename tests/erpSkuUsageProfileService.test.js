import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";
import { classifyErpSkuUsages, confirmErpSkuUsageProfile, readErpSkuUsageInventoryGovernance, readUnknownErpUsageConvergence } from "../server/erpSkuUsageProfileService.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE persons(id TEXT PRIMARY KEY);
    CREATE TABLE erp_goods(id TEXT PRIMARY KEY,goodsName TEXT,shortName TEXT,category TEXT,productType TEXT,rawSourceData TEXT);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,specificationName TEXT,rawSourceData TEXT,erpGoodsId TEXT);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE product_erp_mappings(erpSkuId TEXT,productId TEXT,currentState TEXT);
    CREATE TABLE operating_erp_set_members(normalizedCode TEXT PRIMARY KEY,erpSkuId TEXT,salesObjectId TEXT,lifecycleStatus TEXT);
    CREATE TABLE operating_erp_set_evidence(normalizedCode TEXT,sourceType TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT,erpSkuId TEXT,saleDate TEXT,salesAmount REAL);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectType TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,status TEXT,sourceType TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT,structureId TEXT,erpSkuId TEXT,status TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT,salesObjectId TEXT,status TEXT);
    CREATE TABLE erp_sku_inventory_daily_summaries(id TEXT,erpSkuId TEXT,businessDate TEXT,stockNum REAL,availableSendStock REAL,inventoryCostAmount REAL,updatedAt TEXT);
    CREATE TABLE erp_sku_usage_profiles(erpSkuId TEXT PRIMARY KEY,confirmedPrimaryUsage TEXT,confirmedSaleGoods INTEGER,confirmedBundleComponent INTEGER,confirmedBy TEXT,confirmedAt TEXT,evidenceNote TEXT,createdAt TEXT,updatedAt TEXT);
  `);
  db.prepare("INSERT INTO persons VALUES (?)").run("admin");
  const seed = [
    ["sale","SALE-1","花瓶","玻璃花瓶"],
    ["bundle","COMP-1","组合组件","无"],
    ["both","BOTH-1","直接兼组合","玻璃花瓶"],
    ["pack","DBCL-1","纸箱","打包材料"],
    ["consumable","AUX-1","生产辅料","生产辅料"],
    ["candidate","BOX-1","纸箱候选","无"],
    ["unknown","UNK-1","未知对象","无"],
    ["mappingConflict","DBCL-2","包装盒","打包材料"],
    ["sellableMapped","HP-SELL","明确花瓶商品","玻璃花瓶"],
    ["mappedOnly","MAP-ONLY","只有映射","无"],
    ["noEvidence","NO-EVIDENCE","无经营证据","无"],
  ];
  for (const [id,code,name,category] of seed) {
    db.prepare("INSERT INTO erp_goods VALUES (?,?,?,?,?,?)").run(`g-${id}`,name,name,category,"1",JSON.stringify({ class_name: category, goods_type: 1 }));
    db.prepare("INSERT INTO erp_skus VALUES (?,?,?,?,?)").run(id,code,name,"{}",`g-${id}`);
    db.prepare("INSERT INTO operating_erp_set_members VALUES (?,?,?,?)").run(code.toLowerCase(),id,null,"external_unused");
    db.prepare("INSERT INTO erp_sku_inventory_daily_summaries VALUES (?,?,?,?,?,?,?)").run(`i-${id}`,id,"2026-08-20",10,10,100,"2026-08-20T00:00:00Z");
  }
  db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?)").run("f-sale","sale","2026-08-19",100);
  db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?)").run("f-both","both","2026-08-19",100);
  db.prepare("INSERT INTO products VALUES (?,?)").run("p-conflict","错误包装Product");
  db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?)").run("mappingConflict","p-conflict","active");
  db.prepare("INSERT INTO products VALUES (?,?)").run("p-sellable","花瓶Product");
  db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?)").run("sellableMapped","p-sellable","active");
  db.prepare("INSERT INTO products VALUES (?,?)").run("p-mapped-only","待确认Product");
  db.prepare("INSERT INTO product_erp_mappings VALUES (?,?,?)").run("mappedOnly","p-mapped-only","active");
  db.prepare("INSERT INTO sales_objects VALUES (?,?,?)").run("bundle-parent","bundle","active");
  db.prepare("INSERT INTO sales_object_structures VALUES (?,?,?,?)").run("bundle-st","bundle-parent","active","wangdian_suite_api");
  db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?)").run("c1","bundle-st","bundle","active");
  db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?)").run("c2","bundle-st","both","active");
  db.prepare("INSERT INTO operating_erp_set_members VALUES (?,?,?,?)").run("suite-1",null,"bundle-parent","active");
  return db;
}

const byId = (db) => new Map(classifyErpSkuUsages({}, { database: db }).map((row) => [row.erpSkuId,row]));

test("直接销售事实形成sale_goods强证据", () => { const db=fixture(); assert.equal(byId(db).get("sale").primaryUsage,"sale_goods"); db.close(); });
test("当前旺店通BOM组件增加bundle_component标签", () => { const db=fixture(); assert.equal(byId(db).get("bundle").bundleComponent,true); db.close(); });
test("ERP SKU可以同时直接销售和参与Bundle", () => { const db=fixture(); const row=byId(db).get("both"); assert.equal(row.saleGoods,true); assert.equal(row.bundleComponent,true); db.close(); });
test("旺店通结构化打包材料分类可高置信确认", () => { const db=fixture(); const row=byId(db).get("pack"); assert.equal(row.primaryUsage,"packaging_material"); assert.equal(row.confidence,"high"); db.close(); });
test("旺店通结构化耗材辅料分类可高置信确认", () => { const db=fixture(); assert.equal(byId(db).get("consumable").primaryUsage,"consumable_auxiliary"); db.close(); });
test("只有名称关键词时保持候选而不自动确认", () => { const db=fixture(); const row=byId(db).get("candidate"); assert.equal(row.primaryUsage,"unknown"); assert.equal(row.classificationStatus,"packaging_candidate"); db.close(); });
test("没有可靠证据时保持unknown", () => { const db=fixture(); assert.equal(byId(db).get("unknown").classificationStatus,"unknown"); db.close(); });
test("管理员可以确认主用途和独立能力标签", () => { const db=fixture(); const result=confirmErpSkuUsageProfile("unknown",{primaryUsage:"sale_goods",saleGoods:true,bundleComponent:true,evidenceNote:"人工核对"},{database:db,confirmedBy:"admin"}); assert.equal(result.profile.confirmedBundleComponent,1); db.close(); });
test("人工确认不会被自动证据静默覆盖", () => { const db=fixture(); confirmErpSkuUsageProfile("candidate",{primaryUsage:"consumable_auxiliary",evidenceNote:"已核对"},{database:db,confirmedBy:"admin"}); assert.equal(byId(db).get("candidate").primaryUsage,"consumable_auxiliary"); db.close(); });
test("人工确认与强结构化证据不同时进入usage_conflict", () => { const db=fixture(); confirmErpSkuUsageProfile("pack",{primaryUsage:"sale_goods",saleGoods:true,evidenceNote:"待复核"},{database:db,confirmedBy:"admin"}); assert.equal(byId(db).get("pack").classificationStatus,"usage_conflict"); db.close(); });
test("非经营销售商品库存进入产品库存风险", () => { const db=fixture(); const result=readErpSkuUsageInventoryGovernance({}, {database:db}); assert.ok(result.items.some((row)=>row.erpSkuId==="sale"&&row.governanceBucket==="product_inventory_risk")); db.close(); });
test("包材不进入产品清仓而进入供应链库存", () => { const db=fixture(); const row=readErpSkuUsageInventoryGovernance({}, {database:db}).items.find((item)=>item.erpSkuId==="pack"); assert.equal(row.governanceBucket,"supply_chain_inventory"); db.close(); });
test("Active Dependency组件不会进入非经营库存清单", () => { const db=fixture(); db.prepare("UPDATE operating_erp_set_members SET lifecycleStatus='active_dependency' WHERE erpSkuId='bundle'").run(); assert.ok(!readErpSkuUsageInventoryGovernance({}, {database:db}).items.some((row)=>row.erpSkuId==="bundle")); db.close(); });
test("非销售用途存在Product Mapping时进入映射冲突统计", () => { const db=fixture(); assert.equal(readErpSkuUsageInventoryGovernance({}, {database:db}).summary.productMappingConflictCount,1); db.close(); });
test("多标签统计不重复累计主治理桶且确认幂等", () => { const db=fixture(); const first=confirmErpSkuUsageProfile("unknown",{primaryUsage:"sale_goods",saleGoods:true,bundleComponent:true,evidenceNote:"核对"},{database:db,confirmedBy:"admin"}); const second=confirmErpSkuUsageProfile("unknown",{primaryUsage:"sale_goods",saleGoods:true,bundleComponent:true,evidenceNote:"核对"},{database:db,confirmedBy:"admin"}); const result=readErpSkuUsageInventoryGovernance({}, {database:db}); assert.equal(first.idempotent,false); assert.equal(second.idempotent,true); assert.equal(Object.values(result.summary.buckets).reduce((sum,row)=>sum+row.erpSkuCount,0),result.summary.total.erpSkuCount); db.close(); });

test("Unknown加Product Mapping进入P1治理", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({productMappingOnly:true},{database:db}).items.find((item)=>item.erpSkuId==="mappedOnly"); assert.equal(row.priority,"P1_product_mapping"); db.close(); });
test("明确商品分类加Product Mapping只推荐sale_goods", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({productMappingOnly:true},{database:db}).items.find((item)=>item.erpSkuId==="sellableMapped"); assert.equal(row.recommendedPrimaryUsage,"sale_goods"); assert.equal(row.recommendationStatus,"recommended_not_applied"); assert.equal(row.primaryUsage,"unknown"); db.close(); });
test("只有Product Mapping不能自动推荐销售商品", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({productMappingOnly:true},{database:db}).items.find((item)=>item.erpSkuId==="mappedOnly"); assert.equal(row.recommendedPrimaryUsage,"unknown"); db.close(); });
test("历史销售商品不再属于Unknown治理", () => { const db=fixture(); assert.ok(!readUnknownErpUsageConvergence({}, {database:db}).items.some((item)=>item.erpSkuId==="sale")); assert.equal(byId(db).get("sale").primaryUsage,"sale_goods"); db.close(); });
test("Bundle Component Unknown保留组件标签而不改主用途", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({}, {database:db}).items.find((item)=>item.erpSkuId==="bundle"); assert.equal(row.bundleComponent,true); assert.equal(row.recommendedPrimaryUsage,"unknown"); db.close(); });
test("Unknown有库存进入P2治理", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({}, {database:db}).items.find((item)=>item.erpSkuId==="unknown"); assert.equal(row.priority,"P2_inventory"); db.close(); });
test("完全无经营证据Unknown允许长期保持P4", () => { const db=fixture(); db.prepare("DELETE FROM erp_sku_inventory_daily_summaries WHERE erpSkuId='noEvidence'").run(); const row=readUnknownErpUsageConvergence({}, {database:db}).items.find((item)=>item.erpSkuId==="noEvidence"); assert.equal(row.priority,"P4_no_operating_evidence"); db.close(); });
test("用途推荐不改变经营生命周期", () => { const db=fixture(); const row=readUnknownErpUsageConvergence({}, {database:db}).items.find((item)=>item.erpSkuId==="sellableMapped"); assert.equal(row.operatingLifecycleStatus,"external_unused"); db.close(); });
test("人工确认后对象退出Unknown治理且不被推荐覆盖", () => { const db=fixture(); confirmErpSkuUsageProfile("sellableMapped",{primaryUsage:"sale_goods",saleGoods:true,evidenceNote:"分类与档案核对"},{database:db,confirmedBy:"admin"}); assert.ok(!readUnknownErpUsageConvergence({}, {database:db}).items.some((item)=>item.erpSkuId==="sellableMapped")); db.close(); });
test("推荐用途不自动写入确认表", () => { const db=fixture(); readUnknownErpUsageConvergence({}, {database:db}); assert.equal(db.prepare("SELECT COUNT(*) count FROM erp_sku_usage_profiles").get().count,0); db.close(); });
test("库存风险影子重算包含高置信销售商品推荐", () => { const db=fixture(); const result=readUnknownErpUsageConvergence({}, {database:db}); assert.ok(result.summary.projectedNonOperatingSaleGoodsInventory.erpSkuCount>=1); assert.ok(result.summary.projectedNonOperatingSaleGoodsInventory.inventoryAmount>0); db.close(); });
test("非旺店通BOM的Dependency证据进入经营视图复核", () => { const db=fixture(); db.prepare("UPDATE operating_erp_set_members SET lifecycleStatus='active_dependency' WHERE erpSkuId='sellableMapped'").run(); const row=readUnknownErpUsageConvergence({}, {database:db}).items.find((item)=>item.erpSkuId==="sellableMapped"); assert.equal(row.affectsCurrentProductView,true); assert.equal(row.bundleEvidenceGap,true); db.close(); });
