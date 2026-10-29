import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProjectEnablement, EnablementFault } from '../extensions/business-plugins/metric-factory/project/enablement.ts';

const directory = () => mkdtempSync(path.join(os.tmpdir(), 'metric-enable-'));
const fault = (error: unknown): EnablementFault => { assert.ok(error instanceof EnablementFault, `expected EnablementFault, got ${String(error)}`); return error as EnablementFault; };

test('MF-04: enabling a package records the exact version with restrictive permissions', () => {
  const enablement = createProjectEnablement(directory());
  const record = enablement.enable('membership-repurchase', '1.0.0');
  assert.equal(record.packageId, 'membership-repurchase');
  assert.deepEqual(enablement.list(), [record]);
  const file = enablement.file;
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, 'utf8'), /membership-repurchase/);
});

test('MF-04: upgrading pins the new version as a single record, disable removes it', () => {
  const enablement = createProjectEnablement(directory());
  enablement.enable('membership-repurchase', '1.0.0');
  const upgraded = enablement.enable('membership-repurchase', '1.1.0');
  assert.equal(upgraded.version, '1.1.0');
  assert.equal(enablement.list().length, 1);
  enablement.enable('ecommerce-net-sales', '1.1.1');
  assert.equal(enablement.list().length, 2);
  enablement.disable('membership-repurchase');
  assert.deepEqual(enablement.list().map(item => item.packageId), ['ecommerce-net-sales']);
  enablement.disable('ecommerce-net-sales');
  assert.equal(enablement.list().length, 0);
  enablement.disable('membership-repurchase');
});

test('MF-04: a fresh instance reads the record back unchanged', () => {
  const shared = directory();
  const first = createProjectEnablement(shared);
  first.enable('membership-repurchase', '1.0.0');
  const reopened = createProjectEnablement(shared);
  assert.deepEqual(reopened.list(), first.list());
  assert.deepEqual(reopened.enabled('membership-repurchase'), first.enabled('membership-repurchase'));
  assert.equal(reopened.enabled('missing-package'), undefined);
});

test('MF-04: invalid identities are rejected without touching the file', () => {
  const enablement = createProjectEnablement(directory());
  for (const [id, version] of [['Bad_Id', '1.0.0'], ['ok-id', '1.0'], ['', '1.0.0'], ['ok-id', 'latest']] as const) {
    assert.throws(() => enablement.enable(id, version), error => { assert.equal(fault(error).code, 'ENABLEMENT_INVALID'); return true; });
  }
  assert.equal(existsSync(enablement.file), false);
});

test('MF-04: corrupted record file reports instead of clearing or rewriting', () => {
  const shared = directory();
  const enablement = createProjectEnablement(shared);
  enablement.enable('membership-repurchase', '1.0.0');
  writeFileSync(enablement.file, 'not json', 'utf8');
  const broken = createProjectEnablement(shared);
  assert.throws(() => broken.list(), error => { assert.equal(fault(error).code, 'ENABLEMENT_CORRUPT'); return true; });
  assert.throws(() => broken.enable('membership-repurchase', '1.1.0'), error => { assert.equal(fault(error).code, 'ENABLEMENT_CORRUPT'); return true; });
  assert.equal(readFileSync(enablement.file, 'utf8'), 'not json');
});

test('MF-04: unexpected record shapes are rejected as corrupt', () => {
  const shared = directory();
  const enablement = createProjectEnablement(shared);
  enablement.enable('membership-repurchase', '1.0.0');
  const parsed = JSON.parse(readFileSync(enablement.file, 'utf8'));
  parsed.version = 2;
  writeFileSync(enablement.file, JSON.stringify(parsed), 'utf8');
  assert.throws(() => createProjectEnablement(shared).list(), error => { assert.equal(fault(error).code, 'ENABLEMENT_CORRUPT'); return true; });
  const withUnknown = { version: 1, enabled: { 'membership-repurchase': { version: '1.0.0', enabledAt: '2026-10-29T10:00:00.000Z', extra: 1 } } };
  writeFileSync(enablement.file, JSON.stringify(withUnknown), 'utf8');
  assert.throws(() => createProjectEnablement(shared).list(), error => { assert.equal(fault(error).code, 'ENABLEMENT_CORRUPT'); return true; });
});
