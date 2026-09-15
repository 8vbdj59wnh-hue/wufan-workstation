import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/contentCenter/store.mjs';
import { getContentPlanningProductSelection, listContentPlanningSchedule, saveContentPlanningRequests, fillContentPlanningRequests } from '../../server/contentCenterRouter.js';

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
