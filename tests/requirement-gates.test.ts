import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGateReport, instanceStatus, pendingMustConfirm } from '../extensions/business-plugins/requirements-elaboration/gates/checks.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

test('RE-02: fresh instance fails only the hard structure items and never completeness', () => {
  const base = sampleInstance();
  const fresh = { ...base, framework: undefined, snapshot: undefined };
  const report = computeGateReport(fresh);
  assert.equal(report.hard.length, 3);
  assert.ok(report.hard.every(item => item.level === 'hard'));
  assert.deepEqual(report.hard.map(item => item.status), ['pass', 'fail', 'fail']);
  assert.equal(report.publishBlocked, true);
  const freshness = report.warn.find(item => item.id === 'snapshot-freshness')!;
  assert.equal(freshness.status, 'pass');
  const pending = report.info.find(item => item.id === 'must-confirm-pending')!;
  assert.equal(pending.status, 'info');
  assert.match(pending.detail, /1/);
});

test('RE-02: confirmed instance with framework passes hard items; stale only warns', () => {
  const ready = computeGateReport(sampleInstance());
  assert.equal(ready.publishBlocked, false);
  assert.ok(ready.hard.every(item => item.status === 'pass'));
  const stale: any = structuredClone(sampleInstance());
  stale.context.goal = '改过的目标';
  const report = computeGateReport(stale);
  assert.equal(report.publishBlocked, false, 'stale never blocks by itself');
  const freshness = report.warn.find(item => item.id === 'snapshot-freshness')!;
  assert.equal(freshness.status, 'warn');
});

test('RE-02: must_confirm pending is advice, not a gate', () => {
  const instance = sampleInstance();
  assert.equal(pendingMustConfirm(instance), 1);
  const answered = structuredClone(instance) as any;
  answered.clarifications[0].status = 'answered';
  answered.clarifications[0].answer = '按支付成功口径';
  assert.equal(pendingMustConfirm(answered), 0);
  assert.equal(computeGateReport(answered).publishBlocked, false);
  const report = computeGateReport(answered);
  assert.equal(report.info.find(item => item.id === 'must-confirm-pending')!.detail.includes('0'), true);
});

test('RE-02: unsettled hypotheses and derived open questions surface as info', () => {
  const report = computeGateReport(sampleInstance());
  const unsettled = report.info.find(item => item.id === 'unsettled-hypotheses')!;
  assert.match(unsettled.detail, /1/);
  const flowing = report.info.find(item => item.id === 'open-questions-flow')!;
  assert.match(flowing.detail, /2/);
});

test('RE-02: instance status derives draft / confirmed / stale', () => {
  const base = sampleInstance();
  assert.equal(instanceStatus({ ...base, snapshot: undefined }), 'draft');
  assert.equal(instanceStatus(base), 'confirmed');
  const stale: any = structuredClone(base);
  stale.hypotheses[0].status = 'rejected';
  assert.equal(instanceStatus(stale), 'stale');
});
