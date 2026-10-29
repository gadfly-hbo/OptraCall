import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, symlinkSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { preparePublication, parseSapDraft } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createMetricLibrary, MetricLibraryFault } from '../extensions/business-plugins/metric-factory/library/store.ts';

const fixtureRoot = path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures');
const draftBytes = () => new Uint8Array(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml')));
const bumpedDraft = () => new Uint8Array(Buffer.from(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml'), 'utf8').replace('version: 1.0.0', 'version: 1.1.0'), 'utf8'));
const changedDraft = () => new Uint8Array(Buffer.from(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml'), 'utf8').replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'), 'utf8'));

const root = () => mkdtempSync(path.join(os.tmpdir(), 'metric-library-'));
const fault = (error: unknown): MetricLibraryFault => { assert.ok(error instanceof MetricLibraryFault, `expected MetricLibraryFault, got ${String(error)}`); return error as MetricLibraryFault; };

test('MF-02: publish writes canonical yaml and index with restrictive permissions', () => {
  const library = createMetricLibrary(root());
  const publication = preparePublication(draftBytes());
  const entry = library.publish(publication, 'huangbo');
  assert.equal(entry.id, 'membership-repurchase');
  assert.equal(entry.version, '1.0.0');
  assert.deepEqual(entry.metricNames, ['repurchase_rate', 'repeat_member_count', 'buyer_member_count', 'repurchase_gap_days']);
  const file = path.join(library.root, 'membership-repurchase', '1.0.0.sap.yaml');
  const onDisk = parseSapDraft(new Uint8Array(readFileSync(file)));
  assert.equal(onDisk.package.fingerprint, publication.packageFingerprint);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(library.root, 'membership-repurchase')).mode & 0o777, 0o700);
  assert.equal(statSync(library.root).mode & 0o777, 0o700);
});

test('MF-02: identical republication is idempotent, conflicting rewrite is rejected', () => {
  const library = createMetricLibrary(root());
  const first = library.publish(preparePublication(draftBytes()), 'huangbo');
  const again = library.publish(preparePublication(draftBytes()), 'huangbo');
  assert.deepEqual(again, first);
  const conflicting = preparePublication(new Uint8Array(Buffer.from(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml'), 'utf8').replace('复购会员数', '重复购买会员数'), 'utf8')));
  assert.notEqual(conflicting.packageFingerprint, first.packageFingerprint);
  assert.throws(() => library.publish(conflicting, 'huangbo'), error => { assert.equal(fault(error).code, 'LIBRARY_VERSION_CONFLICT'); return true; });
});

test('MF-02: new version with unchanged content is rejected as same-content', () => {
  const library = createMetricLibrary(root());
  library.publish(preparePublication(draftBytes()), 'huangbo');
  assert.throws(() => library.publish(preparePublication(bumpedDraft()), 'huangbo'), error => { assert.equal(fault(error).code, 'LIBRARY_SAME_CONTENT'); return true; });
});

test('MF-02: changed content publishes as a new immutable version and read resolves latest', () => {
  const library = createMetricLibrary(root());
  library.publish(preparePublication(draftBytes()), 'huangbo');
  const second = library.publish(preparePublication(changedDraft()), 'huangbo');
  assert.equal(second.version, '1.1.0');
  const latest = library.read('membership-repurchase');
  assert.equal(latest.entry.version, '1.1.0');
  const original = library.read('membership-repurchase', '1.0.0');
  assert.equal(original.entry.version, '1.0.0');
  assert.equal(library.list().length, 2);
});

test('MF-02: a fresh instance over the same root reads back everything consistently', () => {
  const directory = root();
  const first = createMetricLibrary(directory);
  first.publish(preparePublication(draftBytes()), 'huangbo');
  const reopened = createMetricLibrary(directory);
  assert.deepEqual(reopened.list(), first.list());
  const { entry, canonicalYaml } = reopened.read('membership-repurchase');
  assert.equal(canonicalYaml, first.read('membership-repurchase').canonicalYaml);
  assert.equal(entry.publishedBy, 'huangbo');
});

test('MF-02: corrupted index reports instead of clearing or rewriting', () => {
  const directory = root();
  const library = createMetricLibrary(directory);
  library.publish(preparePublication(draftBytes()), 'huangbo');
  const index = path.join(directory, 'index.json');
  const before = readFileSync(index, 'utf8');
  writeFileSync(index, '{ broken', 'utf8');
  const broken = createMetricLibrary(directory);
  assert.throws(() => broken.list(), error => { assert.equal(fault(error).code, 'LIBRARY_CORRUPT'); return true; });
  assert.equal(readFileSync(index, 'utf8'), '{ broken');
  assert.throws(() => broken.publish(preparePublication(changedDraft()), 'huangbo'), error => { assert.equal(fault(error).code, 'LIBRARY_CORRUPT'); return true; });
  writeFileSync(index, before, 'utf8');
  assert.equal(createMetricLibrary(directory).list().length, 1);
});

test('MF-02: tampered package bytes are detected on read and never repaired silently', () => {
  const directory = root();
  const library = createMetricLibrary(directory);
  library.publish(preparePublication(draftBytes()), 'huangbo');
  const file = path.join(directory, 'membership-repurchase', '1.0.0.sap.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('会员复购率', '复购率'), 'utf8');
  const tampered = createMetricLibrary(directory);
  assert.throws(() => tampered.read('membership-repurchase'), error => { assert.equal(fault(error).code, 'LIBRARY_CORRUPT'); return true; });
  assert.throws(() => tampered.publish(preparePublication(changedDraft()), 'huangbo'), error => { assert.equal(fault(error).code, 'LIBRARY_CORRUPT'); return true; });
});

test('MF-02: library refuses paths outside its root and symlinked entries', () => {
  const directory = root();
  const library = createMetricLibrary(directory);
  library.publish(preparePublication(draftBytes()), 'huangbo');
  const packageDirectory = path.join(directory, 'membership-repurchase');
  const staged = mkdtempSync(path.join(os.tmpdir(), 'metric-outside-'));
  rmSync(packageDirectory, { recursive: true });
  mkdirSync(packageDirectory, { recursive: true });
  symlinkSync(path.join(staged, '1.0.0.sap.yaml'), path.join(packageDirectory, '1.0.0.sap.yaml'));
  const poisoned = createMetricLibrary(directory);
  assert.throws(() => poisoned.read('membership-repurchase'), error => { assert.equal(fault(error).code, 'LIBRARY_CORRUPT'); return true; });
  rmSync(staged, { recursive: true, force: true });
});

test('MF-02: unpublished drafts never appear in the library index', () => {
  const directory = root();
  const library = createMetricLibrary(directory);
  assert.equal(library.list().length, 0);
  assert.equal(readdirSync(directory).includes('membership-repurchase'), false);
  library.publish(preparePublication(draftBytes()), 'huangbo');
  const entries = library.list();
  assert.ok(entries.every(entry => entry.packageFingerprint.startsWith('sha256:')));
  assert.ok(entries.every(entry => entry.bytesSha256.length === 64));
});
