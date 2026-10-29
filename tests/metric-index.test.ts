import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { metricIndexText } from '../extensions/business-plugins/metric-factory/project/index-text.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const projectId = '44444444-4444-4444-8444-444444444444';
const draft = () => new Uint8Array(readFileSync(path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml')));

function harness() {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'metric-index-'));
  mkdirSync(path.join(dataRoot, 'projects', projectId), { recursive: true });
  const library = createMetricLibrary(path.join(dataRoot, 'metric-assets'));
  const entry = library.publish(preparePublication(draft()), 'huangbo');
  return { dataRoot, entry };
}

test('MF-04: no enablement yields no index text at all', () => {
  const { dataRoot } = harness();
  assert.equal(metricIndexText({ dataRoot, projectId }), undefined);
});

test('MF-04: enabled assets produce an index with identity, names and library path', () => {
  const { dataRoot, entry } = harness();
  createProjectEnablement(path.join(dataRoot, 'projects', projectId)).enable(entry.id, entry.version);
  const text = metricIndexText({ dataRoot, projectId })!;
  assert.match(text, /membership-repurchase@1\.0\.0/);
  assert.match(text, /repurchase_rate 会员复购率/);
  assert.match(text, /repurchase_diagnosis 会员复购诊断/);
  assert.match(text, new RegExp(`完整定义.*${path.join(dataRoot, 'metric-assets', 'membership-repurchase', '1.0.0.sap.yaml')}`));
  assert.match(text, /注明.*指标.*版本/);
});

test('MF-04: the index never contains the full definition payload', () => {
  const { dataRoot, entry } = harness();
  createProjectEnablement(path.join(dataRoot, 'projects', projectId)).enable(entry.id, entry.version);
  const text = metricIndexText({ dataRoot, projectId })!;
  assert.ok(text.length < 4000, `index must stay small, got ${text.length}`);
  assert.doesNotMatch(text, /caliber_switches|type_params|definition:/);
});

test('MF-04: unreadable library entries degrade to a warning line instead of failing', () => {
  const { dataRoot, entry } = harness();
  createProjectEnablement(path.join(dataRoot, 'projects', projectId)).enable(entry.id, entry.version);
  writeFileSync(path.join(dataRoot, 'metric-assets', 'index.json'), 'tampered', 'utf8');
  const text = metricIndexText({ dataRoot, projectId })!;
  assert.match(text, /membership-repurchase@1\.0\.0/);
  assert.match(text, /库中暂不可读/);
});

test('MF-04: corrupted enablement never blocks session start', () => {
  const { dataRoot } = harness();
  writeFileSync(path.join(dataRoot, 'projects', projectId, 'metric-assets.json'), 'broken', 'utf8');
  assert.equal(metricIndexText({ dataRoot, projectId }), undefined);
});
