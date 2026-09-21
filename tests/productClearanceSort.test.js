import test from 'node:test';
import assert from 'node:assert/strict';
import { clearanceSortOptions, sortClearancePlans } from '../src/utils/productClearanceSort.js';

test('清仓排序支持真实指标、双向排序，缺失值始终最后且不修改原数据', () => {
  const rows = [
    { id: 'unknown' },
    { id: 'zero', sales: { periodAmount: 0, periodQuantity: 0 }, currentInventoryQuantity: 0, currentInventoryAmount: 0, inventoryProgress: 0 },
    { id: 'high', sales: { periodAmount: 20, periodQuantity: 20 }, currentInventoryQuantity: 20, currentInventoryAmount: 20, inventoryProgress: 1 },
  ];
  for (const [key] of clearanceSortOptions.filter(([key]) => key !== 'default')) {
    assert.deepEqual(sortClearancePlans(rows, key).map(x => x.id), ['high', 'zero', 'unknown']);
    assert.deepEqual(sortClearancePlans(rows, key, 'asc').map(x => x.id), ['zero', 'high', 'unknown']);
  }
  assert.deepEqual(sortClearancePlans(rows), rows);
  assert.deepEqual(rows.map(x => x.id), ['unknown', 'zero', 'high']);
  assert.deepEqual(sortClearancePlans([{id: 1}, {id: 2}], 'salesAmount').map(x => x.id), [1, 2]);
});
