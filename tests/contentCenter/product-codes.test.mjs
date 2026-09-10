import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('货品编码无需产品库，兼容历史关联并保留至排期和重启',()=>{
 const dir=mkdtempSync(join(tmpdir(),'content-codes-'));let store=createStore(join(dir,'db.sqlite'));
 try{
 const product=store.addReference('products',{name:'历史产品',sku:'OLD01'});
 const old=store.save({pool:'candidate',title:'旧笔记',productIds:[product.id]});
 assert.equal(old.productCodes,'OLD01');
 const unchanged=store.save({revision:old.revision,productCodes:'OLD01'},old.id);assert.deepEqual(unchanged.productIds,[product.id]);
 const changed=store.save({revision:unchanged.revision,productCodes:'NEW01、NEW02'},old.id);assert.deepEqual(changed.productIds,[]);assert.equal(store.listProducts().length,1);
 let [n]=store.createRequests([{account:'1',column:'半然四季',productCodes:'ERP01、ERP02、ERP01'}]);assert.equal(n.productCodes,'ERP01、ERP02');
 n=store.updateRequest(n.id,{revision:n.revision,title:'标题',copyText:'正文',hashtags:'#话题',generationStatus:'已生成'});
 n=store.updateRequest(n.id,{revision:n.revision,productCodes:'ERP03'});assert.equal(n.generationStatus,'需调整');
 n=store.updateRequest(n.id,{revision:n.revision,generationStatus:'已生成'});
 n=store.scheduleRequest(n.id,{revision:n.revision,date:'2026-09-12',time:'10:00'});assert.equal(n.productCodes,'ERP03');
 store.close();store=createStore(join(dir,'db.sqlite'));assert.equal(store.get(n.id).productCodes,'ERP03');assert.equal(store.get(old.id).productCodes,'NEW01、NEW02');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
