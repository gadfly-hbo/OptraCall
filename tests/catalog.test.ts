import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCategories, catalogItems, filterCatalog } from '../src/host/ui/catalog-data.ts';

test('CAT-01: each approved category has its own clearly planned examples', () => {
  for (const category of catalogCategories) {
    const items = filterCatalog(category, '', '全部');
    assert.ok(items.length >= 3, category);
    assert.ok(items.every(item => item.category === category && ['规划示例', '预留接入', '已接入'].includes(item.status)));
  }
  assert.equal(new Set(catalogItems.map(item => item.id)).size, catalogItems.length);
});
test('CAT-02: search is trimmed, case insensitive and restricted to one category', () => {
  const methods = filterCatalog('assets', '  cohort  ', '全部');
  assert.ok(methods.some(item => item.id === 'A02'));
  assert.ok(methods.every(item => item.category === 'assets'));
  assert.equal(filterCatalog('connectors', 'cohort', '全部').length, 0);
});
test('CAT-02: tag and query apply together; unmatched input is a real empty result', () => {
  const results = filterCatalog('assets', '指标', '指标口径');
  assert.ok(results.length > 0);
  assert.ok(results.every(item => item.tags.includes('指标口径')));
  assert.equal(filterCatalog('assets', '完全不存在的占位工具', '全部').length, 0);
  assert.equal(filterCatalog('assets', '指标', '报告模板').length, 0);
});
test('CAT-03: decision-platform is the connected decision board, not an invented numbered candidate', () => {
  const item = catalogItems.find(item => item.id === 'decision-platform');
  assert.ok(item);
  assert.equal(item.category, 'plugins');
  assert.equal(item.status, '已接入');
  assert.match(item.note, /决策看板页面/);
});
