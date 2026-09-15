import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/contentCenter/store.mjs';
import { getContentPlanningProductSelection, listContentPlanningSchedule, saveContentPlanningRequests } from '../../server/contentCenterRouter.js';

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
