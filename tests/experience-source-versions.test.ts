import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentCandidateInput, parseAgentCandidateDetails, agentCandidateDetailsSha256 } from '../src/agent/agent-candidate.ts';
import { sourceRef } from '../src/host/personal-retention-validation.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const content = { kind: 'experience' as const, title: '固定旧事项的经验', bodyMd: '只在原条件成立时参考。', aliases: [], scope: null, caution: null };
const oldRef = { type: 'feedback' as const, sourceProjectId: uuid, boardTaskId: uuid, feedbackRevisionId: uuid };
const caseRef = { type: 'case-decision' as const, caseStoreId: uuid, caseId: uuid, recordId: uuid, revision: 2 };
const choiceRef = { type: 'case-choice' as const, caseStoreId: uuid, caseId: uuid, choiceId: uuid };
const candidateRef = { type: 'agent-candidate' as const, candidate: { projectId: uuid, taskId: uuid, originSessionId: 'native-session', entryId: 'entry', toolCallId: 'call', expectedDetailsSha256: 'a'.repeat(64) }, excerpt: { start: 1, end: 3 } };
const details = (sourceRefs: unknown[], schemaVersion = 1) => ({ schemaVersion, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: uuid, taskId: uuid, sessionId: 'native-session', requestId: 'request', toolCallId: 'call' }, createdAt: '2026-11-04T00:00:00.000Z', content, sourceRefs });

test('EL02/10 candidates accept exact learning sources only in v2, while old Case write source parsing stays four-type', () => {
  assert.deepEqual(parseAgentCandidateInput({ content, sourceRefs: [caseRef, choiceRef, candidateRef] }).sourceRefs, [caseRef, choiceRef, candidateRef]);
  assert.deepEqual(parseAgentCandidateDetails(details([caseRef], 2)), details([caseRef], 2));
  assert.throws(() => parseAgentCandidateDetails(details([caseRef], 1)));
  assert.throws(() => sourceRef(caseRef), /invalid_personal_source_ref/);
  const original = details([oldRef]);
  assert.deepEqual(parseAgentCandidateDetails(original), original);
  assert.equal(agentCandidateDetailsSha256(parseAgentCandidateDetails(original)), '76e8642c71f5bb7d21e7022036d8aa5207e4523615d94c214ea071b656f45636', 'approved canonical v1 fixture identity remains unchanged');
  for (const invalid of [{ ...caseRef, revision: 0 }, { ...caseRef, revision: 1.5 }, { ...caseRef, caseId: null }, { ...caseRef, latest: true }]) assert.throws(() => parseAgentCandidateInput({ content, sourceRefs: [invalid] }));
  for (const invalid of [{ ...choiceRef, choiceId: null }, { ...candidateRef, candidate: { ...candidateRef.candidate, expectedDetailsSha256: 'changed' } }, { ...candidateRef, candidate: { ...candidateRef.candidate, entryId: '' } }, { ...candidateRef, excerpt: { start: 1, end: 1 } }]) assert.throws(() => parseAgentCandidateInput({ content, sourceRefs: [invalid] }));
  assert.throws(() => parseAgentCandidateDetails(details([oldRef], 3)));
});
