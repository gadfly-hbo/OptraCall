import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { StudioSourceRef, StudioUseAssessment } from '../extensions/business-plugins/studio/contracts.ts';
import {
  collectNativeEvidence, exactTaskReport, nativeAssessmentEvidence, parseStudioAssessmentEvidence, qualifyAssessmentClaims,
  readNativeFileEvidence, readStudioEvidence, studioPagesComplete,
} from '../src/host/member-pack-verification.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const report = (projectId: string, taskId: string, locator: string, content: string): StudioSourceRef => ({
  authority: 'task', id: taskId, projectId, taskId, locator, version: hash(content), sha256: hash(content),
});
const owner = { projectId: 'verifier-project', taskId: 'verifier-task', cleanDir: '/workspace/020_clean', reportsDir: '/workspace/060_reports' };
const sessionId = 'verifier-session';
const target = report('author-project', 'author-task', '060_reports/repurchase.md', 'calculation');
const review = report(owner.projectId, owner.taskId, '060_reports/assessment.md', 'independent result');
const assessment: StudioUseAssessment = {
  status: 'pass', report: review, at: '2026-11-22T10:00:00Z', sources: [], result: 'review note',
  nativeCall: { sessionId, toolCallId: 'assess-target' },
};
const user = { role: 'user', content: 'review' };
const call = (id: string, name: string, args: object, session = sessionId) => ({
  role: 'assistant', nativeEntryId: 'entry-' + id, nativeSessionId: session,
  content: [{ type: 'toolCall', id, name, arguments: args }],
});
const results = (id: string, name: string, content: string, details?: object) => ({
  role: 'toolResult', toolCallId: id, toolName: name, isError: false,
  content: [{ type: 'text', text: content }], details,
});
const assess = (id: string, useId = 'use-target', assessmentReport = review) => call(id, 'studio_assets', {
  action: 'assess-use', systemId: 'studio-system', payload: { useId, status: 'pass', report: assessmentReport },
});
const native = (messages: Record<string, unknown>[], evidence = assessment) =>
  nativeAssessmentEvidence(messages, 'studio-system', 'use-target', evidence, ref => ref);

test('R4 uses immutable report owner, locator, version and full digest together', () => {
  assert.equal(exactTaskReport(target, { ...target, title: 'display title' }), true);
  for (const other of [
    { ...target, locator: '060_reports/other/repurchase.md' },
    { ...target, taskId: owner.taskId, id: owner.taskId },
    { ...target, projectId: owner.projectId },
    { ...target, ...report('author-project', 'author-task', '060_reports/repurchase.md', 'later rewrite') },
    { ...target, sha256: undefined },
  ]) {
    assert.equal(exactTaskReport(target, other), false);
  }
});

test('R4 reads belong to exact native call and only explicitly linked earlier receipts may carry forward', () => {
  const read = (id: string) => [call(id, 'read', { path: 'orders.csv' }), results(id, 'read', 'order,amount\n1,3\n')];
  const messages = [
    user, ...read('early'),
    user, ...read('current'), assess('assess-target'), ...read('same-turn-late'),
    user, ...read('later'), assess('assess-unrelated', 'other-use'),
  ];
  const actual = native(messages);
  assert.equal(actual?.boundary.entryId, 'entry-assess-target');
  assert.equal(actual?.boundary.sessionId, sessionId);
  assert.equal(actual?.boundary.turnIndex, 2);
  assert.deepEqual(actual?.results.map(result => result.call.id), ['current']);
  const carried = native(messages, {
    ...assessment, evidence: { targetReport: target, carriedReadToolCallIds: ['early', 'later'] },
  });
  assert.deepEqual(carried?.results.map(result => result.call.id), ['early', 'current']);
  assert.equal(native(messages, { ...assessment, nativeCall: undefined }), undefined);
  assert.equal(native(messages, { ...assessment, nativeCall: { sessionId, toolCallId: 'assess-unrelated' } }), undefined);
  assert.equal(native(messages, { ...assessment, report: { ...review, locator: '060_reports/other.md' } }), undefined);
  assert.equal(native(messages, { ...assessment, nativeCall: { sessionId: 'other-session', toolCallId: 'assess-target' } }), undefined);
});

test('R4 full later source receipt qualifies after a partial read but a selected excerpt or gap does not', () => {
  const ref = target;
  const sourcePage = (id: string, start: number, end: number, body: string, complete = false, selection = {}) => {
    const range = { start, end, total: 4, unit: 'unicode-codepoints' };
    return [call(id, 'studio_assets', { action: 'read-source', payload: { ref, start } }),
      results(id, 'studio_assets', body, { type: 'optracall.studio', action: 'read-source', result: { ref, text: body, range, complete, ...selection } })];
  };
  const reads = (...messages: Record<string, unknown>[]) =>
    collectNativeEvidence([user, ...messages]).results.flatMap(readStudioEvidence);
  assert.equal(studioPagesComplete(reads(...sourcePage('partial', 0, 1, 'a'))), false);
  assert.equal(studioPagesComplete(reads(...sourcePage('partial', 0, 1, 'a'), ...sourcePage('full', 0, 4, 'abcd', true))), true);
  assert.equal(studioPagesComplete(reads(...sourcePage('first', 0, 2, 'ab'), ...sourcePage('next', 2, 4, 'cd'))), true);
  assert.equal(studioPagesComplete(reads(...sourcePage('first', 0, 1, 'a'), ...sourcePage('next', 2, 4, 'cd'))), false);
  assert.equal(studioPagesComplete(reads(...sourcePage('selected', 0, 4, 'abcd', true, { itemId: 'selected' }))), false);
});

test('R4 only an exact full file read supplies text and digest for the authorized input', () => {
  const content = 'order,amount\n1,3\n';
  const read = (name: string, args: object, body = content, details?: object) => {
    const captured = collectNativeEvidence([user, call('read-1', name, args), results('read-1', name, body, details)]).results[0];
    return captured && readNativeFileEvidence(captured, owner);
  };
  const expected = { locator: '020_clean/orders.csv', sha256: hash(content), body: content };
  assert.deepEqual(read('read', { path: 'orders.csv' }), expected);
  assert.equal(read('read', { path: 'orders.csv', limit: 1 }), undefined);
  assert.equal(read('read', { path: '../outside/orders.csv' }), undefined);
  assert.equal(read('bash', { command: 'cat orders.csv' }), undefined);
  const details = {
    type: 'optracall.project-file-read', projectId: owner.projectId, taskId: owner.taskId, sessionId, toolCallId: 'read-1',
    bytes: Buffer.byteLength(content), sha256: hash(content), relativePath: '020_clean/orders.csv',
  };
  assert.deepEqual(read('read_input', { filename: 'orders.csv' }, content, details), expected);
  assert.equal(read('read_input', { filename: 'orders.csv' }, content, { ...details, taskId: 'other-task' }), undefined);
  assert.equal(read('read_input', { filename: 'orders.csv' }, content, { ...details, relativePath: '020_clean/another/orders.csv' }), undefined);
  assert.equal(read('read_input', { filename: 'orders.csv' }, 'wrong body', details), undefined);
});

test('R4 typed comparison retains exact inputs, coverage, reported and recomputed values', () => {
  const valid = {
    targetReport: target,
    coverage: { scope: 'authorized October store', detail: 'complete observation window', inputPaths: ['020_clean/orders.csv'] },
    comparison: { metrics: [{ name: 'numerator', reported: 3, recomputed: 3 }], facts: 'first-purchase cohort examined against the order ledger' },
  };
  assert.deepEqual(parseStudioAssessmentEvidence(valid), valid);
  assert.equal(parseStudioAssessmentEvidence({ targetReport: target, comparison: 'v1.0 核对30天' })?.comparison, undefined);
  assert.equal(parseStudioAssessmentEvidence({ ...valid, comparison: { metrics: [{ name: 'numerator', reported: 3 }], facts: 'unknown' } }), undefined);
  assert.equal(parseStudioAssessmentEvidence({ ...valid, coverage: { ...valid.coverage, inputPaths: ['020_clean/../060_reports/policy.csv'] } }), undefined);
});


const currentPolicy: StudioSourceRef = { authority: 'sap-metric', id: 'member-repurchase', version: '2', sha256: hash('version 2') };
const oldPolicy: StudioSourceRef = { ...currentPolicy, version: '1', sha256: hash('version 1') };
const ledger: StudioSourceRef = { authority: 'data', id: 'orders', version: hash('ledger'), sha256: hash('ledger'), locator: '020_clean/orders.csv' };

function claims(
  status: StudioUseAssessment['status'],
  evidence: Omit<NonNullable<StudioUseAssessment['evidence']>, 'targetReport'>,
  targetBody?: string,
  exactTarget = targetBody === undefined ? target : report('author-project', 'author-task', '060_reports/repurchase.md', targetBody),
) {
  return qualifyAssessmentClaims({
    assessment: { ...assessment, status, evidence: { targetReport: exactTarget, ...evidence } },
    targetBody, requiredRefs: [currentPolicy], actuallyRead: [currentPolicy, oldPolicy, ledger],
    comparisonSources: [currentPolicy, ledger],
  });
}

test('R4 a contradictory numeric pass stays unqualified; the same disagreement can support a failure', () => {
  const comparison = {
    metrics: [{ name: 'numerator', reported: 3, recomputed: 2 }, { name: 'denominator', reported: 4, recomputed: 4 }],
    facts: 'matched the same cohort against the exact transaction input',
  };
  assert.equal(claims('pass', { comparison }).contradictoryPass, true);
  assert.equal(claims('pass', { comparison }).usefulComparison, false);
  assert.equal(claims('fail', { comparison }).usefulComparison, true);
  assert.equal(claims('pass', {
    comparison: { ...comparison, metrics: [{ name: 'numerator', reported: 2, recomputed: 2 }] },
  }).usefulComparison, true);
});

test('R4 an auditable finding needs the exact report passage and a comparison source actually qualified for the use', () => {
  const targetBody = ['October repurchase', 'Compared result: 2 of 4', 'Scope: direct stores'].join('\n');
  const finding = { kind: 'consistent' as const, reportLocator: 'L2', reportExcerpt: 'Compared result: 2 of 4', observedRef: ledger, detail: 'matched the ledger' };
  assert.equal(claims('pass', { finding }, targetBody).auditableFinding, true);
  assert.equal(claims('pass', { finding: { ...finding, reportLocator: 'Somewhere in the report' } }, targetBody).auditableFinding, false);
  assert.equal(claims('pass', { finding: { ...finding, reportLocator: 'L1' } }, targetBody).auditableFinding, false);
  assert.equal(claims('pass', { finding: { ...finding, reportExcerpt: undefined } }, targetBody).auditableFinding, false);
  assert.equal(claims('pass', { finding: { ...finding, observedRef: oldPolicy } }, targetBody).auditableFinding, false);
});

test('R4 merely reading an old version cannot fail an exact report about use of the current or an undeclared version', () => {
  const finding = { kind: 'wrong-version' as const, reportLocator: '/adoptedSources/0', observedRef: oldPolicy, detail: 'old policy also appeared in the materials' };
  assert.equal(claims('fail', { finding }, JSON.stringify({ reviewedSources: [oldPolicy], adoptedSources: [currentPolicy] })).wrongVersion, false);
  assert.equal(claims('fail', { finding }, JSON.stringify({ reviewedSources: [oldPolicy] })).wrongVersion, false);
  assert.equal(claims('fail', { finding: { ...finding, reportLocator: '/reviewedSources/0' } }, JSON.stringify({ reviewedSources: [oldPolicy] })).wrongVersion, false);
  const explicitAdoption = JSON.stringify({ adoptedSources: [oldPolicy] });
  assert.equal(claims('fail', { finding }, explicitAdoption, target).wrongVersion, false);
  assert.equal(claims('fail', { finding }, explicitAdoption).wrongVersion, true);
});
