import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../../server/contentCenter/store.mjs';
import {expandContentPlanningRequests,saveContentRequestPlans} from '../../server/contentCenterRouter.js';
function fixture(t){
 const store=createStore(':memory:');t.after(()=>store.close());const a=store.getCatalog().accounts[0];
 store.productSelection.put(a.unitId,{revision:0,groups:{primary:[{productId:'new',remark:''}],secondary:[],new:[]}});
 const make=()=>store.createRequests([{account:a.id,column:a.columns[0].name,notes:'轻场景、生活瞬间',workstationProductIds:['existing'],noteFormat:'图文',preferredDate:'2026-09-21',preferredTime:'10:00'}])[0];
 const integration={validateReferences(){},progress:()=>({linked:false})};
 const row=n=>({id:n.id,revision:n.revision,notes:'轻场景、生活瞬间。围绕确认花瓶拍摄，保留栏目定位。',workstationProductIds:['new']});
 const run=(items,key='expand-test-01',custom=integration)=>expandContentPlanningRequests(store,custom,{id:'planner'}, {idempotencyKey:key,items});
 return {store,make,row,run,integration};
}
test('17条含栏目提示的需求原子扩写、追加产品、持久审计、幂等，再回填策划',t=>{
 const {store,make,row,run,integration}=fixture(t);const originals=Array.from({length:17},make);const items=originals.map(row);
 const result=run(items);assert.equal(result.items.length,17);assert.equal(store.list().length,17);
 for(let i=0;i<17;i++){
  const old=originals[i],now=store.get(old.id);
  assert.equal(now.notes,items[i].notes);assert.deepEqual(now.workstationProductIds,['existing','new']);
  for(const k of Object.keys(old).filter(k=>!['notes','workstationProductIds','revision','updatedAt'].includes(k)))assert.deepEqual(now[k],old[k],k);
  assert.equal(result.items[i].requestExpansionAudit.previous.notes,old.notes);
  assert.equal(result.items[i].requestExpansionAudit.actorId,'planner');
 }
 assert.equal(run(items).duplicate,true);assert.equal(store.get(items[0].id).revision,2);
 assert.deepEqual(run(items).items[0].requestExpansionAudit,result.items[0].requestExpansionAudit);
 assert.throws(()=>run([{...items[0],notes:'其他内容'}]),e=>e.status===409);
 const plans=saveContentRequestPlans(store,integration,{}, {idempotencyKey:'expand-then-plans',items:result.items.map(n=>({id:n.id,revision:n.revision,title:'完整空间搭配',copyText:'',hashtags:'#空间'}))});
 assert.equal(plans.items.length,17);assert.equal(plans.items[0].notes,items[0].notes);
 assert.throws(()=>run([row(plans.items[0])],'expand-after-plan'),/已有策划/);
});
test('任一版本、产品权限、关联行动、执行或策划冲突均不写入整批',t=>{
 const {store,make,row,run,integration}=fixture(t);
 for(const kind of ['revision','product','permission','linked','execution','planning']){
  const first=make(),second=make();let bad=row(second),custom=integration;
  if(kind==='revision')bad.revision=99;
  if(kind==='product')bad.workstationProductIds=['unknown'];
  if(kind==='permission')custom={...integration,validateReferences(){throw Object.assign(new Error('无权限'),{status:403});}};
  if(kind==='linked')custom={...integration,progress:(_,n)=>({linked:n.id===second.id})};
  if(kind==='execution'){const n=store.save({revision:1,executionNumber:'KA-test'},second.id);bad=row(n);}
  if(kind==='planning'){const n=store.save({revision:1,title:'人工标题'},second.id);bad=row(n);}
  const before=store.list();assert.throws(()=>run([row(first),bad],'expand-conflict-'+kind,custom));assert.deepEqual(store.list(),before,kind);
 }
});
test('扩写字段白名单、类型及空值限制；重复ID被拒绝',t=>{
 const {store,make,row,run}=fixture(t);const n=make();
 for(const patch of [{notes:''},{notes:'  '},{notes:null},{notes:5},{notes:'x'.repeat(4001)},{workstationProductIds:null},{workstationProductIds:[3]},{noteFormat:'视频'},{preferredDate:'2026-09-22'},{title:'不允许'},{workstationTemplateId:'other'}])assert.throws(()=>run([{...row(n),...patch}]));
 assert.throws(()=>run([row(n),row(n)]),/同一需求/);assert.deepEqual(store.get(n.id),n);
 const result=run([{...row(n),workstationProductIds:[]}]);assert.deepEqual(result.items[0].workstationProductIds,['existing']);
});
