import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-dw-edges-')));
  const store = new CaseStore({ dataRoot: path.join(root, 'private') });
  t.after(async () => { store.close(); });
  await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '会员复购' });
  const issue = (title: string) => store.createDecisionIssue({ caseId: record.id, expectedRevision: store.getCase(record.id).revision, operationId: randomUUID(), title });
  return { store, caseId: record.id, issue };
}
const source = { kind: 'user-declaration' as const, ref: 'session-1/message-9' };

test('DW03-EDGE-01: legacy issues have no edges and nothing is inferred from title or order', async t => {
  const f = await fixture(t);
  f.issue('A'); f.issue('B');
  assert.deepEqual(f.store.listIssueEdges(f.caseId), []);
});

test('DW03-EDGE-02: multiple predecessors converge, operations replay, stale revisions conflict', async t => {
  const f = await fixture(t);
  const a = f.issue('A'), b = f.issue('B'), c = f.issue('C');
  const save = (from: string, to: string, op = randomUUID()) => f.store.saveIssueEdge({ operationId: op, caseId: f.caseId, expectedRevision: f.store.getCase(f.caseId).revision, fromIssueId: from, toIssueId: to, explanation: '承接', expectedEdgeRevision: 0, source });
  const op = randomUUID(), replayRevision = f.store.getCase(f.caseId).revision;
  const input = { operationId: op, caseId: f.caseId, expectedRevision: replayRevision, fromIssueId: a.id, toIssueId: c.id, explanation: '承接', expectedEdgeRevision: 0, source };
  const ac = f.store.saveIssueEdge(input);
  assert.deepEqual(f.store.saveIssueEdge(input), ac, 'the same operation returns its original receipt');
  const bc = save(b.id, c.id);
  assert.deepEqual(f.store.listIssueEdges(f.caseId).map(e => [e.fromIssueId, e.toIssueId]).sort(), [[a.id, c.id], [b.id, c.id]].sort());
  assert.throws(() => save(a.id, c.id), { code: 'case_issue_edge_duplicate' });
  assert.equal(bc.revision, 1);
  assert.throws(() => f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: f.store.getCase(f.caseId).revision, edgeId: ac.edgeId, explanation: 'x', expectedEdgeRevision: 5, source }), { code: 'case_issue_edge_conflict' });
});

test('DW03-EDGE-03: revise and remove keep history; invalid ends and self edges are refused; cycles are not forbidden', async t => {
  const f = await fixture(t);
  const a = f.issue('A'), b = f.issue('B');
  const rev = () => f.store.getCase(f.caseId).revision;
  const ab = f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), fromIssueId: a.id, toIssueId: b.id, explanation: '先后', expectedEdgeRevision: 0, source });
  const revised = f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), edgeId: ab.edgeId, explanation: '改述', expectedEdgeRevision: 1, source });
  assert.equal(revised.revision, 2); assert.equal(revised.explanation, '改述');
  f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), fromIssueId: b.id, toIssueId: a.id, explanation: '回指', expectedEdgeRevision: 0, source });
  assert.equal(f.store.listIssueEdges(f.caseId).length, 2);
  const removed = f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), edgeId: ab.edgeId, action: 'remove', expectedEdgeRevision: 2, source });
  assert.equal(removed.lifecycle, 'removed');
  assert.equal(f.store.listIssueEdges(f.caseId).length, 1);
  assert.equal(f.store.listIssueEdges(f.caseId, { includeRemoved: true }).length, 2);
  assert.throws(() => f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), fromIssueId: a.id, toIssueId: a.id, expectedEdgeRevision: 0, source }), { code: 'invalid_case_issue_edge' });
  assert.throws(() => f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), fromIssueId: a.id, toIssueId: randomUUID(), expectedEdgeRevision: 0, source }), { code: 'case_issue_not_found' });
  assert.throws(() => f.store.saveIssueEdge({ operationId: randomUUID(), caseId: f.caseId, expectedRevision: rev(), fromIssueId: a.id, toIssueId: b.id, expectedEdgeRevision: 0, source: { kind: 'guess' } as never }), { code: 'invalid_case_issue_edge_source' });
});
