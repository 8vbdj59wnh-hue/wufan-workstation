import test from 'node:test';import assert from 'node:assert/strict';
import {rankContentRecommendations} from '../../server/contentCenterRecommendations.js';
test('品牌隔离、过滤仿真花、按货品汇总并限20项',()=>{
 const items=Array.from({length:25},(_,i)=>({erpSkuId:String(i),sku:String(i),name:'花瓶',brand:'半然',sales:{totalPhysicalContribution:i+1}}));
 const meta=new Map(items.map((p,i)=>[p.erpSkuId,{erpGoodsId:p.erpSkuId,currentState:'active',sourceCreatedAt:`2026-09-${String(i+1).padStart(2,'0')}`} ]));
 items.push({...items[0],erpSkuId:'extra',sku:'extra',sales:{totalPhysicalContribution:100}});meta.set('extra',{...meta.get('0'),erpGoodsId:'0'});
 items[22].brand='半然（独家）';items[24].category='仿真花';items[23].brand='其他';
 const hot=rankContentRecommendations(items,meta,{brand:'半然',kind:'hot'});assert.equal(hot.length,20);assert.equal(hot[0].salesQuantity,101);assert.equal(hot[0].erpSkuId,'extra');assert.ok(!hot.some(p=>['24','23'].includes(p.erpSkuId)));
 const fresh=rankContentRecommendations(items,meta,{brand:'半然',kind:'new'});assert.equal(fresh[0].erpSkuId,'22');assert.equal(fresh.length,20);
 assert.equal(rankContentRecommendations(items,meta,{brand:'半然',kind:'new',excludeFlowers:false})[0].erpSkuId,'24');
});
