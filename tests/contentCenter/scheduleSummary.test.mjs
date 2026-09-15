import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('内容排期有行动时仍可渲染统计，区分当前日期、范围外和未排期', () => {
  const source = readFileSync(new URL('../../src/scheduleBoardPage.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderSummary(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({
    isContentScheduleRoute: () => true,
    isNoDueDate: row => row.dueDateKey === '',
  });
  vm.runInContext(source.slice(start, end), context);
  const html = context.renderSummary([
    { dueDateKey: '2026-09-21' },
    { dueDateKey: '2026-09-22' },
    { dueDateKey: '2026-10-10' },
    { dueDateKey: '' },
  ], [{ key: '2026-09-21' }, { key: '2026-09-22' }]);
  assert.match(html, /未完成发布 4/);
  assert.match(html, /已排期 3/);
  assert.match(html, /待排期 1/);
  assert.match(html, /当前日期范围 2/);
  assert.match(context.renderSummary([], []), /当前日期范围 0/);
});
