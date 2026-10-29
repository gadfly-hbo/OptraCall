import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequirementStore, RequirementStoreFault } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { isStale, upstreamDigest } from '../extensions/business-plugins/requirements-elaboration/contract/validate.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

const root = () => mkdtempSync(path.join(os.tmpdir(), 'requirement-store-'));
const fault = (error: unknown): RequirementStoreFault => { assert.ok(error instanceof RequirementStoreFault, `expected RequirementStoreFault, got ${String(error)}`); return error as RequirementStoreFault; };

const withConfirmedFramework = () => {
  const base = sampleInstance();
  const instance = { ...base, instance: { ...base.instance, id: 'req-store-001' }, snapshot: undefined };
  return instance;
};

const seeded = (store: ReturnType<typeof createRequirementStore>, scene: 'topic' | 'recurring' = 'topic') => {
  const created = store.create({ title: '双11复购下滑归因', scene });
  const base = withConfirmedFramework();
  const instance = { ...base, instance: { ...base.instance, id: created.instance.id, createdAt: created.instance.createdAt } };
  return { id: created.instance.id, instance: store.save(instance) };
};

test('RE-01: create writes instance.yaml with restrictive permissions and lists it', () => {
  const store = createRequirementStore(root());
  const instance = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  assert.match(instance.instance.id, /^req-[a-z0-9-]+$/);
  assert.equal(instance.clarifications.length, 0);
  const file = path.join(store.root, instance.instance.id, 'instance.yaml');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(store.root, instance.instance.id)).mode & 0o777, 0o700);
  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, instance.instance.id);
  assert.equal(listed[0]!.title, '双11复购下滑归因');
  assert.deepEqual(store.read(instance.instance.id), store.read(instance.instance.id));
});

test('RE-01: save revalidates and keeps the previous bytes on rejection', () => {
  const store = createRequirementStore(root());
  const instance = store.create({ title: '门店销售下降', scene: 'daily' });
  const file = path.join(store.root, instance.instance.id, 'instance.yaml');
  const before = readFileSync(file, 'utf8');
  const broken = structuredClone(instance);
  (broken as any).instance.version = '9.9';
  assert.throws(() => store.save(broken), error => { assert.equal(fault(error).code, 'REQ_VERSION'); return true; });
  assert.equal(readFileSync(file, 'utf8'), before);
  const saved = store.save({ ...instance, context: { ...instance.context, goal: '判断是否促销' } });
  assert.notEqual(saved.instance.updatedAt, instance.instance.updatedAt);
  assert.equal(store.read(instance.instance.id).context.goal, '判断是否促销');
});

test('RE-01: confirm writes an immutable snapshot, marks nothing stale, and is idempotent per content', () => {
  const store = createRequirementStore(root());
  const created = store.create({ title: 'SaaS 流失预警', scene: 'recurring' });
  const withContent = { ...created, facts: ['季度流失率环比上升 3%'], hypotheses: [] };
  const first = store.confirm(withContent, 'huangbo');
  assert.match(first.fingerprint, /^sha256:[a-f0-9]{64}$/);
  const after = store.read(withContent.instance.id);
  assert.equal(after.snapshot!.fingerprint, first.fingerprint);
  assert.equal(isStale(after), false);
  const snapshotFiles = readdirSync(path.join(store.root, withContent.instance.id, 'snapshots'));
  assert.equal(snapshotFiles.length, 1);
  const again = store.confirm(after, 'huangbo');
  assert.equal(again.fingerprint, first.fingerprint);
  assert.equal(readdirSync(path.join(store.root, withContent.instance.id, 'snapshots')).length, 1);
  // Upstream edit invalidates the reference but never touches the frozen file.
  const frozen = readFileSync(path.join(store.root, withContent.instance.id, 'snapshots', snapshotFiles[0]!), 'utf8');
  const edited = store.save({ ...after, facts: ['季度流失率环比上升 4%'] });
  assert.equal(isStale(edited), true);
  assert.equal(readFileSync(path.join(store.root, withContent.instance.id, 'snapshots', snapshotFiles[0]!), 'utf8'), frozen);
  const reconfirmed = store.confirm(edited, 'huangbo');
  assert.notEqual(reconfirmed.fingerprint, first.fingerprint);
  assert.equal(readdirSync(path.join(store.root, withContent.instance.id, 'snapshots')).length, 2);
  assert.equal(isStale(store.read(withContent.instance.id)), false);
});

test('RE-01: publish is idempotent for identical content, conflict for divergent, same-content new version rejected', () => {
  const store = createRequirementStore(root());
  const { id, instance } = seeded(store);
  const confirmed = store.confirm(instance, 'huangbo');
  assert.equal(confirmed.fingerprint, 'sha256:' + upstreamDigest({ ...instance, snapshot: undefined }));
  const first = store.publish(id, '1.0.0', 'huangbo');
  assert.equal(first.version, '1.0.0');
  const releaseFile = path.join(store.root, 'releases', id, '1.0.0.rap.yaml');
  assert.ok(releaseFile.length > 0);
  assert.equal(statSync(releaseFile).mode & 0o777, 0o600);
  const again = store.publish(id, '1.0.0', 'huangbo');
  assert.deepEqual(again, first);
  const mutated: any = structuredClone(store.read(id));
  mutated.framework.metrics[0].name = '复购率（改）';
  store.save(mutated);
  assert.throws(() => store.publish(id, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_VERSION_CONFLICT'); return true; });
  const restored: any = structuredClone(store.read(id));
  restored.framework.metrics[0].name = '30日会员复购率';
  store.save(restored);
  assert.throws(() => store.publish(id, '1.1.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_SAME_CONTENT'); return true; });
  const releases = store.releases(id);
  assert.equal(releases.length, 1);
  const read = store.readRelease(id, '1.0.0');
  assert.equal(read.entry.packageFingerprint, first.packageFingerprint);
  assert.equal(read.rap.version, '1.0.0');
});

test('RE-01: publish refuses stale or unconfirmed instances', () => {
  const store = createRequirementStore(root());
  const { id } = seeded(store);
  assert.throws(() => store.publish(id, '1.0.0', 'huangbo'), error => { fault(error); return true; });
  store.confirm(store.read(id), 'huangbo');
  const edited = store.save({ ...store.read(id), facts: [...store.read(id).facts, '补充事实'] });
  assert.throws(() => store.publish(edited.instance.id, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_STALE_SNAPSHOT'); return true; });
});

test('RE-01: corrupted instance or release files fail closed without data loss', () => {
  const store = createRequirementStore(root());
  const { id } = seeded(store);
  store.confirm(store.read(id), 'huangbo');
  store.publish(id, '1.0.0', 'huangbo');
  const instanceFile = path.join(store.root, id, 'instance.yaml');
  writeFileSync(instanceFile, 'not: [valid');
  assert.throws(() => store.read(id), error => { assert.equal(fault(error).code, 'REQ_STORE_CORRUPT'); return true; });
  assert.throws(() => store.list(), error => { assert.equal(fault(error).code, 'REQ_STORE_CORRUPT'); return true; });
});

test('RE-01: release library detects tampered files and unknown ids', () => {
  const store = createRequirementStore(root());
  const { id } = seeded(store);
  store.confirm(store.read(id), 'huangbo');
  store.publish(id, '1.0.0', 'huangbo');
  const file = path.join(store.root, 'releases', id, '1.0.0.rap.yaml');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('30日会员复购率', '篡改口径'));
  assert.throws(() => store.readRelease(id, '1.0.0'), error => { assert.equal(fault(error).code, 'REQ_STORE_CORRUPT'); return true; });
  assert.throws(() => store.read('req-does-not-exist'), error => { assert.equal(fault(error).code, 'REQ_STORE_NOT_FOUND'); return true; });
  assert.throws(() => store.read('../escape'), error => { fault(error); return true; });
});
