import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ConfigurationStore } from '../src/host/config-store.ts';
import { createCaseRoutes } from '../src/host/case-routes.ts';

async function fixture(t: any, withHooks = true) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'optracall-studio2-case-scope-'));
  const dataRoot = path.join(root, 'host'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const configuration = new ConfigurationStore({ dataRoot }); await configuration.init();
  const selected = await configuration.save({ name: '合成Case路由', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-case-scope', apiKey: 'synthetic-only' });
  const cases = new CaseStore({ dataRoot }); await cases.init(); await cases.initialize();
  t.after(async () => { cases.close(); await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const caseScopes = new Map<string, string>(), projectScopes = new Map<string, string>(), writes: string[] = [];
  let defaultEnterprise: string | undefined, inGate = false;
  const hooks = {
    caseEnterpriseId: (id: string) => caseScopes.get(id), projectEnterpriseId: (id: string) => projectScopes.get(id), defaultEnterpriseId: () => defaultEnterprise,
    assignCase: (id: string, enterpriseId: string) => { assert.equal(inGate, true); if (caseScopes.has(id)) assert.equal(caseScopes.get(id), enterpriseId); caseScopes.set(id, enterpriseId); writes.push('case:' + id); },
    assignProject: (id: string, enterpriseId: string) => { assert.equal(inGate, true); if (projectScopes.has(id)) assert.equal(projectScopes.get(id), enterpriseId); projectScopes.set(id, enterpriseId); writes.push('project:' + id); },
  };
  const makeRoute = () => createCaseRoutes({ cases, projects, configuration, mutate: async operation => { inGate = true; try { return await operation(); } finally { inGate = false; } }, assertActive: project => { assert.equal(project.archivedAt, null); }, decorateProject: project => project, ...(withHooks ? { enterpriseScope: hooks } : {}) });
  let route = makeRoute();
  const request = async (pathname: string, method: string, input?: Record<string, unknown>): Promise<any> => { const result = await route({ pathname, method, input }); assert.ok(result); return result.body; };
  return { root, cases, projects, configuration, selected, caseScopes, projectScopes, writes, request, hooks, restart: async () => { cases.close(); await cases.init(); route = makeRoute(); }, setDefault: (id: string | undefined) => { defaultEnterprise = id; } };
}

test('a new Case can inherit one enterprise default but GET and completed creation replays never claim an old unassigned Case', async t => {
  const f = await fixture(t), a = randomUUID(); f.setDefault(a);
  const input = { operationId: randomUUID(), title: '新Case默认企业' }, created = await f.request('/api/cases', 'POST', input);
  assert.equal(f.caseScopes.get(created.case.id), a);
  const original = f.cases.createCase({ operationId: randomUUID(), title: '旧未归属Case' });
  await f.request(`/api/cases/${original.id}`, 'GET'); assert.equal(f.caseScopes.has(original.id), false);
  const legacyInput = { operationId: randomUUID(), title: '在无默认时创建' }; f.setDefault(undefined);
  const legacy = await f.request('/api/cases', 'POST', legacyInput); f.setDefault(a);
  const writes = f.writes.length; assert.deepEqual(await f.request('/api/cases', 'POST', legacyInput), legacy);
  assert.equal(f.caseScopes.has(legacy.case.id), false); assert.equal(f.writes.length, writes);
});

test('new projects inherit the explicit Case enterprise before link completion, prefer it to defaults, and preserve the original creation receipt', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID(); f.setDefault(b);
  const c = f.cases.createCase({ operationId: randomUUID(), title: '明确A企业Case' }); f.caseScopes.set(c.id, a);
  const command = { operationId: randomUUID(), expectedRevision: c.revision, name: 'Case内新项目', configurationId: f.selected.id };
  const first = await f.request(`/api/cases/${c.id}/projects/create`, 'POST', command);
  assert.equal(first.linked, true); assert.equal(first.phase, 'completed');
  assert.equal(f.projectScopes.get(first.project.id), a); assert.equal(f.caseScopes.get(c.id), a);
  const writes = f.writes.length; assert.deepEqual(await f.request(`/api/cases/${c.id}/projects/create`, 'POST', command), first);
  assert.equal(f.writes.length, writes); assert.equal((await f.projects.list()).length, 1);
  const unknown = f.cases.createCase({ operationId: randomUUID(), title: '唯一企业默认的明确创建动作' }); f.setDefault(a);
  const defaulted = await f.request(`/api/cases/${unknown.id}/projects/create`, 'POST', { ...command, operationId: randomUUID(), expectedRevision: unknown.revision, name: '唯一默认项目' });
  assert.equal(f.projectScopes.get(defaulted.project.id), a); assert.equal(f.caseScopes.get(unknown.id), a);
  const unresolved = f.cases.createCase({ operationId: randomUUID(), title: '多企业未知Case' }); f.setDefault(undefined);
  const unassigned = await f.request(`/api/cases/${unresolved.id}/projects/create`, 'POST', { ...command, operationId: randomUUID(), expectedRevision: unresolved.revision, name: '不猜企业的项目' });
  assert.equal(unassigned.linked, true); assert.equal(f.projectScopes.has(unassigned.project.id), false); assert.equal(f.caseScopes.has(unresolved.id), false);
});

test('existing project links reject conflicting enterprises and resolve only an explicit consistent Case or project scope', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID();
  const projectA = await f.projects.create({ name: 'A项目', configuration: f.selected }), projectB = await f.projects.create({ name: 'B项目', configuration: f.selected });
  f.projectScopes.set(projectA.id, a); f.projectScopes.set(projectB.id, b);
  const caseA = f.cases.createCase({ operationId: randomUUID(), title: 'A事项' }); f.caseScopes.set(caseA.id, a);
  const rejected = { operationId: randomUUID(), expectedRevision: caseA.revision, projectId: projectB.id };
  await assert.rejects(f.request(`/api/cases/${caseA.id}/projects`, 'POST', rejected), /case_enterprise_conflict/);
  assert.deepEqual(f.cases.listProjectLinks(caseA.id), []); assert.equal(f.cases.getOperation(rejected.operationId), null);
  const unknown = f.cases.createCase({ operationId: randomUUID(), title: '待核企业事项' });
  const linked = await f.request(`/api/cases/${unknown.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: unknown.revision, projectId: projectA.id });
  assert.equal(f.caseScopes.get(unknown.id), a);
  const emptyProject = await f.projects.create({ name: '待核项目', configuration: f.selected });
  await f.request(`/api/cases/${unknown.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: linked.case.revision, projectId: emptyProject.id });
  assert.equal(f.projectScopes.get(emptyProject.id), a);
  const mixed = f.cases.createCase({ operationId: randomUUID(), title: '有历史项目的未归属事项' });
  const original = f.cases.linkProject({ operationId: randomUUID(), caseId: mixed.id, expectedRevision: mixed.revision, projectId: projectB.id });
  await assert.rejects(f.request(`/api/cases/${mixed.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: original.case.revision, projectId: projectA.id }), /case_enterprise_conflict/);
  assert.equal(f.caseScopes.has(mixed.id), false); assert.equal(f.cases.listProjectLinks(mixed.id).length, 1);
  const untouched = f.cases.createCase({ operationId: randomUUID(), title: '全部未知的历史事项' }), unowned = await f.projects.create({ name: '历史未归属项目', configuration: f.selected }); f.setDefault(a);
  await f.request(`/api/cases/${untouched.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: untouched.revision, projectId: unowned.id });
  assert.equal(f.caseScopes.has(untouched.id), false); assert.equal(f.projectScopes.has(unowned.id), false);
});

test('scope failures preserve the original created project receipt and retry completes that same project without duplication', async t => {
  const f = await fixture(t), a = randomUUID();
  const c = f.cases.createCase({ operationId: randomUUID(), title: '企业关联故障恢复' }); f.caseScopes.set(c.id, a);
  const command = { operationId: randomUUID(), expectedRevision: c.revision, name: '保留原项目身份', configurationId: f.selected.id };
  const originalAssignment = f.hooks.assignProject;
  f.hooks.assignProject = () => { throw new Error('synthetic_metadata_write_failure'); };
  await assert.rejects(f.request(`/api/cases/${c.id}/projects/create`, 'POST', command), (error: any) => {
    assert.equal(error.code, 'case_enterprise_assignment_incomplete'); assert.equal(error.details.projectCreated, true); return true;
  });
  const partial = f.cases.getOperation(command.operationId)!;
  assert.equal(partial.phase, 'project_created'); assert.ok(partial.projectId);
  assert.equal((await f.projects.list()).length, 1); assert.equal(f.cases.listProjectLinks(c.id).length, 0);
  assert.equal(f.projectScopes.has(partial.projectId!), false);
  f.hooks.assignProject = originalAssignment;
  const recovered = await f.request(`/api/cases/${c.id}/projects/create`, 'POST', command);
  assert.equal(recovered.phase, 'completed'); assert.equal(recovered.project.id, partial.projectId);
  assert.equal(f.projectScopes.get(partial.projectId!), a); assert.equal((await f.projects.list()).length, 1);
  assert.equal(f.cases.listProjectLinks(c.id).length, 1);
});

test('project-created recovery and fresh project creation reject foreign linked enterprises before completing a Case link', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID();
  const c = f.cases.createCase({ operationId: randomUUID(), title: '项目已建但企业冲突' }); f.caseScopes.set(c.id, a);
  const projectId = randomUUID(), command = { operationId: randomUUID(), expectedRevision: c.revision, name: '已建B项目', configurationId: f.selected.id };
  f.cases.reserveProjectCreation({ operationId: command.operationId, expectedRevision: command.expectedRevision, caseId: c.id, projectId, projectInput: { name: command.name, configurationId: command.configurationId } });
  await f.projects.create({ name: command.name, configuration: f.selected, reservedId: projectId }); f.cases.markProjectCreated(command.operationId); f.projectScopes.set(projectId, b);
  await assert.rejects(f.request(`/api/cases/${c.id}/projects/create`, 'POST', command), /case_enterprise_conflict/);
  assert.equal(f.cases.getOperation(command.operationId)?.phase, 'project_created'); assert.equal((await f.projects.list()).length, 1);
  assert.equal(f.cases.listProjectLinks(c.id).length, 0); assert.equal(f.projectScopes.get(projectId), b);
  const historical = f.cases.createCase({ operationId: randomUUID(), title: '历史已有B关联的A事项' }); f.caseScopes.set(historical.id, a);
  const oldLink = f.cases.linkProject({ operationId: randomUUID(), caseId: historical.id, expectedRevision: historical.revision, projectId });
  const next = { ...command, operationId: randomUUID(), expectedRevision: oldLink.case.revision, name: '冲突不创建新项目' };
  await assert.rejects(f.request(`/api/cases/${historical.id}/projects/create`, 'POST', next), /case_enterprise_conflict/);
  assert.equal((await f.projects.list()).length, 1); assert.equal(f.cases.getOperation(next.operationId), null);
  assert.equal(f.cases.listProjectLinks(historical.id).length, 1);
});

test('failed native link CAS never assigns metadata and optional hooks preserve all legacy Case creation and replay behavior', async t => {
  const f = await fixture(t), a = randomUUID(), c = f.cases.createCase({ operationId: randomUUID(), title: '并发修订冲突' }); f.caseScopes.set(c.id, a);
  const project = await f.projects.create({ name: '未归属项目', configuration: f.selected }), originalRevision = c.revision;
  const updated = f.cases.updateCase({ operationId: randomUUID(), caseId: c.id, expectedRevision: originalRevision, title: '已修订事项标题', description: '', judgement: '', nextStep: '' });
  assert.ok(updated.revision > originalRevision);
  await assert.rejects(f.request(`/api/cases/${c.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: originalRevision, projectId: project.id }), /case_revision_conflict/);
  assert.equal(f.writes.length, 0); assert.equal(f.projectScopes.has(project.id), false); assert.equal(f.cases.listProjectLinks(c.id).length, 0);
  const legacy = await fixture(t, false); legacy.setDefault(a);
  const created = await legacy.request('/api/cases', 'POST', { operationId: randomUUID(), title: '旧环境仍可创建' });
  const command = { operationId: randomUUID(), expectedRevision: created.case.revision, name: '旧环境新项目', configurationId: legacy.selected.id };
  const linked = await legacy.request(`/api/cases/${created.case.id}/projects/create`, 'POST', command);
  assert.equal(linked.linked, true); assert.deepEqual(await legacy.request(`/api/cases/${created.case.id}/projects/create`, 'POST', command), linked);
  assert.equal(legacy.writes.length, 0); assert.equal(legacy.caseScopes.size, 0); assert.equal(legacy.projectScopes.size, 0);
});

test('Case creation retries recover the original enterprise intent after metadata failure and store reopen, without adopting a later default', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID(); f.setDefault(a);
  const input = { operationId: randomUUID(), title: '原始企业意图应恢复' }, assign = f.hooks.assignCase;
  f.hooks.assignCase = () => { throw new Error('synthetic_case_scope_write_failure'); };
  await assert.rejects(f.request('/api/cases', 'POST', input), /case_enterprise_assignment_incomplete/);
  const native = f.cases.getOperation(input.operationId)!;
  assert.equal(native.phase, 'completed'); assert.ok(native.caseId); assert.equal(f.caseScopes.has(native.caseId!), false);
  f.hooks.assignCase = assign; f.setDefault(b); await f.restart();
  const recovered = await f.request('/api/cases', 'POST', input);
  assert.equal(recovered.case.id, native.caseId); assert.equal(f.caseScopes.get(native.caseId!), a);
  assert.equal(f.cases.listCases().length, 1); assert.equal(f.cases.getEvents('case', native.caseId!).length, 1);
  const writes = f.writes.length; assert.deepEqual(await f.request('/api/cases', 'POST', input), recovered); assert.equal(f.writes.length, writes);
});

test('completed existing-project link retries recover failed Case or project assignment from the original operation scope', async t => {
  const f = await fixture(t), a = randomUUID();
  const c = f.cases.createCase({ operationId: randomUUID(), title: '明确项目关联未知Case' }), project = await f.projects.create({ name: '明确A项目', configuration: f.selected }); f.projectScopes.set(project.id, a);
  const command = { operationId: randomUUID(), expectedRevision: c.revision, projectId: project.id }, assignCase = f.hooks.assignCase;
  f.hooks.assignCase = () => { throw new Error('synthetic_case_scope_write_failure'); };
  await assert.rejects(f.request(`/api/cases/${c.id}/projects`, 'POST', command), /case_enterprise_assignment_incomplete/);
  assert.equal(f.cases.getOperation(command.operationId)?.phase, 'completed'); assert.equal(f.cases.listProjectLinks(c.id).length, 1);
  f.hooks.assignCase = assignCase; await f.restart();
  const recovered = await f.request(`/api/cases/${c.id}/projects`, 'POST', command);
  assert.equal(f.caseScopes.get(c.id), a); assert.equal(f.cases.listProjectLinks(c.id).length, 1); assert.equal(f.cases.getEvents('case', c.id).filter(event => event.eventType === 'project_linked').length, 1);
  const empty = await f.projects.create({ name: '未归属项目故障恢复', configuration: f.selected }), next = { operationId: randomUUID(), expectedRevision: recovered.case.revision, projectId: empty.id }, assignProject = f.hooks.assignProject;
  f.hooks.assignProject = () => { throw new Error('synthetic_project_scope_write_failure'); };
  await assert.rejects(f.request(`/api/cases/${c.id}/projects`, 'POST', next), /case_enterprise_assignment_incomplete/);
  f.hooks.assignProject = assignProject; await f.restart();
  const linked = await f.request(`/api/cases/${c.id}/projects`, 'POST', next);
  assert.equal(f.projectScopes.get(empty.id), a); assert.equal(linked.link.projectId, empty.id); assert.equal(f.cases.listProjectLinks(c.id).length, 2);
});

test('prepared project creation preserves its first default enterprise across failed assignment and later default changes', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID(); f.setDefault(a);
  const c = f.cases.createCase({ operationId: randomUUID(), title: '准备阶段企业意图固定' }), command = { operationId: randomUUID(), expectedRevision: c.revision, name: '不重新猜测默认企业', configurationId: f.selected.id }, assign = f.hooks.assignCase;
  f.hooks.assignCase = () => { throw new Error('synthetic_prepared_scope_write_failure'); };
  await assert.rejects(f.request(`/api/cases/${c.id}/projects/create`, 'POST', command), /case_enterprise_assignment_incomplete/);
  const reserved = f.cases.getOperation(command.operationId)!; assert.equal(reserved.phase, 'prepared'); assert.equal((await f.projects.list()).length, 0);
  f.hooks.assignCase = assign; f.setDefault(b); await f.restart();
  const linked = await f.request(`/api/cases/${c.id}/projects/create`, 'POST', command);
  assert.equal(linked.project.id, reserved.projectId); assert.equal(f.caseScopes.get(c.id), a); assert.equal(f.projectScopes.get(linked.project.id), a);
  assert.equal(linked.linked, true); assert.equal((await f.projects.list()).length, 1);
});

test('the original project-create operation can recover its persisted scope after a separate link completed its receipt but metadata failed', async t => {
  const f = await fixture(t), a = randomUUID(), c = f.cases.createCase({ operationId: randomUUID(), title: '原创建与后续关联保留各自回执' }); f.caseScopes.set(c.id, a);
  const projectId = randomUUID(), command = { operationId: randomUUID(), expectedRevision: c.revision, name: '创建后单独关联', configurationId: f.selected.id };
  f.cases.reserveProjectCreation({ ...command, caseId: c.id, projectId, projectInput: { name: command.name, configurationId: command.configurationId } }, { enterpriseScopeIntent: a });
  await f.projects.create({ name: command.name, configuration: f.selected, reservedId: projectId }); f.cases.markProjectCreated(command.operationId);
  const assign = f.hooks.assignProject; f.hooks.assignProject = () => { throw new Error('synthetic_recovery_project_scope_failure'); };
  const recovery = { operationId: randomUUID(), expectedRevision: c.revision, projectId, recoveryOfOperationId: command.operationId };
  await assert.rejects(f.request(`/api/cases/${c.id}/projects`, 'POST', recovery), /case_enterprise_assignment_incomplete/);
  assert.equal(f.cases.getOperation(command.operationId)?.phase, 'completed'); assert.equal(f.cases.getOperation(recovery.operationId)?.phase, 'completed');
  assert.equal(f.projectScopes.has(projectId), false);
  f.hooks.assignProject = assign; await f.restart();
  const originalReplay = await f.request(`/api/cases/${c.id}/projects/create`, 'POST', command);
  assert.equal(originalReplay.project.id, projectId); assert.equal(originalReplay.linked, true); assert.equal(f.projectScopes.get(projectId), a);
  assert.equal((await f.projects.list()).length, 1); assert.equal(f.cases.listProjectLinks(c.id).length, 1);
});

test('scope recovery validates immutable native commands and current conflicts before writing any association', async t => {
  const f = await fixture(t), a = randomUUID(), b = randomUUID(); f.setDefault(a);
  const input = { operationId: randomUUID(), title: '不能通过重试换企业或载荷' }, assign = f.hooks.assignCase;
  f.hooks.assignCase = () => { throw new Error('synthetic_retry_assignment_failure'); };
  await assert.rejects(f.request('/api/cases', 'POST', input), /case_enterprise_assignment_incomplete/);
  const native = f.cases.getOperation(input.operationId)!; f.hooks.assignCase = assign;
  await assert.rejects(f.request('/api/cases', 'POST', { ...input, title: '同operation的不同输入' }), /operation_conflict/);
  assert.equal(f.writes.length, 0); assert.equal(f.caseScopes.has(native.caseId!), false);
  f.caseScopes.set(native.caseId!, b);
  await assert.rejects(f.request('/api/cases', 'POST', input), /case_enterprise_conflict/); assert.equal(f.writes.length, 0); assert.equal(f.caseScopes.get(native.caseId!), b);
  assert.equal(f.cases.getOperation(input.operationId)?.enterpriseScopeIntent, a);
  assert.equal(Object.hasOwn(f.cases.getOperation(input.operationId)!.result!, 'enterpriseScopeIntent'), false);
});
