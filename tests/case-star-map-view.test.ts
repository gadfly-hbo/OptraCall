import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCaseMapView, projectCaseMap, layoutCaseMapEdges } from '../src/host/ui/case-star-map-view.ts';
import type { CaseProjectLink, CaseRecord } from '../src/host/case-types.ts';
import type { ClientProject, ClientTask } from '../src/host/ui/project-types.ts';

const at = '2026-11-14T00:00:00.000Z';
const caseRecord = (id: string, title = id): CaseRecord => ({ id, title, description: '', judgement: '', nextStep: '', status: 'pending', closeReason: null, closedAt: null, revision: 1, createdAt: at, updatedAt: at });
const task = (id: string, name: string): ClientTask => ({ id, name, draft: '', createdAt: at, updatedAt: at, sessionStorage: 'task', configuration: {} as ClientTask['configuration'] });
const project = (id: string, name: string, tasks: ClientTask[] = []): ClientProject => ({ schemaVersion: 2, id, name, tasks, configuration: {} as ClientProject['configuration'], rootPath: `/synthetic/${id}`, createdAt: at, updatedAt: at, archivedAt: null });
const link = (caseId: string, projectId: string): CaseProjectLink => ({ caseId, projectId, linkedAt: at });

test('shared projects appear once, while unlinked cases and independent projects remain reachable', () => {
  const result = projectCaseMap({ cases: [caseRecord('a'), caseRecord('b'), caseRecord('alone')], projects: [project('p', '共享项目'), project('independent', '独立项目')], projectLinks: [link('a', 'p'), link('b', 'p')], view: initialCaseMapView() });
  assert.equal(result.nodes.filter(node => node.kind === 'project' && node.projectId === 'p').length, 1);
  assert(result.nodes.some(node => node.kind === 'case' && node.caseId === 'alone'));
  assert(result.nodes.some(node => node.kind === 'project' && node.projectId === 'independent'));
  assert.equal(result.edges.filter(edge => edge.kind === 'project').length, 2);
  assert.equal(result.nodes.filter(node => node.kind === 'task').length, 0);
});

test('searching an analysis task exposes its owning project and associated cases without manual expansion', () => {
  const view = { ...initialCaseMapView(), query: '库存' };
  const result = projectCaseMap({ cases: [caseRecord('a'), caseRecord('unrelated')], projects: [project('p', '共享项目', [task('t', '库存核对'), task('other', '客流核对')]), project('outside', '无关项目')], projectLinks: [link('a', 'p')], view });
  assert(result.nodes.some(node => node.kind === 'task' && node.taskId === 't' && node.projectId === 'p'));
  assert(result.nodes.some(node => node.kind === 'project' && node.projectId === 'p'));
  assert(result.nodes.some(node => node.kind === 'case' && node.caseId === 'a'));
  assert(!result.nodes.some(node => node.kind === 'case' && node.caseId === 'unrelated'));
  assert(!result.nodes.some(node => node.kind === 'task' && node.taskId === 'other'));
  assert.equal(result.matchedTasks, 1);
  assert.deepEqual(view.expandedProjectIds, [], 'reading a projection must not mutate retained view state');
});

test('missing original projects remain explicit placeholders rather than disappearing as an unlink', () => {
  const result = projectCaseMap({ cases: [caseRecord('a')], projects: [], projectLinks: [link('a', 'missing')], view: initialCaseMapView() });
  const missing = result.nodes.find(node => node.kind === 'project' && node.projectId === 'missing');
  assert(missing && missing.kind === 'project' && missing.project === undefined);
  assert.equal(result.missingProjects, 1);
  assert(result.edges.some(edge => edge.from === 'case:a' && edge.to === 'project:missing'));
});

test('business links preserve direction and identity, exclude removed links, and keep both endpoints as context', () => {
  const result = projectCaseMap({ cases: [caseRecord('a', '原问题'), caseRecord('b', '后续事项'), caseRecord('c')], projects: [], projectLinks: [], relations: [{ relationId: 'r1', fromCaseId: 'a', toCaseId: 'b', kind: 'supports', lifecycle: 'active' }, { relationId: 'r2', fromCaseId: 'b', toCaseId: 'c', kind: 'follows_up', lifecycle: 'unlinked' }], view: { ...initialCaseMapView(), query: '后续事项', relation: 'supports' } });
  assert.deepEqual(result.edges, [{ id: 'relation:r1', from: 'case:a', to: 'case:b', kind: 'supports', relationId: 'r1' }]);
  assert(result.nodes.some(node => node.kind === 'case' && node.caseId === 'a'));
  assert(!result.nodes.some(node => node.kind === 'case' && node.caseId === 'c'));
});

test('rendering budget retains all matching identities for the equivalent list and scopes task ids by project', () => {
  const result = projectCaseMap({ cases: [], projectLinks: [], projects: [project('p1', '项目一', [task('same-task', '分析一')]), project('p2', '项目二', [task('same-task', '分析二')])], view: { ...initialCaseMapView(), expandedProjectIds: ['p1', 'p2'], nodeLimit: 3 } });
  assert.equal(result.nodes.length, 3);
  assert.equal(result.allNodes.length, 4);
  assert.equal(result.hiddenNodes, 1);
  assert.equal(new Set(result.allNodes.map(node => node.id)).size, 4);
  const visibleIds = new Set(result.nodes.map(node => node.id));
  assert(result.edges.every(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)));
});

test('relationship filters keep only the selected relationship endpoints and their structural project context', () => {
  const input = { cases: [caseRecord('a'), caseRecord('b'), caseRecord('c'), caseRecord('d')], projects: [project('shared', '共享项目'), project('single', '单独项目'), project('independent', '独立项目')], projectLinks: [link('a', 'shared'), link('b', 'shared'), link('c', 'single')], relations: [{ relationId: 'support', fromCaseId: 'a', toCaseId: 'b', kind: 'supports' as const, lifecycle: 'active' as const }, { relationId: 'follow', fromCaseId: 'c', toCaseId: 'd', kind: 'follows_up' as const, lifecycle: 'active' as const }] };
  const shared = projectCaseMap({ ...input, view: { ...initialCaseMapView(), relation: 'shared' } });
  assert.deepEqual(new Set(shared.allNodes.map(node => node.id)), new Set(['case:a', 'case:b', 'project:shared']));
  assert(shared.edges.every(edge => edge.kind === 'project'));
  const supports = projectCaseMap({ ...input, view: { ...initialCaseMapView(), relation: 'supports' } });
  assert.deepEqual(new Set(supports.allNodes.map(node => node.id)), new Set(['case:a', 'case:b', 'project:shared']));
  assert(supports.edges.some(edge => edge.kind === 'supports'));
  assert(supports.edges.some(edge => edge.kind === 'project'), 'approved demo retains structural project context for selected business endpoints');
  const follows = projectCaseMap({ ...input, view: { ...initialCaseMapView(), relation: 'follows_up' } });
  assert.deepEqual(new Set(follows.allNodes.map(node => node.id)), new Set(['case:c', 'case:d', 'project:single']));
});

test('a dense graph budget samples visible rows with projects and expanded tasks, rather than only the case array', () => {
  const result = projectCaseMap({ cases: Array.from({ length: 250 }, (_, index) => caseRecord(`c${index}`)), projectLinks: [link('c0', 'p')], projects: [project('p', '共享分析', [task('t', '核对')])], view: { ...initialCaseMapView(), expandedProjectIds: ['p'], nodeLimit: 5 } });
  assert.equal(result.nodes.length, 5);
  assert(result.nodes.some(node => node.kind === 'project'));
  assert(result.nodes.some(node => node.kind === 'task'));
  assert.equal(result.allNodes.length, 252);
  assert.equal(result.hiddenNodes, 247);
});

test('business relations sharing a curve midpoint get stable separate hit targets by relation identity', () => {
  const result = projectCaseMap({ cases: [caseRecord('a'), caseRecord('b')], projects: [project('p', '共享项目')], projectLinks: [link('a', 'p'), link('b', 'p')], relations: [{ relationId: 'follow', fromCaseId: 'a', toCaseId: 'b', kind: 'follows_up', lifecycle: 'active' }, { relationId: 'support', fromCaseId: 'a', toCaseId: 'b', kind: 'supports', lifecycle: 'active' }], view: initialCaseMapView() });
  const layout = layoutCaseMapEdges(result.edges, result.nodes), follow = layout.get('relation:follow'), support = layout.get('relation:support');
  assert(follow && support);
  assert(Math.abs(follow.x - support.x) >= 100 || Math.abs(follow.y - support.y) >= 40, 'normal-sized relation labels must not cover each other');
  const reversed = layoutCaseMapEdges([...result.edges].reverse(), [...result.nodes].reverse());
  assert.deepEqual(reversed.get('relation:follow'), follow, 'layout is stable by relation identity, not read order');
  assert.deepEqual(reversed.get('relation:support'), support);
});
