import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const requirement={account:'1',column:'半然四季',noteFormat:'图文',notes:'写季节进入家'};
const generated={title:'秋分，给家里换一枝秋天',copyText:'窗边的光慢慢变柔。\n把一枝秋色留在瓶里。',hashtags:'#半然 #半然四季 #秋分',generationStatus:'已生成'};
test('批量需求：3 行、原子校验、空文案、状态与版本保护、同 ID 排期、旧数据不变、重启持久化',()=>{
 const dir=mkdtempSync(join(tmpdir(),'banran-requests-'));let store=createStore(join(dir,'db.sqlite'));
 try{
 store.save({pool:'candidate',title:'原有候选'});store.save({account:'1',column:'半然日志',title:'原有正式',copyText:'原正文',date:'2026-09-09',time:'08:00'});const original=store.rawNotes();
 const p=store.addReference('products',{name:'花器'});
 for(const bad of [{account:''},{column:'无效栏目'},{productIds:['missing']},{preferredDate:'2026-02-30'},{preferredTime:'08:00'},{noteFormat:'直播'}])assert.throws(()=>store.createRequests([requirement,{...requirement,...bad}]),/第 2 行/);
 assert.deepEqual(store.rawNotes(),original);
 let rows=store.createRequests([{...requirement,productIds:[p.id],preferredDate:'2026-09-23',preferredTime:'08:00'},{...requirement,preferredDate:'2026-10-08'},requirement]);
 assert.equal(rows.length,3);assert.equal(store.listRequests('待生成').length,3);for(const n of rows){assert.equal(n.title,'');assert.equal(n.copyText,'');assert.equal(n.pool,'candidate');}
 const id=rows[0].id;assert.deepEqual(store.getRequest(id),rows[0]);
 assert.throws(()=>store.scheduleRequest(id,{revision:1}),/先完成/);assert.throws(()=>store.updateRequest(id,{revision:1,generationStatus:'已生成'}),/标题、正文和话题/);
 let n=store.updateRequest(id,{revision:1,...generated});assert.equal(n.revision,2);assert.equal(store.listRequests('待生成').length,2);
 assert.throws(()=>store.updateRequest(id,{revision:1,title:'旧版本'}),e=>e.status===409);
 n=store.updateRequest(id,{revision:n.revision,notes:'调整为窗边场景'});assert.equal(n.generationStatus,'需调整');
 n=store.updateRequest(id,{revision:n.revision,...generated,generationError:''});
 const scheduled=store.scheduleRequest(id,{revision:n.revision});assert.equal(scheduled.id,id);assert.equal(scheduled.date,'2026-09-23');assert.equal(scheduled.time,'08:00');assert.equal(scheduled.status,'已排期');assert.equal(scheduled.createdAt,n.createdAt);assert.deepEqual(scheduled.productIds,[p.id]);assert.equal(store.listRequests('已生成').length,0);
 assert.throws(()=>store.scheduleRequest(id,{revision:scheduled.revision}),e=>e.status===409);
 let second=store.updateRequest(rows[1].id,{revision:1,...generated});assert.throws(()=>store.scheduleRequest(second.id,{revision:second.revision}),/排期时间/);second=store.scheduleRequest(second.id,{revision:second.revision,time:'09:30'});assert.equal(second.date,'2026-10-08');
 let third=store.updateRequest(rows[2].id,{revision:1,generationStatus:'需调整',generationError:'产品资料不足'});assert.equal(third.generationStatus,'需调整');third=store.updateRequest(third.id,{revision:third.revision,...generated});assert.throws(()=>store.scheduleRequest(third.id,{revision:third.revision}),/排期日期/);
 assert.deepEqual(store.rawNotes().filter(n=>original.some(o=>o.id===n.id)),original);
 store.close();store=createStore(join(dir,'db.sqlite'));assert.equal(store.getRequest(id).pool,'schedule');assert.equal(store.list().length,5);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
