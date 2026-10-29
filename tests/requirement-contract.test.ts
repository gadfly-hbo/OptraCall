import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstance, canonicalInstanceYaml, upstreamOf, upstreamFingerprint, isStale,
  buildRapPublication, RequirementFault,
} from '../extensions/business-plugins/requirements-elaboration/contract/validate.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';
import type { RequirementInstance } from '../extensions/business-plugins/requirements-elaboration/contract/validate.ts';

const roundTrip = (instance: RequirementInstance) => parseInstance(new Uint8Array(Buffer.from(canonicalInstanceYaml(instance), 'utf8')));
const fault = (error: unknown): RequirementFault => { assert.ok(error instanceof RequirementFault, `expected RequirementFault, got ${String(error)}`); return error as RequirementFault; };

test('RE-01: instance round-trips canonical YAML and rejects unknown fields', () => {
  const first = sampleInstance();
  const canonical = canonicalInstanceYaml(first);
  assert.ok(!canonical.includes('\r'));
  const parsed = parseInstance(new Uint8Array(Buffer.from(canonical, 'utf8')));
  assert.deepEqual(parsed, first);
  assert.equal(canonicalInstanceYaml(parsed), canonical);
  const mutated = Buffer.from(canonical.replace('scene: topic', 'scene: bogus'), 'utf8');
  assert.throws(() => parseInstance(new Uint8Array(mutated)), error => { fault(error); return true; });
  const extra = Buffer.from(canonical.replace('facts:', 'surprise: 1\nfacts:'), 'utf8');
  assert.throws(() => parseInstance(new Uint8Array(extra)), error => { assert.equal(fault(error).code, 'REQ_UNKNOWN_FIELD'); return true; });
});

test('RE-01: fingerprint is stable, recomputable, and content-sensitive', () => {
  const base = sampleInstance();
  const again = roundTrip(base);
  assert.equal(upstreamFingerprint(again), upstreamFingerprint(base));
  const changed: any = structuredClone(base);
  changed.context.goal = '定位下滑主驱动因素并输出干预策略';
  assert.notEqual(upstreamFingerprint(changed), upstreamFingerprint(base));
});

test('RE-02: stale is derived from upstream changes and not from framework edits', () => {
  const base = sampleInstance();
  assert.equal(isStale(base), false);
  const edited: any = structuredClone(base);
  edited.framework.metrics[0].name = '复购率（改）';
  assert.equal(isStale(edited), false);
  const upstream: any = structuredClone(base);
  upstream.clarifications[0].status = 'answered';
  upstream.clarifications[0].answer = '按支付成功口径';
  assert.equal(isStale(upstream), true);
  assert.equal(upstreamOf(upstream).clarifications[0]!.status, 'answered');
});

test('RE-01: buildRapPublication derives open questions from deferred items', () => {
  const publication = buildRapPublication(sampleInstance(), '1.0.0', 'huangbo');
  const rap = publication.rap;
  assert.equal(rap.rap, '0.2');
  assert.equal(rap.id, 'req-demo-001');
  assert.ok(rap.openQuestions.some(item => item.includes('会员等级标签')), 'deferred clarification flows into openQuestions');
  assert.ok(rap.openQuestions.some(item => item.includes('品类结构')), 'deferred hypothesis flows into openQuestions');
  assert.ok(rap.openQuestions.some(item => item.includes('退款未发货')), 'framework openQuestions preserved');
  assert.ok(rap.assumptions.some(item => item.id === 'hyp-2' && item.status === 'deferred'));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(publication.packageFingerprint));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(publication.contentFingerprint));
  assert.notEqual(publication.packageFingerprint, publication.contentFingerprint);
});

test('RE-01: RAP fingerprints exclude themselves and stay recomputable', () => {
  const publication = buildRapPublication(sampleInstance(), '1.0.0', 'huangbo');
  const reParsed = parseInstance(new Uint8Array(Buffer.from(canonicalInstanceYaml(sampleInstance()), 'utf8')));
  const again = buildRapPublication(reParsed, '1.0.0', 'huangbo');
  assert.equal(again.packageFingerprint, publication.packageFingerprint);
  assert.equal(again.contentFingerprint, publication.contentFingerprint);
  const bumped = buildRapPublication(reParsed, '1.1.0', 'huangbo');
  assert.equal(bumped.contentFingerprint, publication.contentFingerprint);
  assert.notEqual(bumped.packageFingerprint, publication.packageFingerprint);
});

test('RE-01: buildRapPublication refuses missing snapshot or framework', () => {
  const noSnapshot: any = sampleInstance(); noSnapshot.snapshot = undefined;
  assert.throws(() => buildRapPublication(noSnapshot, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_SNAPSHOT_REQUIRED'); return true; });
  const stale: any = sampleInstance(); stale.snapshot = { ...stale.snapshot, upstreamDigest: 'c'.repeat(64) };
  assert.throws(() => buildRapPublication(stale, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_STALE_SNAPSHOT'); return true; });
  const noFramework: any = sampleInstance(); noFramework.framework = undefined;
  assert.throws(() => buildRapPublication(noFramework, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_FRAMEWORK_REQUIRED'); return true; });
});

test('RE-01: analysis paths may only reference known tables and hypotheses', () => {
  const broken: any = sampleInstance();
  broken.framework.analysisPaths[0].hypothesis = 'hyp-404';
  assert.throws(() => buildRapPublication(broken, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_DANGLING_REFERENCE'); return true; });
  const unknownTable: any = sampleInstance();
  unknownTable.framework.analysisPaths[0].hypothesis = 'hyp-1';
  unknownTable.framework.analysisPaths[0].requiredData = ['dwd_missing'];
  assert.throws(() => buildRapPublication(unknownTable, '1.0.0', 'huangbo'), error => { assert.equal(fault(error).code, 'REQ_DANGLING_REFERENCE'); return true; });
});
