import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCategories, catalogItems } from '../src/host/ui/catalog-data.ts';
test('A25: scenario-combination display exits while original capabilities retain their integration status', () => {
  assert.equal(catalogCategories.includes('scenarios' as never), false);
  assert.equal(catalogItems.some(item => /^S0[1-6]$/.test(item.id)), false);
  assert.equal(catalogItems.length, 27);
  assert.equal(catalogItems.find(item => item.id === 'data-analysis')?.status, '已接入');
  assert.equal(catalogItems.find(item => item.id === 'weather-mcp')?.status, '已接入');
  assert.equal(catalogItems.find(item => item.entry === 'simlab')?.status, '已接入');
});
