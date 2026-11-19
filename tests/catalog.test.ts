import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCategories, catalogItems } from '../src/host/ui/catalog-data.ts';

test('CAT-01: each category separates real entries from explicitly planned examples', () => {
  for (const category of catalogCategories) {
    const items = catalogItems.filter(item => item.category === category);
    assert.ok(items.length >= 3, category);
    assert.ok(items.every(item => item.category === category));
    assert.ok(items.filter(item => item.status !== '已接入').every(item => ['规划示例', '预留接入'].includes(item.status) && !item.entry));
  }
  assert.equal(new Set(catalogItems.map(item => item.id)).size, catalogItems.length);
});
test('SU01/EB15: SAP moves into Studio while requirements retains its real plugin entry', () => {
  assert.equal(catalogItems.some(item => item.id === 'metric-factory' || item.name === '指标体系'), false, 'SAP professional management is inside Studio, not the plugin market');
  const requirement = catalogItems.filter(item => item.id === 'requirements-elaboration');
  assert.equal(requirement.length, 1);
  assert.equal(requirement[0].entry, 'requirement');
  assert.equal(requirement[0].status, '已接入');
  assert.equal(requirement[0].category, 'plugins');
  assert.equal(catalogItems.some(item => item.name === '行业指标资产包'), false);
});
test('CAT-02: the real PPT asset keeps its entry, category and business tags without an obsolete placeholder', () => {
  const methods = catalogItems.filter(item => item.id === 'ppt-report');
  assert.equal(methods.length, 1);
  assert.equal(methods[0].id, 'ppt-report');
  assert.equal(methods[0].entry, 'ppt-report');
  assert.ok(methods[0].tags.includes('PPT 生成'));
  assert.ok(methods[0].tags.includes('报告表达'));
  assert.equal(catalogItems.some(item => item.id === 'A02'), false, 'method planning merges into the real SAP entry');
  assert.ok(methods.every(item => item.category === 'assets'));
});
test('SU01/EB01: enterprise materials is managed by Studio without a duplicate market entry', () => {
  assert.equal(catalogItems.some(item => item.id === 'enterprise-materials'), false);
  assert.equal(catalogItems.some(item => item.name === '企业业务资料'), false);
});
test('CAT-03: decision-platform is the connected decision board, not an invented numbered candidate', () => {
  const item = catalogItems.find(item => item.id === 'decision-platform');
  assert.ok(item);
  assert.equal(item.category, 'plugins');
  assert.equal(item.status, '已接入');
  assert.equal(item.entry, 'decision');
  assert.match(item.note, /决策看板页面/);
});
