import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCategories, catalogItems, filterCatalog } from '../src/host/ui/catalog-data.ts';

test('CAT-01: each category separates real entries from explicitly planned examples', () => {
  for (const category of catalogCategories) {
    const items = filterCatalog(category, '', '全部');
    assert.ok(items.length >= 3, category);
    assert.ok(items.every(item => item.category === category));
    assert.ok(items.filter(item => item.status !== '已接入').every(item => ['规划示例', '预留接入'].includes(item.status) && !item.entry));
  }
  assert.equal(new Set(catalogItems.map(item => item.id)).size, catalogItems.length);
});
test('EB15/EB16: metrics and requirements are real category entries without duplicate metric placeholders', () => {
  const metric = filterCatalog('assets', '指标体系', '全部');
  assert.equal(metric.length, 1);
  assert.equal(metric[0].entry, 'metric');
  assert.equal(metric[0].status, '已接入');
  const requirement = filterCatalog('plugins', '需求梳理', '全部');
  assert.equal(requirement.length, 1);
  assert.equal(requirement[0].entry, 'requirement');
  assert.equal(requirement[0].status, '已接入');
  assert.equal(filterCatalog('plugins', '指标体系', '全部').length, 0);
  assert.equal(filterCatalog('assets', '需求梳理', '全部').length, 0);
  assert.equal(catalogItems.some(item => item.name === '行业指标资产包'), false);
});
test('CAT-02: search is trimmed, case insensitive and restricted to one category', () => {
  const methods = filterCatalog('assets', '  cohort  ', '全部');
  assert.ok(methods.some(item => item.id === 'A02'));
  assert.ok(methods.every(item => item.category === 'assets'));
  assert.equal(filterCatalog('connectors', 'cohort', '全部').length, 0);
});
test('EB01: enterprise business materials is a real entry in analysis assets', () => {
  const materials = filterCatalog('assets', '企业业务资料', '全部');
  assert.equal(materials.length, 1);
  assert.equal(materials[0].status, '已接入');
  assert.equal(materials[0].entry, 'enterprise-materials');
  assert.equal(filterCatalog('plugins', '企业业务资料', '全部').length, 0);
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
  assert.equal(item.entry, 'decision');
  assert.match(item.note, /决策看板页面/);
});
