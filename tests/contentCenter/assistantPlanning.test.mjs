import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/contentCenter/store.mjs';
import { getContentPlanningProductSelection, listContentPlanningSchedule, saveContentPlanningRequests, fillContentPlanningRequests, saveContentRequestPlans, reviseContentRequestCopy, reviseContentRequestTopics } from '../../server/contentCenterRouter.js';

test('内容策划助手可读取选品与排期，并仅幂等新增已确认产品的下周需求', t => {
  const store = createStore(':memory:');
  const catalog = store.getCatalog();
  const brand = catalog.units.find(unit => unit.kind === '品牌');
  const account = catalog.accounts.find(candidate => candidate.unitId === brand.id && candidate.status !== 'inactive');
  const column = account.columns[0].name;
  store.productSelection.put(brand.id, {
    revision: 0,
    groups: { primary: [{ productId: 'sku-confirmed', remark: '下周主推' }], secondary: [], new: [] },
  });
  let generateCalls = 0;
  store.weeklyRhythm.generate = () => { generateCalls += 1; return []; };
  const integration = {
    selectionProducts: ids => ids.map(id => ({ erpSkuId: id, name: '确认产品' })),
    validateReferences: (_user, values) => {
      if (values.workstationProductIds.some(id => id !== 'sku-confirmed')) throw Object.assign(new Error('产品无效'), { status: 400 });
    },
  };
  t.after(() => store.close());

  const selection = getContentPlanningProductSelection(store, integration, brand.name);
  assert.equal(selection.brand.id, brand.id);
  assert.equal(selection.products[0].erpSkuId, 'sku-confirmed');
  assert.ok(selection.accounts.some(candidate => candidate.id === account.id && candidate.columns.includes(column)));

  const input = {
    idempotencyKey: 'brand-week-2026-39-v1',
    items: [{ accountId: account.id, column, workstationProductIds: ['sku-confirmed'], noteFormat: '图文', preferredDate: '2026-09-22', preferredTime: '10:30', notes: '围绕主推产品策划下周内容。' }],
  };
  const created = saveContentPlanningRequests(store, integration, { id: 'planner' }, input);
  assert.equal(created.duplicate, false);
  assert.deepEqual(created.items[0].workstationProductIds, ['sku-confirmed']);
  assert.equal(store.listRequests().length, 1);
  const retried = saveContentPlanningRequests(store, integration, { id: 'planner' }, input);
  assert.equal(retried.duplicate, true);
  assert.equal(store.listRequests().length, 1);
  assert.throws(() => saveContentPlanningRequests(store, integration, { id: 'planner' }, { ...input, items: [{ ...input.items[0], notes: '改过的内容' }] }), error => error.status === 409);
  assert.throws(() => saveContentPlanningRequests(store, integration, { id: 'planner' }, { idempotencyKey: 'brand-week-2026-39-v2', items: [{ ...input.items[0], workstationProductIds: ['sku-other'] }] }), /选品确认/u);

  const schedule = listContentPlanningSchedule(store, { startDate: '2026-09-21', endDate: '2026-09-27', accountId: account.id, page: 1, pageSize: 1 });
  assert.equal(schedule.total, 1);
  assert.equal(schedule.items[0].planningDate, '2026-09-22');
  assert.equal(schedule.items[0].planningTime, '10:30');
  assert.equal(generateCalls, 0, '读取排期不得生成周节奏或写入内容');
  assert.throws(() => listContentPlanningSchedule(store, { startDate: '2026-09-01', endDate: '2026-12-31' }), error => error.status === 400);
});


test('按ID补填空白需求：保留排期、幂等、并发保护、整批回滚及禁止覆盖', t=>{
 const store=createStore(':memory:');t.after(()=>store.close());
 const a=store.getCatalog().accounts[0];
 store.productSelection.put(a.unitId,{revision:0,groups:{primary:[{productId:'p1',remark:''}],secondary:[],new:[]}});
 const integration={validateReferences(){},progress(){return {linked:false}}};
 const make=()=>store.createRequests([{account:a.id,column:a.columns[0].name,preferredDate:'2026-09-22',preferredTime:'10:30',noteFormat:'图文'}])[0];
 const first=make(),second=make();
 const row=n=>({id:n.id,revision:n.revision,notes:'围绕确认产品规划内容',workstationProductIds:['p1'],noteFormat:'图文'});
 const input={idempotencyKey:'fill-batch-week-1',items:[row(first),row(second)]};
 const result=fillContentPlanningRequests(store,integration,{},input);
 assert.equal(result.duplicate,false);assert.equal(store.list().length,2);
 assert.deepEqual(result.items.map(n=>n.id),[first.id,second.id]);
 for(const n of result.items){assert.equal(n.preferredDate,'2026-09-22');assert.equal(n.preferredTime,'10:30');assert.equal(n.account,a.id);assert.equal(n.column,a.columns[0].name);assert.equal(n.revision,2);}
 assert.equal(fillContentPlanningRequests(store,integration,{},input).duplicate,true);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {...input,items:[{...row(first),notes:'更改'}]}),e=>e.status===409);
 const blank=make();
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-conflict-1',items:[row(blank),{...row(first),revision:2}]}),/已有内容/);
 assert.equal(store.get(blank.id).notes,'');assert.equal(store.get(blank.id).revision,1);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-stale-1',items:[{...row(blank),revision:99}]}),/版本/);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-date-1',items:[{...row(blank),preferredTime:'20:30'}]}),/不可修改排期/);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-product-1',items:[{...row(blank),workstationProductIds:['other']}]}),/选品确认/);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-repeat-id',items:[row(blank),row(blank)]}),/同一需求/);
 assert.throws(()=>fillContentPlanningRequests(store,{...integration,progress:()=>({linked:true})},{}, {idempotencyKey:'fill-linked-1',items:[row(blank)]}),/已关联行动/);
 const planned=make();store.save({revision:planned.revision,title:'人工策划'},planned.id);
 assert.throws(()=>fillContentPlanningRequests(store,integration,{}, {idempotencyKey:'fill-manual-1',items:[{...row(planned),revision:2}]}),/已有内容/);
});


test('已有需求按ID回填20篇策划：保留需求和关联，幂等与整批冲突保护',t=>{
 const store=createStore(':memory:');t.after(()=>store.close());const a=store.getCatalog().accounts[0];
 const make=()=>store.createRequests([{account:a.id,column:a.columns[0].name,notes:'原始内容需求',workstationProductIds:['p1'],preferredDate:'2026-09-21',preferredTime:'10:30',noteFormat:'图文'}])[0];
 const rows=Array.from({length:20},make);const integration={progress:()=>({linked:false})};
 const row=n=>({id:n.id,revision:n.revision,title:'标题',copyText:'正文与评论互动',hashtags:'#花瓶',imageScript:'封面与逐图脚本',materialNeeds:'实拍素材'});
 const input={idempotencyKey:'plan-week-20-v1',items:rows.map(row)};
 const saved=saveContentRequestPlans(store,integration,{},input);assert.equal(saved.items.length,20);assert.equal(store.list().length,20);
 for(let i=0;i<20;i++){const n=saved.items[i],old=rows[i];for(const field of ['id','notes','account','column','preferredDate','preferredTime','noteFormat','workstationProductIds'])assert.deepEqual(n[field],old[field]);assert.equal(n.title,'标题');assert.equal(n.imageScript,'封面与逐图脚本');assert.equal(n.contentStage,'candidate');assert.equal(n.generationStatus,old.generationStatus);}
 assert.equal(saveContentRequestPlans(store,integration,{},input).duplicate,true);
 assert.throws(()=>saveContentRequestPlans(store,integration,{}, {...input,items:[{...row(rows[0]),title:'换稿'}]}),e=>e.status===409);
 const blank=make();
 assert.throws(()=>saveContentRequestPlans(store,integration,{}, {idempotencyKey:'plan-conflict-1',items:[row(blank),{...row(rows[0]),revision:2}]}),/已有策划/);
 assert.equal(store.get(blank.id).title,'');assert.equal(store.get(blank.id).revision,1);
 for(const extra of [{notes:'覆盖需求'},{workstationProductIds:[]},{preferredDate:'2026-09-22'},{account:'other'}])assert.throws(()=>saveContentRequestPlans(store,integration,{}, {idempotencyKey:'plan-forbidden',items:[{...row(blank),...extra}]}),/仅允许策划字段/);
 assert.throws(()=>saveContentRequestPlans(store,integration,{}, {idempotencyKey:'plan-stale-1',items:[{...row(blank),revision:99}]}),/版本/);
 assert.throws(()=>saveContentRequestPlans(store,{progress:()=>({linked:true})},{}, {idempotencyKey:'plan-linked-1',items:[row(blank)]}),/关联行动/);
 assert.throws(()=>saveContentRequestPlans(store,integration,{}, {idempotencyKey:'plan-empty-1',items:[{...row(blank),title:''}]}),/不能为空/);
});


test('受控修订仅替换标题正文，保留其他字段并持久记录前后版本',t=>{
 const store=createStore(':memory:');t.after(()=>store.close());const a=store.getCatalog().accounts[0],user={id:'planner'},integration={progress:()=>({linked:false})};
 const make=()=>{const n=store.createRequests([{account:a.id,column:a.columns[0].name,notes:'原需求',workstationProductIds:['p1'],preferredDate:'2026-09-21',preferredTime:'10:30',noteFormat:'图文'}])[0];return store.save({revision:1,title:'旧标题',copyText:'旧正文',hashtags:'#原话题',imageScript:'原画面',materialNeeds:'原素材',contentStage:'candidate'},n.id)};
 const rows=Array.from({length:20},make),before=rows[0];
 const item=n=>({id:n.id,revision:n.revision,title:'美物分享',copyText:'生活短句\n评论区互动'});
 const input={idempotencyKey:'copy-v2-20-notes',items:rows.map(item)};
 const result=reviseContentRequestCopy(store,integration,user,input);assert.equal(result.items.length,20);assert.equal(store.list().length,20);
 const saved=store.get(before.id);for(const key of Object.keys(before).filter(k=>!['title','copyText','revision','updatedAt'].includes(k)))assert.deepEqual(saved[key],before[key],key);
 assert.equal(saved.title,'美物分享');assert.equal(result.items[0].copyRevisionAudit.actorId,'planner');assert.equal(result.items[0].copyRevisionAudit.previous.copyText,'旧正文');
 const retry=reviseContentRequestCopy(store,integration,user,input);assert.equal(retry.duplicate,true);assert.deepEqual(retry.items[0].copyRevisionAudit,result.items[0].copyRevisionAudit);
 assert.throws(()=>reviseContentRequestCopy(store,integration,user,{...input,items:[{...item(before),title:'不同稿'}]}),e=>e.status===409);
 const fresh=make();assert.throws(()=>reviseContentRequestCopy(store,integration,user,{idempotencyKey:'copy-stale-batch',items:[item(fresh),item(before)]}),/版本/);assert.equal(store.get(fresh.id).title,'旧标题');
 for(const extra of [{notes:'改需求'},{preferredTime:'20:30'},{workstationProductIds:[]},{hashtags:'#改话题'}])assert.throws(()=>reviseContentRequestCopy(store,integration,user,{idempotencyKey:'copy-forbidden',items:[{...item(fresh),...extra}]}),/仅允许/);
 assert.throws(()=>reviseContentRequestCopy(store,{progress:()=>({linked:true})},user,{idempotencyKey:'copy-linked-1',items:[item(fresh)]}),/关联行动/);
 assert.throws(()=>reviseContentRequestCopy(store,integration,user,{idempotencyKey:'copy-empty-1',items:[{...item(fresh),title:''}]}),/不能为空/);
 const blank=store.createRequests([{account:a.id,column:a.columns[0].name,notes:'原需求',noteFormat:'图文'}])[0];assert.throws(()=>reviseContentRequestCopy(store,integration,user,{idempotencyKey:'copy-no-plan-1',items:[item(blank)]}),/没有完整策划/);
});

test('话题更新仅改话题，整批原子、版本保护、可审计且重试不重复',t=>{
 const store=createStore(':memory:');t.after(()=>store.close());const a=store.getCatalog().accounts[0],user={id:'planner'},integration={progress:()=>({linked:false})};
 const make=()=>{const n=store.createRequests([{account:a.id,column:a.columns[0].name,notes:'原需求',workstationProductIds:['p1'],preferredDate:'2026-09-21',preferredTime:'10:30',noteFormat:'图文'}])[0];return store.save({revision:1,title:'标题',copyText:'正文',hashtags:'#原话题',contentStage:'candidate'},n.id)};
 const before=make(),other=make(),item=n=>({id:n.id,revision:n.revision,hashtags:'#原话题 #花瓶 #生活 #家居 #美物 #分享'});
 const input={idempotencyKey:'topics-update-1',items:[item(before)]};
 const result=reviseContentRequestTopics(store,integration,user,input),saved=store.get(before.id);
 for(const key of Object.keys(before).filter(k=>!['hashtags','revision','updatedAt'].includes(k)))assert.deepEqual(saved[key],before[key],key);
 assert.equal(saved.hashtags,item(before).hashtags);assert.equal(result.items[0].topicsRevisionAudit.previous.hashtags,'#原话题');assert.equal(result.items[0].topicsRevisionAudit.actorId,'planner');
 assert.equal(reviseContentRequestTopics(store,integration,user,input).duplicate,true);
 assert.throws(()=>reviseContentRequestTopics(store,integration,user,{idempotencyKey:'topics-rollback',items:[item(other),item(before)]}),/版本/);assert.equal(store.get(other.id).hashtags,'#原话题');
 for(const extra of [{title:'覆盖'},{copyText:'覆盖'},{preferredTime:'20:30'},{workstationProductIds:[]}])assert.throws(()=>reviseContentRequestTopics(store,integration,user,{idempotencyKey:'topics-forbidden',items:[{...item(other),...extra}]}),/仅允许/);
 assert.throws(()=>reviseContentRequestTopics(store,{progress:()=>({linked:true})},user,{idempotencyKey:'topics-linked-1',items:[item(other)]}),/关联行动/);
 assert.throws(()=>reviseContentRequestTopics(store,integration,user,{idempotencyKey:'topics-empty-1',items:[{...item(other),hashtags:''}]}),/不能为空/);
 assert.throws(()=>reviseContentRequestTopics(store,integration,user,{idempotencyKey:'topics-too-long',items:[{...item(other),hashtags:'x'.repeat(2001)}]}));
 const executing=store.save({revision:other.revision,executionNumber:'KA-test'},other.id);
 assert.throws(()=>reviseContentRequestTopics(store,integration,user,{idempotencyKey:'topics-executing',items:[item(executing)]}),/执行流程/);
});
