import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceHomeModel, extractHomeBoardActions, resolveActiveStudioEnterprise } from '../src/host/ui/workspace-home-model.ts';
import type { CaseRecord } from '../src/host/case-types.ts';
import type { ClientProject } from '../src/host/ui/project-types.ts';

const now = '2026-11-27T08:00:00Z';
function makeCase(id: string, status: CaseRecord['status'] = 'pending'): CaseRecord {
  return { id, title: id, status, nextStep: '核对范围', description: '', judgement: '', revision: 1,
    closedAt: null, closeReason: null, createdAt: now, updatedAt: now };
}
const configuration: ClientProject['configuration'] = {
  id: 'model', name: 'test', provider: 'openai-compatible', api: 'openai-completions',
  model: 'synthetic', baseUrl: 'http://127.0.0.1', revision: 1,
};
function project(id: string): ClientProject {
  return { id, name: id, schemaVersion: 2, configuration, rootPath: '/tmp/'+id,
    createdAt: now, updatedAt: now, archivedAt: null, tasks: [] };
}
const projectLink = (caseId: string, projectId: string) => ({ caseId, projectId, linkedAt: now });
const boardItem = { id: 'item', projectId: 'P', status: 'adopted' as const, tasks: [{
  id: 'action', itemId: 'item', title: '核对项目原件', owner: '运营', dueDate: '2026-12-12',
  status: 'doing' as const, updatedAt: now, authorization: {
    decision: 'authorize' as const, source: { kind: 'work' as const, projectId: 'P' },
  },
}] };

test('incomplete action sources leave the total unknown while retaining verified records', () => {
  const input = { caseAccessState: 'ready' as const, cases: [makeCase('A')], projects: [project('P')],
    projectLinks: [projectLink('A', 'P')] };
  assert.equal(buildWorkspaceHomeModel(input).counts.inProgressActions, 0);
  assert.equal(buildWorkspaceHomeModel({ ...input, actionReadState: 'unavailable' }).counts.inProgressActions, null);
  const boardActions = extractHomeBoardActions({ items: [boardItem] });
  const partial = buildWorkspaceHomeModel({ ...input, boardActions, actionReadState: 'partial-forbidden' });
  assert.equal(partial.counts.inProgressActions, null);
  assert.ok(partial.queue.some(row => row.kind === 'action' && row.actionId === 'action'));
  assert.match(partial.proof.caption, /已核对/);
});

test('project actions keep their own scope and independent Case references survive shared projects', () => {
  const cases = ['A', 'B', 'C'].map(id => makeCase(id));
  const projects = [project('P')];
  const projectLinks = cases.map(c => projectLink(c.id, 'P'));
  const source = { items: [boardItem], projectLinks: [projectLinks[0]] };
  const workActions = extractHomeBoardActions(source);
  const first = buildWorkspaceHomeModel({ caseAccessState: 'ready', cases: [cases[0]], projects,
    projectLinks: source.projectLinks, boardActions: workActions });
  const row = first.queue.find(item => item.kind === 'action');
  assert.ok(row?.kind === 'action');
  assert.equal(row.caseId, undefined);
  assert.equal(row.context, 'P');
  assert.equal(first.queue.find(item => item.kind === 'case')?.dateLabel, '期限待定');
  assert.match(first.proof.caption, /项目/);
  assert.equal(first.queue.find(item => item.kind === 'case')?.statusLabel, '待处理');
  assert.equal(first.counts.inProgressActions, 1);

  const references = new Map(['A', 'B'].map(id => [id, new Set(['action'])]));
  const actions = extractHomeBoardActions({ ...source, caseDecisionTaskIdsByCase: references });
  for (const focusCaseId of ['A', 'B', 'C']) {
    const model = buildWorkspaceHomeModel({ caseAccessState: 'ready', cases, focusCaseId, projects, projectLinks, boardActions: actions });
    assert.equal(model.proof.caption === '已关联行动进展', focusCaseId !== 'C', focusCaseId);
    assert.equal(model.counts.inProgressActions, 1);
    assert.equal(model.queue.find(item => item.kind === 'case')?.statusLabel, '待处理');
    assert.equal(model.queue.filter(item => item.kind === 'action').length, 1);
  }
});

test('unknown project states and inaccessible Case records do not become confirmed work', () => {
  const current = makeCase('A');
  const p1 = { ...project('old'), workUnavailable: true };
  const p2 = project('new');
  const projects = [p1, p2];
  const projectLinks = projects.map(p => projectLink(current.id, p.id));
  const model = buildWorkspaceHomeModel({ caseAccessState: 'ready', cases: [current], projects, projectLinks });
  assert.ok(model.proof.kind === 'grouped');
  assert.deepEqual(model.proof.groups.map(group => [group.label, group.count]), [['未设置', 1], ['暂不可读', 1]]);
  p1.tasks.push({ id: 't', name: '项目任务', draft: '', configuration, createdAt: now, updatedAt: now, sessionStorage: 'task' });
  const restricted = buildWorkspaceHomeModel({ caseAccessState: 'forbidden', cases: [current], projects, projectLinks });
  assert.equal(restricted.focusCase, null);
  assert.equal(restricted.counts.activeCases, 0);
  assert.ok(restricted.proof.kind === 'readiness');
  assert.equal(restricted.proof.completedCount, restricted.proof.facts.filter(fact => fact.confirmed).length);
  assert.equal(restricted.proof.portion, 67);
});

test('home and Studio share an explicit, project-bound or unselected enterprise', () => {
  const enterprises = [{ id: 'E1', name: '甲' }, { id: 'E2', name: '乙' }];
  const projectAssignments = [{ projectId: 'P', enterpriseId: 'E2' }];
  assert.deepEqual(resolveActiveStudioEnterprise({ enterprises, projectAssignments }), { enterprise: null, unselected: true });
  assert.equal(resolveActiveStudioEnterprise({ enterprises, projectAssignments, currentProjectId: 'P' }).enterprise?.id, 'E2');
  assert.equal(resolveActiveStudioEnterprise({ enterprises: [enterprises[0]] }).enterprise?.id, 'E1');
  assert.equal(resolveActiveStudioEnterprise({ enterprises: [enterprises[0]], selectedEnterpriseId: '' }).enterprise, null);
});

test('a Case description or judgement cannot substitute for an unreadable or missing G/S binding', () => {
  const record = { ...makeCase('A'), description: '背景原文', judgement: '判断原文' };
  const input = { caseAccessState: 'ready' as const, cases: [record], projects: [], projectLinks: [] };
  const unreadable = buildWorkspaceHomeModel(input);
  assert.match(unreadable.goalSummary.goalText, /暂不可读/);
  assert.doesNotMatch(unreadable.goalSummary.strategyText, /判断原文/);
  const unbound = buildWorkspaceHomeModel({ ...input, focusDetail: { case: record, artifacts: [], projectLinks: [],
    events: [], projectEvents: [], pendingOperations: [] } });
  assert.match(unbound.goalSummary.goalText, /尚未关联/);
  assert.equal(unbound.goalSummary.hasBinding, false);
});
