import test from 'node:test';import assert from 'node:assert/strict';
import {rankContentRecommendations} from '../../server/contentCenterRecommendations.js';
test('品牌隔离、过滤仿真花、按货品汇总',()=>{
 const items=Array.from({length:25},(_,i)=>({erpSkuId:String(i),sku:String(i),name:'花瓶',brand:'半然',sales:{totalPhysicalContribution:i+1}}));
 const meta=new Map(items.map((p,i)=>[p.erpSkuId,{inBrandShop:true,erpGoodsId:p.erpSkuId,currentState:'active',sourceCreatedAt:`2026-09-${String(i+1).padStart(2,'0')}`} ]));
 items.push({...items[0],erpSkuId:'extra',sku:'extra',sales:{totalPhysicalContribution:100}});meta.set('extra',{...meta.get('0'),erpGoodsId:'0'});
 items[22].brand='痴翁春';items[24].category='仿真花';items[23].brand='其他';meta.get('23').inBrandShop=false;
 const hot=rankContentRecommendations(items,meta,{brand:'半然',kind:'hot'});assert.equal(hot.length,23);assert.equal(hot[0].salesQuantity,101);assert.equal(hot[0].erpSkuId,'extra');assert.ok(!hot.some(p=>['24','23'].includes(p.erpSkuId)));
 const fresh=rankContentRecommendations(items,meta,{brand:'半然',kind:'new'});assert.equal(fresh[0].erpSkuId,'22');assert.equal(fresh.length,23);
 assert.equal(rankContentRecommendations(items,meta,{brand:'半然',kind:'new',excludeFlowers:false})[0].erpSkuId,'24');
});

import Database from 'better-sqlite3';
import {createContentRecommendations} from '../../server/contentCenterRecommendations.js';
test('只统计品牌店铺销量，忽略产品品牌；未匹配店铺不退回全公司',()=>{
 const d=new Database(':memory:');d.exec(`CREATE TABLE sales_shops(id,displayName,shopName,normalizedShopName,status);CREATE TABLE sales_links(id,shopId);
 CREATE TABLE erp_skus(id,erpGoodsId,currentState,merchantSkuCode,mainImage);CREATE TABLE erp_goods(id,sourceCreatedAt,category,goodsName);
 CREATE TABLE product_business_profiles(erpSkuId,displayNameOverride);CREATE TABLE product_erp_mappings(id,erpSkuId,currentState,updatedAt,productId);CREATE TABLE products(id,name,mainImage);
 INSERT INTO sales_shops VALUES('banran','半然旗舰店','','','active'),('other','点意旗舰店','','','active');INSERT INTO sales_links VALUES('a','banran'),('b','other');
 INSERT INTO erp_skus VALUES('sku','goods','active','CODE','');INSERT INTO erp_goods VALUES('goods','2026-09-01','花瓶','其他品牌花瓶');`);
 let calls=0;
 const run=createContentRecommendations(()=>d,input=>{calls++;assert.deepEqual(input.salesLinkIds,['a']);return {items:[{erpSkuId:'sku',totalPhysicalContribution:12}]};},()=>({linksByErpSku:new Map([['sku',new Set(['a','b'])]])}));
 assert.equal(run('半然','hot').rows[0].salesQuantity,12);assert.equal(run('半然','new').rows[0].erpSkuId,'sku');assert.equal(run('不存在品牌','hot').rows.length,0);assert.equal(calls,1);
 d.exec(`ALTER TABLE erp_skus ADD COLUMN createdAt;
 UPDATE erp_skus SET createdAt='2026-08-01';
 INSERT INTO erp_goods VALUES('unlinked','2020-01-01','花瓶','无店铺无销量新品');
 INSERT INTO erp_skus VALUES('unlinked-sku','unlinked','active','NEW','', '2026-09-10');
 INSERT INTO erp_goods VALUES('flower','2020-01-01','仿真花','仿真花新品');
 INSERT INTO erp_skus VALUES('flower-sku','flower','active','FLOWER','','2026-09-11');`);
 const catalog=createContentRecommendations(()=>d,()=>{throw Error('不应查询销量');},()=>{throw Error('不应查询店铺关联');});
 const fresh=catalog('不存在品牌','new',true,'catalog');
 assert.deepEqual(fresh.rows.map(p=>p.erpSkuId),['unlinked-sku','sku']);
 assert.equal(fresh.rows[0].newDate,'2026-09-10');assert.deepEqual(fresh.shops,[]);
 assert.equal(catalog('半然','new',false,'catalog').rows[0].erpSkuId,'flower-sku');
 assert.throws(()=>catalog('半然','hot',true,'catalog'));
 d.close();
});

test('新品先按日期选50款，老产品不能靠高销量挤入新品池',()=>{
 const items=Array.from({length:60},(_,i)=>({erpSkuId:String(i),sku:String(i),name:'花瓶',sales:{totalPhysicalContribution:60-i}}));
 const meta=new Map(items.map((p,i)=>[p.erpSkuId,{inBrandShop:true,erpGoodsId:p.erpSkuId,currentState:'active',sourceCreatedAt:new Date(Date.UTC(2026,0,i+1)).toISOString()}]));
 const rows=rankContentRecommendations(items,meta,{kind:'new'});assert.equal(rows.length,50);assert.equal(rows[0].erpSkuId,'59');assert.equal(rows[49].erpSkuId,'10');assert.ok(!rows.some(p=>p.erpSkuId==='0'));
});


test('热销按销量降序取前50款',()=>{
 const items=Array.from({length:60},(_,i)=>({erpSkuId:String(i),sku:String(i),name:'花瓶',sales:{totalPhysicalContribution:i+1}}));
 const meta=new Map(items.map(p=>[p.erpSkuId,{inBrandShop:true,erpGoodsId:p.erpSkuId,currentState:'active'}]));
 const rows=rankContentRecommendations(items,meta,{kind:'hot'});
 assert.equal(rows.length,50);assert.equal(rows[0].salesQuantity,60);assert.equal(rows[49].salesQuantity,11);
});
