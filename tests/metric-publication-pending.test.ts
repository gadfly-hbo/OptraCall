import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMetricPublicationAttempts, saveMetricPublicationAttempts, type MetricPublicationAttempt } from '../extensions/business-plugins/metric-factory/ui/publication-pending.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const prepared = preparePublication(readFileSync(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url)));
const attempt: MetricPublicationAttempt = { attemptId: 'local-attempt-one', packageId: prepared.document.package.id, version: prepared.document.package.version, packageFingerprint: prepared.packageFingerprint, projectId: 'project-original', path: '020_clean/original.yaml', reviewer: 'Original reviewer', attemptedAt: '2026-11-12T00:00:00Z', enterpriseId: 'enterprise-a' };
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('browser-tab recovery preserves each original attempt locator and exact fingerprint across reloads', () => {
  const storage = memoryStorage(), independent = { ...attempt, attemptId: 'local-attempt-two', packageId: 'independent-package' };
  saveMetricPublicationAttempts(storage, [attempt, independent]);
  assert.deepEqual(readMetricPublicationAttempts(storage), [attempt, independent]);
  saveMetricPublicationAttempts(storage, [independent]);
  assert.deepEqual(readMetricPublicationAttempts(storage), [independent]);
  assert.doesNotMatch([...storage.values.values()].join(''), /document|definition|contentFingerprint|succeeded/);
});

test('unavailable or nonpersistent browser storage cannot pretend an attempt is retained', () => {
  assert.throws(() => saveMetricPublicationAttempts(undefined, [attempt]), /未发送/);
  assert.throws(() => saveMetricPublicationAttempts({ getItem: () => null, setItem() {} }, [attempt]), /未能读回/);
  const storage = memoryStorage(); saveMetricPublicationAttempts(storage, [attempt]);
  const before = [...storage.values];
  assert.throws(() => saveMetricPublicationAttempts({ getItem: storage.getItem, setItem() { throw new Error('quota denied'); } }, []), /quota denied/);
  assert.deepEqual([...storage.values], before);
});

test('a corrupt prior attempt stays unresolved rather than being silently replaced with an empty history', () => {
  let writes = 0;
  assert.throws(() => readMetricPublicationAttempts({ getItem: () => '{"schemaVersion":1,"attempts":[{"packageId":"missing-original-fields"}]}', setItem() { writes += 1; } }), /原发布尝试暂存未能核对/);
  assert.equal(writes, 0);
});
