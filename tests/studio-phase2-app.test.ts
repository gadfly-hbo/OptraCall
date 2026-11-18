import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogItems } from '../src/host/ui/catalog-data.ts';

test('SU01: enterprise documents and SAP no longer appear as independent plugin asset entries', () => {
  assert.ok(!catalogItems.some(item => item.entry === 'enterprise-materials'));
  assert.ok(!catalogItems.some(item => item.entry === 'metric'));
  assert.ok(catalogItems.some(item => item.entry === 'data-analysis'), 'Ordinary analytical skills remain available.');
  assert.ok(catalogItems.some(item => item.entry === 'requirement'), 'Other business plugins retain their own entry.');
});
