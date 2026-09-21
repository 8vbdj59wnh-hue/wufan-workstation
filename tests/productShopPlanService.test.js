import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { productShopPlanSchema } from '../server/productShopPlanSchema.js';
import { readProductShopPlans,addProductShopPlans,removeProductShopPlan } from '../server/productShopPlanService.js';

test('店铺上下架计划独立保存、校验真实关联，并支持幂等添加和移除',()=>{
 const db=new Database(':memory:');
 try{
 db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE sales_shops(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE erp_goods(id TEXT PRIMARY KEY,goodsName TEXT);
 CREATE TABLE erp_skus(id TEXT PRIMARY KEY,merchantSkuCode TEXT,erpGoodsId TEXT,mainImage TEXT,currentState TEXT);
 CREATE TABLE product_business_profiles(erpSkuId TEXT,displayNameOverride TEXT);
 CREATE TABLE sales_links(id TEXT,shopId TEXT,currentState TEXT);
 CREATE TABLE sales_link_skus(id TEXT,salesLinkId TEXT,currentState TEXT);
 CREATE TABLE sales_link_sku_sales_object_relations(linkSkuId TEXT,salesObjectId TEXT,status TEXT);
 CREATE TABLE sales_object_structures(id TEXT,salesObjectId TEXT,status TEXT);
 CREATE TABLE sales_object_structure_components(structureId TEXT,erpSkuId TEXT,status TEXT);
 INSERT INTO sales_shops VALUES('a','active'),('b','active');
 INSERT INTO erp_goods VALUES('g','玻璃花瓶');
 INSERT INTO erp_skus VALUES('one','HP1-1','g','/image.jpg','active'),('two','HP2-1','g',NULL,'active');
 INSERT INTO sales_links VALUES('l','a','active');
 INSERT INTO sales_link_skus VALUES('ls','l','active');
 INSERT INTO sales_link_sku_sales_object_relations VALUES('ls','object','active');
 INSERT INTO sales_object_structures VALUES('st','object','active');
 INSERT INTO sales_object_structure_components VALUES('st','one','active');`);
 db.exec(productShopPlanSchema);db.exec(productShopPlanSchema);
 assert.deepEqual(readProductShopPlans({shopId:'a',direction:'listing',candidates:true},db).items.map(x=>x.erpSkuId),['two']);
 assert.deepEqual(readProductShopPlans({shopId:'a',direction:'withdrawal',candidates:true},db).items.map(x=>x.erpSkuId),['one']);
 assert.throws(()=>addProductShopPlans({shopId:'a',direction:'withdrawal',erpSkuIds:['two']},'actor',db),/已关联/);
 assert.throws(()=>addProductShopPlans({shopId:'a',direction:'listing',erpSkuIds:['two','one']},'actor',db),/已关联/);
 assert.equal(readProductShopPlans({shopId:'a'},db).items.length,0);
 assert.equal(addProductShopPlans({shopId:'a',direction:'listing',erpSkuIds:['two','two']},'actor',db).added,1);
 assert.equal(addProductShopPlans({shopId:'a',direction:'listing',erpSkuIds:['two']},'actor',db).added,0);
 assert.equal(readProductShopPlans({shopId:'b'},db).items.length,0);
 assert.equal(readProductShopPlans({shopId:'a'},db).items[0].skuCode,'HP2-1');
 assert.equal(addProductShopPlans({shopId:'a',direction:'withdrawal',erpSkuIds:['one']},'actor',db).added,1);
 assert.equal(removeProductShopPlan({shopId:'b',direction:'listing',erpSkuId:'two'},db).removed,0);
 assert.equal(removeProductShopPlan({shopId:'a',direction:'listing',erpSkuId:'two'},db).removed,1);
 assert.equal(db.prepare('SELECT count(*) n FROM erp_skus').get().n,2);
 assert.equal(db.prepare('SELECT count(*) n FROM sales_links').get().n,1);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
