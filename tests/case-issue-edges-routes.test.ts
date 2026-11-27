import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseIssueService } from '../src/host/case-issues.ts';
import { createCaseDecisionRoutes } from '../src/host/case-decision-routes.ts';

test('DW03-ROUTE-01: edge routes validate input, return receipts and list active edges', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-dw-routes-')));
  const cases = new CaseStore({ dataRoot: path.join(root, 'private') });
  t.after(async () => { cases.close(); });
  await cases.initialize();
  const record = cases.createCase({ operationId: randomUUID(), title: 'X' });
  const mk = (title: string) => cases.createDecisionIssue({ caseId: record.id, expectedRevision: cases.getCase(record.id).revision, operationId: randomUUID(), title });
  const a = mk('A'), b = mk('B');
  const service = createCaseIssueService({ cases, mutate: (fn: () => unknown) => fn() } as never);
  const route = createCaseDecisionRoutes(service as never);
  const base = `/api/cases/${record.id}/decisions/issue-edges`;
  const body = (extra: Record<string, unknown> = {}) => ({ operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision, fromIssueId: a.id, toIssueId: b.id, explanation: '先后', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'm1' }, ...extra });
  const saved = await route({ pathname: base, method: 'POST', input: body() });
  assert.equal(saved?.status, 201);
  const list = await route({ pathname: base, method: 'GET' }) as { body: { edges: unknown[] } };
  assert.equal(list.body.edges.length, 1);
  await assert.rejects(route({ pathname: base, method: 'POST', input: body({ extra: 1 }) }), { code: 'invalid_case_decision_fields' });
  await assert.rejects(route({ pathname: base, method: 'POST', input: body({ source: { kind: 'keyword-guess' } }) }), { code: 'invalid_case_issue_edge_source' });
});
